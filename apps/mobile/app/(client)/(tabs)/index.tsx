/**
 * Files tab — the client's case list.
 *
 * Mirrors /portal/dashboard on the web. Each row links into the case
 * detail; long-form actions (upload, payment) live in deeper screens.
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
import { rpcQuery, RpcError } from '../../../src/shared/api';
import { getClientToken, setClientToken } from '../../../src/shared/session';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string };
  tenant: { displayName: string };
};

type CaseRow = {
  id: string;
  caseType: string;
  status: string;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  irccDecision: string | null;
  updatedAt: string;
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

export default function ClientFilesScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const [m, c] = await Promise.all([
        rpcQuery<Me>('portal.me', undefined, { token }),
        rpcQuery<CaseRow[]>('portal.cases', undefined, { token }),
      ]);
      setMe(m);
      setCases(c);
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

  async function signOut(): Promise<void> {
    Alert.alert('Sign out', 'Sign out of your portal?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          const { unregisterPush } = await import('../../../src/shared/push');
          await unregisterPush();
          await setClientToken(null);
          router.replace('/(client)/sign-in');
        },
      },
    ]);
  }

  if (!me || cases === null) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.tenantLabel}>{me.tenant.displayName}</Text>
          <Text style={styles.h1}>Hi, {fullName.split(' ')[0]}</Text>
        </View>
        <Pressable onPress={() => void signOut()} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <FlatList
        data={cases}
        keyExtractor={(c) => c.id}
        contentContainerStyle={cases.length === 0 ? styles.emptyContainer : { paddingBottom: 24 }}
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
            title="No files on record yet"
            hint="Once your firm opens a file for you, it will appear here."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(client)/cases/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: C.surfaceMuted }]}
          >
            <View style={styles.rowMain}>
              <Text style={styles.caseType}>{item.caseType.replace('_', ' ')}</Text>
              <View style={styles.badges}>
                <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>{item.status.replaceAll('_', ' ')}</Badge>
                {item.irccDecision ? <Badge tone="success">{item.irccDecision}</Badge> : null}
              </View>
            </View>
            <Text style={styles.meta}>
              {fmtMoney(item.amountPaidCents)} paid of {fmtMoney(item.totalFeeCents ?? item.retainerFeeCents)}
              {item.irccFileNumber ? ` · IRCC #${item.irccFileNumber}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tenantLabel: { fontSize: 12, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  h1: { fontSize: 28, fontWeight: '700', color: C.text, marginTop: 2 },
  signOut: { color: C.primary, fontWeight: '600' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomColor: C.borderMuted,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: C.surface,
  },
  rowMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caseType: { fontSize: 16, fontWeight: '600', color: C.text, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 6 },
  meta: { marginTop: 6, fontSize: 12, color: C.textMuted },
});
