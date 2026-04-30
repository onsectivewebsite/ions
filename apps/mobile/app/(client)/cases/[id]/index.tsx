/**
 * Client-facing case detail.
 *
 * Mirrors /portal/cases/[id]: status, lifecycle, fees, IRCC reference.
 * NO internal staff notes / audit / raw IRCC entries — same allow-list
 * the server enforces in portal.caseDetail.
 */
import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, C, Card, CardTitle, Row } from '../../../../src/shared/ui';
import { rpcQuery, RpcError } from '../../../../src/shared/api';
import { getClientToken, setClientToken } from '../../../../src/shared/session';

type CaseDetail = {
  id: string;
  caseType: string;
  status: string;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  irccDecision: string | null;
  irccPortalDate: string | null;
  retainerApprovedAt: string | null;
  retainerSignedAt: string | null;
  documentsLockedAt: string | null;
  lawyerApprovedAt: string | null;
  submittedToIrccAt: string | null;
  completedAt: string | null;
  appointments: Array<{ id: string; scheduledAt: string; kind: string; status: string }>;
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  PENDING_RETAINER: 'warning',
  PENDING_RETAINER_SIGNATURE: 'warning',
  PENDING_DOCUMENTS: 'warning',
  PREPARING: 'neutral',
  PENDING_LAWYER_APPROVAL: 'warning',
  SUBMITTED_TO_IRCC: 'success',
  IN_REVIEW: 'success',
  COMPLETED: 'success',
  WITHDRAWN: 'danger',
  ABANDONED: 'danger',
};

function fmtMoney(c: number | null): string {
  if (c == null) return '—';
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(c / 100);
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString('en-CA') : '—';
}

export default function ClientCaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const r = await rpcQuery<CaseDetail>('portal.caseDetail', { id }, { token });
      setC(r);
    } catch (err) {
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setClientToken(null);
        router.replace('/(client)/sign-in');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!c) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Your file' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const owed =
    c.totalFeeCents != null
      ? Math.max(0, c.totalFeeCents - c.amountPaidCents)
      : c.retainerFeeCents != null
        ? Math.max(0, c.retainerFeeCents - c.amountPaidCents)
        : null;

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: c.caseType.replace('_', ' ') }} />
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
          <Text style={styles.h1}>Your file</Text>
          <Text style={styles.subtitle}>{c.caseType.replace('_', ' ')}</Text>
          <View style={styles.headerBadges}>
            <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status.replaceAll('_', ' ')}</Badge>
            {c.feesCleared ? <Badge tone="success">Fees cleared</Badge> : null}
            {c.irccDecision ? <Badge tone="success">{c.irccDecision}</Badge> : null}
          </View>
        </View>

        <Pressable
          onPress={() => router.push(`/(client)/cases/${c.id}/documents`)}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
          <Card>
            <Text style={styles.cardLink}>Documents →</Text>
            <Text style={styles.cardLinkHint}>
              {c.documentsLockedAt
                ? 'Submitted — review what you uploaded.'
                : 'Upload the documents your firm has requested.'}
            </Text>
          </Card>
        </Pressable>

        <Card>
          <CardTitle>Progress</CardTitle>
          {[
            { label: 'Retainer approved', at: c.retainerApprovedAt },
            { label: 'Retainer signed', at: c.retainerSignedAt },
            { label: 'Documents submitted', at: c.documentsLockedAt },
            { label: 'Lawyer approved file', at: c.lawyerApprovedAt },
            { label: 'Submitted to IRCC', at: c.submittedToIrccAt },
            { label: 'Decision received', at: c.completedAt },
          ].map((s) => (
            <View key={s.label} style={styles.lifecycleRow}>
              <View style={[styles.dot, { backgroundColor: s.at ? C.success : C.border }]} />
              <Text style={[styles.lifecycleLabel, !s.at && { color: C.textMuted }]}>{s.label}</Text>
              <Text style={styles.lifecycleAt}>{fmtDate(s.at)}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <CardTitle>Fees</CardTitle>
          <Row label="Retainer" value={fmtMoney(c.retainerFeeCents)} />
          <Row label="Total fee" value={fmtMoney(c.totalFeeCents)} />
          <Row label="Paid" value={fmtMoney(c.amountPaidCents)} />
          <Row
            label="Outstanding"
            value={owed != null ? fmtMoney(owed) : '—'}
            tone={owed != null && owed > 0 ? 'warning' : 'success'}
          />
          <Text style={styles.feeHint}>
            Your file is not submitted to IRCC until all fees are cleared. Tap Invoices to pay.
          </Text>
        </Card>

        <Card>
          <CardTitle>IRCC</CardTitle>
          <Row label="File #" value={c.irccFileNumber ?? '—'} />
          <Row label="Portal date" value={fmtDate(c.irccPortalDate)} />
          <Row label="Decision" value={c.irccDecision ?? '—'} />
        </Card>

        {c.appointments.length > 0 ? (
          <Card>
            <CardTitle>Appointments</CardTitle>
            {c.appointments.slice(0, 5).map((a) => (
              <View key={a.id} style={styles.apptRow}>
                <Text style={styles.apptKind}>{a.kind}</Text>
                <Text style={styles.apptWhen}>
                  {new Date(a.scheduledAt).toLocaleString('en-CA', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))}
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
  subtitle: { color: C.textMuted, fontSize: 13, textTransform: 'capitalize' },
  headerBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  cardLink: { color: C.primary, fontWeight: '700', fontSize: 16 },
  cardLinkHint: { color: C.textMuted, fontSize: 12, marginTop: 4 },
  lifecycleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lifecycleLabel: { flex: 1, color: C.text, fontSize: 14 },
  lifecycleAt: { color: C.textMuted, fontSize: 12 },
  feeHint: { color: C.textMuted, fontSize: 11, marginTop: 8, lineHeight: 16 },
  apptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  apptKind: { color: C.text, fontSize: 14, textTransform: 'capitalize' },
  apptWhen: { color: C.textMuted, fontSize: 12 },
});
