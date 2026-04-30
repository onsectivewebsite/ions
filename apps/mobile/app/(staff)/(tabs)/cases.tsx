/**
 * Cases tab — paginated list with status filter + client-name search.
 *
 * Read-only view in 9.2. Tap a row → push /(staff)/cases/[id].
 */
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, C, EmptyState } from '../../../src/shared/ui';
import { rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type CaseRow = {
  id: string;
  caseType: string;
  status:
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
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  client: { id: string; firstName: string | null; lastName: string | null; phone: string };
  lawyer: { id: string; name: string };
  updatedAt: string;
};

type ListResp = { items: CaseRow[]; total: number };

const STATUS_TONE: Record<CaseRow['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
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

export default function CasesScreen() {
  const [items, setItems] = useState<CaseRow[] | null>(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setError(null);
    try {
      const token = await getStaffToken();
      if (!token) {
        router.replace('/(staff)/sign-in');
        return;
      }
      const r = await rpcQuery<ListResp>(
        'cases.list',
        { page: 1, ...(search.trim() ? { q: search.trim() } : {}) },
        { token },
      );
      setItems(r.items);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load cases');
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setStaffToken(null);
        router.replace('/(staff)/sign-in');
      }
    }
  }, []);

  useEffect(() => {
    void load(q);
  }, [load, q]);

  useFocusEffect(
    useCallback(() => {
      void load(q);
    }, [load, q]),
  );

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Cases</Text>
        <TextInput
          style={styles.search}
          placeholder="Search by client name, phone, email"
          placeholderTextColor={C.textMuted}
          value={q}
          onChangeText={setQ}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {items === null ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={items.length === 0 ? styles.emptyContainer : { paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load(q);
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={q ? `No cases matching "${q}"` : 'No cases assigned to you'}
              hint={error ?? 'Pull down to refresh.'}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/(staff)/cases/${item.id}`)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surfaceMuted }]}
            >
              <View style={styles.rowMain}>
                <Text style={styles.client}>
                  {[item.client.firstName, item.client.lastName].filter(Boolean).join(' ') || 'Client'}
                </Text>
                <Text style={styles.caseType}>{item.caseType.replace('_', ' ')}</Text>
              </View>
              <View style={styles.rowMeta}>
                <Badge tone={STATUS_TONE[item.status]}>{item.status.replaceAll('_', ' ')}</Badge>
                <Text style={styles.money}>
                  {fmtMoney(item.amountPaidCents)} / {fmtMoney(item.totalFeeCents ?? item.retainerFeeCents)}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, paddingBottom: 8, gap: 8, backgroundColor: C.bg },
  h1: { fontSize: 28, fontWeight: '700', color: C.text },
  search: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    fontSize: 14,
    color: C.text,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: C.borderMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: C.surface,
  },
  rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  client: { fontSize: 16, fontWeight: '600', color: C.text },
  caseType: { fontSize: 12, color: C.textMuted, textTransform: 'capitalize' },
  rowMeta: { marginTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  money: { fontSize: 12, color: C.textMuted, fontVariant: ['tabular-nums'] },
});
