/**
 * Appointment detail — transitions + outcome capture.
 *
 * Mirrors the heavy parts of AppointmentDetail.tsx on the web side, in
 * a mobile-friendly layout. Outcome capture (RETAINER / FOLLOWUP / DONE
 * / NO_SHOW) is included so consultants can wrap up a session from their
 * phone right after the meeting ends.
 */
import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, C, Card, CardTitle, Row } from '../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type Status = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type Outcome = 'RETAINER' | 'FOLLOWUP' | 'DONE' | 'NO_SHOW';

type Appt = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  kind: string;
  caseType: string | null;
  status: Status;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  outcome: Outcome | null;
  outcomeNotes: string | null;
  retainerFeeCents: number | null;
  notes: string | null;
  feeCents: number | null;
  paidAt: string | null;
  paymentMethod: string | null;
  provider: { id: string; name: string; email: string };
  client: { id: string; firstName: string | null; lastName: string | null; phone: string } | null;
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    status: string;
  } | null;
};

const NEXT: Record<Status, Status[]> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_TONE: Record<Status, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  ARRIVED: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

function fmtTime(s: string): string {
  return new Date(s).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtMoney(c: number | null): string {
  if (c == null) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(c / 100);
}

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [a, setA] = useState<Appt | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Outcome form
  const [outcome, setOutcome] = useState<Outcome>('RETAINER');
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [retainerFee, setRetainerFee] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getStaffToken();
      if (!token) {
        router.replace('/(staff)/sign-in');
        return;
      }
      const r = await rpcQuery<Appt>('appointment.get', { id }, { token });
      setA(r);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load appointment');
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setStaffToken(null);
        router.replace('/(staff)/sign-in');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function transition(to: Status, reason?: string): Promise<void> {
    if (!a) return;
    setBusy(true);
    try {
      const token = await getStaffToken();
      await rpcMutation(
        'appointment.transition',
        { id: a.id, to, ...(reason ? { reason } : {}) },
        { token },
      );
      await load();
    } catch (err) {
      Alert.alert('Status', err instanceof RpcError ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function recordOutcome(): Promise<void> {
    if (!a) return;
    setBusy(true);
    try {
      const token = await getStaffToken();
      await rpcMutation(
        'appointment.recordOutcome',
        {
          id: a.id,
          outcome,
          outcomeNotes: outcomeNotes || undefined,
          retainerFeeCents:
            outcome === 'RETAINER' && retainerFee ? Math.round(Number(retainerFee) * 100) : undefined,
        },
        { token },
      );
      await load();
    } catch (err) {
      Alert.alert('Outcome', err instanceof RpcError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!a) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Appointment' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const subject = a.client
    ? [a.client.firstName, a.client.lastName].filter(Boolean).join(' ') || a.client.phone
    : a.lead
      ? [a.lead.firstName, a.lead.lastName].filter(Boolean).join(' ') || a.lead.phone || 'Lead'
      : 'No subject';
  const phone = a.client?.phone ?? a.lead?.phone ?? null;
  const allowedNexts = NEXT[a.status];

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: subject }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
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
      >
        <View>
          <Text style={styles.h1}>{subject}</Text>
          <Text style={styles.subtitle}>
            {fmtTime(a.scheduledAt)} · {a.durationMin}m · {a.kind}
            {a.caseType ? ` · ${a.caseType.replace('_', ' ')}` : ''}
          </Text>
          <View style={styles.headerBadges}>
            <Badge tone={STATUS_TONE[a.status]}>{a.status.replace('_', ' ')}</Badge>
            {a.outcome ? <Badge tone="success">{a.outcome}</Badge> : null}
          </View>
        </View>

        <Card>
          <CardTitle>Subject</CardTitle>
          <Row label="Provider" value={a.provider.name} />
          {phone ? <Row label="Phone" value={phone} /> : null}
          {phone ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${phone}`)}
              style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.callBtnText}>Call {phone}</Text>
            </Pressable>
          ) : null}
        </Card>

        {allowedNexts.length > 0 ? (
          <Card>
            <CardTitle>Move to…</CardTitle>
            <View style={styles.transitionsGrid}>
              {allowedNexts.map((to) => {
                const destructive = to === 'CANCELLED' || to === 'NO_SHOW';
                return (
                  <Pressable
                    key={to}
                    onPress={() => {
                      if (destructive) {
                        Alert.prompt(
                          to === 'CANCELLED' ? 'Cancel appointment' : 'Mark no-show',
                          'Reason (optional)',
                          [
                            { text: 'Back', style: 'cancel' },
                            {
                              text: 'Confirm',
                              style: 'destructive',
                              onPress: (reason) => void transition(to, reason),
                            },
                          ],
                        );
                      } else {
                        void transition(to);
                      }
                    }}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.transitionChip,
                      destructive && styles.destructiveChip,
                      pressed && { opacity: 0.7 },
                      busy && { opacity: 0.5 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.transitionText,
                        destructive && styles.destructiveText,
                      ]}
                    >
                      {to.replace('_', ' ')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Lifecycle</CardTitle>
          <Row label="Arrived" value={a.arrivedAt ? new Date(a.arrivedAt).toLocaleTimeString() : '—'} />
          <Row label="Started" value={a.startedAt ? new Date(a.startedAt).toLocaleTimeString() : '—'} />
          <Row label="Completed" value={a.completedAt ? new Date(a.completedAt).toLocaleTimeString() : '—'} />
          {a.cancelledAt ? (
            <Row label="Cancelled" value={`${new Date(a.cancelledAt).toLocaleTimeString()}${a.cancelReason ? ` · ${a.cancelReason}` : ''}`} />
          ) : null}
          {a.feeCents != null ? <Row label="Fee" value={fmtMoney(a.feeCents)} /> : null}
        </Card>

        {(a.status === 'COMPLETED' || a.status === 'IN_PROGRESS' || a.status === 'NO_SHOW') &&
        a.outcome == null ? (
          <Card>
            <CardTitle>Record outcome</CardTitle>
            <View style={styles.outcomeGrid}>
              {(['RETAINER', 'FOLLOWUP', 'DONE', 'NO_SHOW'] as Outcome[]).map((o) => (
                <Pressable
                  key={o}
                  onPress={() => setOutcome(o)}
                  style={({ pressed }) => [
                    styles.outcomeChip,
                    outcome === o && styles.outcomeChipActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.outcomeText,
                      outcome === o && styles.outcomeTextActive,
                    ]}
                  >
                    {o}
                  </Text>
                </Pressable>
              ))}
            </View>
            {outcome === 'RETAINER' ? (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.label}>Retainer fee (CAD)</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={retainerFee}
                  onChangeText={setRetainerFee}
                  placeholder="2500.00"
                  placeholderTextColor={C.textMuted}
                />
              </View>
            ) : null}
            <Text style={[styles.label, { marginTop: 12 }]}>Notes</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              multiline
              value={outcomeNotes}
              onChangeText={setOutcomeNotes}
              placeholder="What did the consult cover? Any follow-up needed?"
              placeholderTextColor={C.textMuted}
            />
            <Button
              busy={busy}
              onPress={() => void recordOutcome()}
              style={{ marginTop: 12 }}
            >
              Record outcome
            </Button>
          </Card>
        ) : null}

        {a.outcome ? (
          <Card>
            <CardTitle>Outcome — {a.outcome}</CardTitle>
            {a.outcome === 'RETAINER' ? (
              <Row label="Retainer fee" value={fmtMoney(a.retainerFeeCents)} />
            ) : null}
            {a.outcomeNotes ? <Text style={styles.notes}>{a.outcomeNotes}</Text> : null}
          </Card>
        ) : null}

        {a.notes ? (
          <Card>
            <CardTitle>Notes</CardTitle>
            <Text style={styles.notes}>{a.notes}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 24, fontWeight: '700', color: C.text },
  subtitle: { color: C.textMuted, fontSize: 13, marginTop: 4 },
  headerBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  callBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnText: { color: C.textOnPrimary, fontWeight: '600', fontSize: 15 },
  transitionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  transitionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  destructiveChip: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  transitionText: { color: C.text, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  destructiveText: { color: '#991B1B' },
  outcomeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  outcomeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  outcomeChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  outcomeText: { color: C.text, fontSize: 12, fontWeight: '600' },
  outcomeTextActive: { color: C.textOnPrimary },
  label: { fontSize: 12, color: C.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    fontSize: 14,
    color: C.text,
  },
  textarea: { height: 100, paddingTop: 10, textAlignVertical: 'top' },
  notes: { color: C.text, fontSize: 14, lineHeight: 20 },
});
