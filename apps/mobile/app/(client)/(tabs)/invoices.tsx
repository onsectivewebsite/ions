/**
 * Invoices tab — client's invoices across all their cases.
 *
 * Tap a row → push (client)/invoices/[id]. Stripe payment lives there;
 * 9.3 routes payment to the browser portal via Linking.
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
import { getClientToken, setClientToken } from '../../../src/shared/session';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';

type Invoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: string;
  dueDate: string | null;
  case: { id: string; caseType: string };
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

export default function ClientInvoicesScreen() {
  const [items, setItems] = useState<Invoice[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const r = await rpcQuery<Invoice[]>('portal.invoicesList', undefined, { token });
      setItems(r);
    } catch (err) {
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setClientToken(null);
        router.replace('/(client)/sign-in');
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

  if (items === null) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const totalOwing = items
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + i.balanceCents, 0);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Invoices</Text>
        <Text style={styles.subtitle}>
          Outstanding: <Text style={styles.totalOwing}>{fmtMoney(totalOwing)}</Text>
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
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
        ListEmptyComponent={<EmptyState title="No invoices yet" />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(client)/invoices/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surfaceMuted }]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.number}>{item.number}</Text>
              <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
            </View>
            <View style={styles.rowMetaLine}>
              <Text style={styles.meta}>
                {item.case.caseType.replace('_', ' ')} · Issued{' '}
                {new Date(item.issueDate).toLocaleDateString()}
              </Text>
              <Text style={styles.amount}>
                {item.balanceCents > 0
                  ? `${fmtMoney(item.balanceCents, item.currency)} owing`
                  : 'Paid'}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, gap: 4 },
  h1: { fontSize: 28, fontWeight: '700', color: C.text },
  subtitle: { color: C.textMuted, fontSize: 13 },
  totalOwing: { fontWeight: '700', color: C.text },
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
  number: { fontSize: 16, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  rowMetaLine: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  meta: { fontSize: 12, color: C.textMuted, textTransform: 'capitalize' },
  amount: { fontSize: 13, color: C.text, fontWeight: '600' },
});
