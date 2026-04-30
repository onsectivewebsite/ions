/**
 * Agenda tab — today's appointments grouped chronologically.
 *
 * Default range: today 00:00 → tomorrow 00:00 in local time. Inline
 * Mark Arrived / Start / Complete buttons let receptionists handle
 * walk-in flow without bouncing into the detail screen for every state
 * transition.
 */
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, C, EmptyState } from '../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type ApptStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

type ApptOutcome = 'RETAINER' | 'FOLLOWUP' | 'DONE' | 'NO_SHOW' | null;

type Appt = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  kind: string;
  caseType: string | null;
  status: ApptStatus;
  outcome: ApptOutcome;
  provider: { id: string; name: string };
  client: { id: string; firstName: string | null; lastName: string | null; phone: string } | null;
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
  } | null;
};

const STATUS_TONE: Record<ApptStatus, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  ARRIVED: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

function todayBounds(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

function nextStatus(s: ApptStatus): { label: string; to: ApptStatus } | null {
  if (s === 'SCHEDULED' || s === 'CONFIRMED') return { label: 'Mark arrived', to: 'ARRIVED' };
  if (s === 'ARRIVED') return { label: 'Start consult', to: 'IN_PROGRESS' };
  if (s === 'IN_PROGRESS') return { label: 'Complete', to: 'COMPLETED' };
  return null;
}

export default function AgendaScreen() {
  const [items, setItems] = useState<Appt[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getStaffToken();
      if (!token) {
        router.replace('/(staff)/sign-in');
        return;
      }
      const r = await rpcQuery<Appt[]>('appointment.list', todayBounds(), { token });
      setItems(r);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load agenda');
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setStaffToken(null);
        router.replace('/(staff)/sign-in');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function transition(a: Appt, to: ApptStatus): Promise<void> {
    setBusy(a.id);
    try {
      const token = await getStaffToken();
      await rpcMutation('appointment.transition', { id: a.id, to }, { token });
      await load();
    } catch (err) {
      Alert.alert('Status', err instanceof RpcError ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Today</Text>
        <Text style={styles.subtitle}>
          {items === null
            ? '…'
            : `${items.length} appointment${items.length === 1 ? '' : 's'} scheduled`}
        </Text>
      </View>

      {items === null ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : { paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No appointments today"
              hint={error ?? "Pull down to refresh, or check tomorrow's calendar from the web."}
            />
          }
          renderItem={({ item }) => {
            const subject =
              item.client
                ? [item.client.firstName, item.client.lastName].filter(Boolean).join(' ') || item.client.phone
                : item.lead
                  ? [item.lead.firstName, item.lead.lastName].filter(Boolean).join(' ') ||
                    item.lead.phone ||
                    'Lead'
                  : 'No subject';
            const advance = nextStatus(item.status);
            return (
              <Pressable
                onPress={() => router.push(`/(staff)/appointments/${item.id}`)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surfaceMuted }]}
              >
                <View style={styles.timeCol}>
                  <Text style={styles.time}>{fmtTime(item.scheduledAt)}</Text>
                  <Text style={styles.duration}>{item.durationMin}m</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.subject}>{subject}</Text>
                  <Text style={styles.providerLine}>
                    {item.provider.name} · {item.kind}
                    {item.caseType ? ` · ${item.caseType.replace('_', ' ')}` : ''}
                  </Text>
                  <View style={styles.badges}>
                    <Badge tone={STATUS_TONE[item.status]}>{item.status.replace('_', ' ')}</Badge>
                    {item.outcome ? <Badge tone="success">{item.outcome}</Badge> : null}
                  </View>
                  {advance ? (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void transition(item, advance.to);
                      }}
                      disabled={busy === item.id}
                      style={({ pressed }) => [
                        styles.advanceBtn,
                        pressed && { opacity: 0.7 },
                        busy === item.id && { opacity: 0.5 },
                      ]}
                    >
                      <Text style={styles.advanceBtnText}>{advance.label}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, paddingBottom: 8, gap: 4 },
  h1: { fontSize: 28, fontWeight: '700', color: C.text },
  subtitle: { color: C.textMuted, fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomColor: C.borderMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: C.surface,
  },
  timeCol: { width: 64, alignItems: 'flex-start' },
  time: { fontSize: 16, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  duration: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  body: { flex: 1, gap: 4 },
  subject: { fontSize: 15, fontWeight: '600', color: C.text },
  providerLine: { fontSize: 12, color: C.textMuted, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  advanceBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: C.primary,
    borderRadius: 6,
  },
  advanceBtnText: { color: C.textOnPrimary, fontSize: 12, fontWeight: '600' },
});
