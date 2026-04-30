/**
 * My queue tab — leads assigned to me. Telecaller's primary view.
 *
 * Tap a row → push /(staff)/leads/[id] for status change + tap-to-call.
 */
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, C, EmptyState } from '../../../src/shared/ui';
import { rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type LeadStatus = 'NEW' | 'CONTACTED' | 'FOLLOWUP' | 'INTERESTED' | 'BOOKED' | 'CONVERTED' | 'LOST' | 'DNC';

type LeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: LeadStatus;
  source: string;
  caseInterest: string | null;
  followupDueAt: string | null;
  lastContactedAt: string | null;
};

const STATUS_TONE: Record<LeadStatus, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  NEW: 'info',
  CONTACTED: 'neutral',
  FOLLOWUP: 'warning',
  INTERESTED: 'success',
  BOOKED: 'success',
  CONVERTED: 'success',
  LOST: 'danger',
  DNC: 'danger',
};

export default function QueueScreen() {
  const [items, setItems] = useState<LeadRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getStaffToken();
      if (!token) {
        router.replace('/(staff)/sign-in');
        return;
      }
      const r = await rpcQuery<{ items: LeadRow[]; total: number }>(
        'lead.myQueue',
        undefined,
        { token },
      );
      setItems(r.items);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load queue');
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

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>My queue</Text>
        <Text style={styles.subtitle}>
          {items === null ? '…' : `${items.length} lead${items.length === 1 ? '' : 's'} assigned to you`}
        </Text>
      </View>

      {items === null ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(l) => l.id}
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
              title="Nothing in your queue right now"
              hint={error ?? "Round-robin will assign new leads as they come in."}
            />
          }
          renderItem={({ item }) => {
            const fullName =
              [item.firstName, item.lastName].filter(Boolean).join(' ') || item.phone || 'Unnamed lead';
            return (
              <Pressable
                onPress={() => router.push(`/(staff)/leads/${item.id}`)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surfaceMuted }]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.name}>{fullName}</Text>
                  <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                </View>
                <Text style={styles.meta}>
                  {item.phone ?? item.email ?? '—'}
                  {item.caseInterest ? ` · ${item.caseInterest.replace('_', ' ')}` : ''}
                  {item.source ? ` · ${item.source}` : ''}
                </Text>
                {item.followupDueAt ? (
                  <Text style={styles.followup}>
                    Follow up by {new Date(item.followupDueAt).toLocaleString()}
                  </Text>
                ) : null}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomColor: C.borderMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: C.surface,
  },
  rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: C.text, flex: 1, marginRight: 8 },
  meta: { fontSize: 12, color: C.textMuted, marginTop: 4 },
  followup: { fontSize: 11, color: C.warning, marginTop: 4, fontWeight: '600' },
});
