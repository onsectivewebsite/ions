/**
 * Client invoice detail.
 *
 * Mirrors /portal/invoices/[id] minus the Stripe Elements form. Native
 * Stripe SDK on RN is heavy and overkill for 9.3 — instead we open the
 * portal URL in the device browser when the client wants to pay. The
 * portal page already handles Stripe Elements + the dry-run fallback.
 */
import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Badge, Button, C, Card, CardTitle } from '../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../src/shared/api';
import { getClientToken, setClientToken } from '../../../src/shared/session';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';

type Item = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  amountCents: number;
};

type Payment = {
  id: string;
  amountCents: number;
  refundedCents: number;
  method: string;
  status: string;
  receivedAt: string;
};

type Invoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  case: { id: string; caseType: string };
  items: Item[];
  payments: Payment[];
};

const STATUS_TONE: Record<InvoiceStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'warning',
  PARTIAL: 'warning',
  PAID: 'success',
  VOID: 'danger',
};

function fmtMoney(c: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(c / 100);
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString('en-CA') : '—';
}

export default function ClientInvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const r = await rpcQuery<Invoice>('portal.invoiceGet', { id }, { token });
      setInv(r);
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

  async function downloadPdf(): Promise<void> {
    setBusy(true);
    try {
      const token = await getClientToken();
      const r = await rpcMutation<{ url: string }>(
        'portal.invoicePdfUrl',
        { id },
        { token },
      );
      void Linking.openURL(r.url);
    } catch (err) {
      Alert.alert('PDF', err instanceof Error ? err.message : 'Could not generate PDF');
    } finally {
      setBusy(false);
    }
  }

  function payInBrowser(): void {
    const portalUrl = (Constants.expoConfig?.extra?.portalUrl as string) ?? '';
    if (!portalUrl) {
      Alert.alert('Pay', 'Portal URL not configured for this app build.');
      return;
    }
    void Linking.openURL(`${portalUrl}/portal/invoices/${id}`);
  }

  if (!inv) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Invoice' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const canPay = inv.status !== 'VOID' && inv.status !== 'DRAFT' && inv.balanceCents > 0;

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: inv.number }} />
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
          <Text style={styles.invoiceNumber}>{inv.number}</Text>
          <View style={styles.headerBadges}>
            <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
          </View>
          <Text style={styles.subtitle}>
            {inv.case.caseType.replace('_', ' ')} · Issued {fmtDate(inv.issueDate)}
            {inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
          </Text>
          <Text style={styles.total}>{fmtMoney(inv.totalCents, inv.currency)}</Text>
          <Text style={styles.balance}>
            {inv.balanceCents > 0
              ? `${fmtMoney(inv.balanceCents, inv.currency)} owing`
              : 'Paid in full'}
          </Text>
        </View>

        {canPay ? (
          <Card>
            <CardTitle>Pay this invoice</CardTitle>
            <Text style={styles.muted}>
              Paying {fmtMoney(inv.balanceCents, inv.currency)} securely opens your portal in the browser.
            </Text>
            <Button onPress={payInBrowser} style={{ marginTop: 12 }}>
              Pay in browser
            </Button>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Line items</CardTitle>
          {inv.items.map((it) => (
            <View key={it.id} style={styles.itemRow}>
              <Text style={styles.itemDesc}>{it.description}</Text>
              <View style={styles.itemRowMeta}>
                <Text style={styles.itemMeta}>
                  {it.quantity} × {fmtMoney(it.unitPriceCents, inv.currency)}
                  {it.taxRateBp > 0 ? ` · ${(it.taxRateBp / 100).toFixed(2)}% tax` : ''}
                </Text>
                <Text style={styles.itemAmount}>{fmtMoney(it.amountCents, inv.currency)}</Text>
              </View>
            </View>
          ))}
          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{fmtMoney(inv.subtotalCents, inv.currency)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax</Text>
              <Text style={styles.totalsValue}>{fmtMoney(inv.taxCents, inv.currency)}</Text>
            </View>
            <View style={[styles.totalsRow, styles.totalsRowMain]}>
              <Text style={styles.totalsLabelMain}>Total</Text>
              <Text style={styles.totalsValueMain}>{fmtMoney(inv.totalCents, inv.currency)}</Text>
            </View>
          </View>
          {inv.notes ? <Text style={styles.notes}>{inv.notes}</Text> : null}
          <Button
            variant="secondary"
            busy={busy}
            onPress={() => void downloadPdf()}
            style={{ marginTop: 12 }}
          >
            Download PDF
          </Button>
        </Card>

        {inv.payments.length > 0 ? (
          <Card>
            <CardTitle>Payments</CardTitle>
            {inv.payments.map((p) => (
              <View key={p.id} style={styles.payRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payAmount}>{fmtMoney(p.amountCents, inv.currency)}</Text>
                  <Text style={styles.payMeta}>
                    {p.method.toUpperCase()} · {new Date(p.receivedAt).toLocaleString()}
                    {p.refundedCents > 0 ? ` · refunded ${fmtMoney(p.refundedCents, inv.currency)}` : ''}
                  </Text>
                </View>
                <Badge
                  tone={
                    p.status === 'COMPLETED'
                      ? 'success'
                      : p.status === 'PARTIAL_REFUND'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {p.status.replace('_', ' ')}
                </Badge>
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
  invoiceNumber: { fontSize: 32, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  headerBadges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  subtitle: { color: C.textMuted, fontSize: 13, marginTop: 8, textTransform: 'capitalize' },
  total: { fontSize: 28, fontWeight: '700', color: C.text, marginTop: 12 },
  balance: { color: C.textMuted, fontSize: 13 },
  muted: { color: C.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  itemRow: { paddingVertical: 8, borderBottomColor: C.borderMuted, borderBottomWidth: StyleSheet.hairlineWidth },
  itemDesc: { color: C.text, fontSize: 14 },
  itemRowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  itemMeta: { color: C.textMuted, fontSize: 12, flex: 1, marginRight: 8 },
  itemAmount: { color: C.text, fontSize: 13, fontWeight: '600' },
  totalsBlock: { marginTop: 8 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalsRowMain: {
    paddingTop: 8,
    marginTop: 4,
    borderTopColor: C.border,
    borderTopWidth: 1,
  },
  totalsLabel: { color: C.textMuted, fontSize: 12 },
  totalsValue: { color: C.text, fontSize: 13 },
  totalsLabelMain: { color: C.text, fontSize: 14, fontWeight: '700' },
  totalsValueMain: { color: C.text, fontSize: 16, fontWeight: '700' },
  notes: {
    marginTop: 12,
    paddingTop: 12,
    borderTopColor: C.borderMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    color: C.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  payAmount: { color: C.text, fontSize: 14, fontWeight: '600' },
  payMeta: { color: C.textMuted, fontSize: 11, marginTop: 2 },
});
