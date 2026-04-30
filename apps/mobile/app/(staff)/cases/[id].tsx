/**
 * Read-only case detail.
 *
 * Mirrors the high-leverage cards on /cases/[id] from the web side, in
 * mobile-friendly layout: status header, fees, lifecycle timeline, IRCC
 * fields, lawyer + filer. Lawyer-approve / case-transitions / payments
 * stay web-only in 9.2 — those interactions are heavy enough that the
 * web IRCC operator desk is the right place for them.
 */
import { useCallback, useEffect, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, C, Card, CardTitle, Row } from '../../../src/shared/ui';
import { rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type CaseStatus =
  | 'PENDING_RETAINER'
  | 'PENDING_RETAINER_SIGNATURE'
  | 'PENDING_DOCUMENTS'
  | 'PREPARING'
  | 'PENDING_LAWYER_APPROVAL'
  | 'SUBMITTED_TO_IRCC'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'WITHDRAWN'
  | 'ABANDONED';

type CaseDetail = {
  id: string;
  caseType: string;
  status: CaseStatus;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  usiNumber: string | null;
  irccFileNumber: string | null;
  irccPortalDate: string | null;
  irccDecision: string | null;
  retainerApprovedAt: string | null;
  retainerSignedAt: string | null;
  documentsLockedAt: string | null;
  lawyerApprovedAt: string | null;
  submittedToIrccAt: string | null;
  completedAt: string | null;
  closedReason: string | null;
  notes: string | null;
  client: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    email: string | null;
  };
  lawyer: { id: string; name: string; email: string };
  filer: { id: string; name: string; email: string } | null;
  branch: { id: string; name: string } | null;
};

const STATUS_TONE: Record<CaseStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
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

export default function CaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<CaseDetail | null>(null);
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
      const r = await rpcQuery<CaseDetail>('cases.get', { id }, { token });
      setC(r);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load case');
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setStaffToken(null);
        router.replace('/(staff)/sign-in');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!c) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Case' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    );
  }

  const owed =
    c.totalFeeCents != null
      ? Math.max(0, c.totalFeeCents - c.amountPaidCents)
      : c.retainerFeeCents != null
        ? Math.max(0, c.retainerFeeCents - c.amountPaidCents)
        : null;

  const fullName =
    [c.client.firstName, c.client.lastName].filter(Boolean).join(' ') || c.client.phone;

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: fullName }} />
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
          <Text style={styles.caseType}>{c.caseType.replace('_', ' ')}</Text>
          <Text style={styles.h1}>{fullName}</Text>
          <View style={styles.headerBadges}>
            <Badge tone={STATUS_TONE[c.status]}>{c.status.replaceAll('_', ' ')}</Badge>
            {c.feesCleared ? <Badge tone="success">Fees cleared</Badge> : null}
            {c.irccDecision ? <Badge tone="success">{c.irccDecision}</Badge> : null}
          </View>
        </View>

        <Card>
          <CardTitle>Client</CardTitle>
          <Row label="Phone" value={c.client.phone} />
          <Row label="Email" value={c.client.email ?? '—'} />
          <Row label="Lawyer" value={c.lawyer.name} />
          {c.filer ? <Row label="Filer" value={c.filer.name} /> : null}
          {c.branch ? <Row label="Branch" value={c.branch.name} /> : null}
          <Pressable
            onPress={() => Linking.openURL(`tel:${c.client.phone}`)}
            style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.callBtnText}>Call {c.client.phone}</Text>
          </Pressable>
        </Card>

        <Card>
          <CardTitle>Fees</CardTitle>
          <Row label="Retainer" value={fmtMoney(c.retainerFeeCents)} />
          <Row label="Total fee" value={fmtMoney(c.totalFeeCents)} />
          <Row label="Paid to date" value={fmtMoney(c.amountPaidCents)} />
          <Row
            label="Outstanding"
            value={owed != null ? fmtMoney(owed) : '—'}
            tone={owed != null && owed > 0 ? 'warning' : 'success'}
          />
        </Card>

        <Card>
          <CardTitle>Lifecycle</CardTitle>
          {[
            { label: 'Retainer approved', at: c.retainerApprovedAt },
            { label: 'Retainer signed', at: c.retainerSignedAt },
            { label: 'Documents submitted', at: c.documentsLockedAt },
            { label: 'Lawyer approved file', at: c.lawyerApprovedAt },
            { label: 'Submitted to IRCC', at: c.submittedToIrccAt },
            { label: 'Decision received', at: c.completedAt },
          ].map((s) => (
            <View key={s.label} style={styles.lifecycleRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: s.at ? C.success : C.border },
                ]}
              />
              <Text style={[styles.lifecycleLabel, !s.at && { color: C.textMuted }]}>
                {s.label}
              </Text>
              <Text style={styles.lifecycleAt}>{fmtDate(s.at)}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <CardTitle>IRCC</CardTitle>
          <Row label="USI" value={c.usiNumber ?? '—'} />
          <Row label="File #" value={c.irccFileNumber ?? '—'} />
          <Row label="Portal date" value={fmtDate(c.irccPortalDate)} />
          <Row label="Decision" value={c.irccDecision ?? '—'} />
        </Card>

        {c.notes ? (
          <Card>
            <CardTitle>Notes</CardTitle>
            <Text style={styles.notes}>{c.notes}</Text>
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
  caseType: { fontSize: 12, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  h1: { fontSize: 24, fontWeight: '700', color: C.text, marginTop: 4 },
  headerBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  callBtn: {
    marginTop: 12,
    height: 40,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnText: { color: C.textOnPrimary, fontWeight: '600', fontSize: 14 },
  lifecycleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  lifecycleLabel: { flex: 1, color: C.text, fontSize: 14 },
  lifecycleAt: { color: C.textMuted, fontSize: 12 },
  notes: { color: C.text, fontSize: 14, lineHeight: 20 },
  errorCard: {
    margin: 16,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#991B1B', fontSize: 13 },
});
