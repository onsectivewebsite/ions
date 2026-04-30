/**
 * Staff dashboard — Home tab.
 *
 * Headline counts + recent rows. Tap a card to drill into the relevant
 * tab. Pull-to-refresh and 401-bounce-to-sign-in carry over from 9.1.
 */
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string };
};

type CaseRow = { id: string; status: string; caseType: string; updatedAt: string };
type LeadRow = { id: string; firstName: string | null; lastName: string | null; status: string };

export default function DashboardScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
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
      const [meR, casesR, leadsR] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<{ items: CaseRow[]; total: number }>(
          'cases.list',
          { page: 1 },
          { token },
        ).catch(() => ({ items: [], total: 0 })),
        rpcQuery<{ items: LeadRow[]; total: number }>(
          'lead.myQueue',
          undefined,
          { token },
        ).catch(() => ({ items: [], total: 0 })),
      ]);
      setMe(meR);
      setCases(casesR.items);
      setLeads(leadsR.items);
    } catch (err) {
      const msg = err instanceof RpcError ? err.message : 'Failed to load dashboard';
      setError(msg);
      // 401 / signed-out → bounce to sign-in.
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

  async function signOut(): Promise<void> {
    Alert.alert('Sign out', 'Sign out of OnsecBoad?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await setStaffToken(null);
          router.replace('/(staff)/sign-in');
        },
      },
    ]);
  }

  if (!me || cases === null || leads === null) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
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
        <View style={styles.header}>
          <View>
            <Text style={styles.tenantLabel}>{me.tenant.displayName}</Text>
            <Text style={styles.h1}>Hi, {me.name.split(' ')[0]}</Text>
          </View>
          <Pressable onPress={() => void signOut()} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.statsRow}>
          <Stat label="Open cases" value={String(cases.length)} />
          <Stat label="My queue" value={String(leads.length)} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent cases</Text>
          {cases.length === 0 ? (
            <Text style={styles.muted}>No cases yet.</Text>
          ) : (
            cases.slice(0, 5).map((c) => (
              <Pressable
                key={c.id}
                onPress={() => router.push(`/(staff)/cases/${c.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.rowText}>{c.caseType.replace('_', ' ')}</Text>
                <Text style={styles.rowMeta}>{c.status.replaceAll('_', ' ')}</Text>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>My queue</Text>
          {leads.length === 0 ? (
            <Text style={styles.muted}>No leads in your queue.</Text>
          ) : (
            leads.slice(0, 5).map((l) => (
              <Pressable
                key={l.id}
                onPress={() => router.push(`/(staff)/leads/${l.id}`)}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.rowText}>
                  {[l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed lead'}
                </Text>
                <Text style={styles.rowMeta}>{l.status}</Text>
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAF7' },
  scroll: { padding: 24, gap: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tenantLabel: { fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  h1: { fontSize: 28, fontWeight: '700', color: '#111827', marginTop: 2 },
  signOut: { color: '#B5132B', fontWeight: '600' },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E5DF' },
  statLabel: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 28, fontWeight: '700', color: '#111827', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E5E5DF' },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFEA' },
  rowText: { color: '#111827', fontSize: 14, textTransform: 'capitalize' },
  rowMeta: { color: '#6b7280', fontSize: 12, textTransform: 'capitalize' },
  muted: { color: '#6b7280', fontSize: 13 },
  errorCard: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 8, padding: 12 },
  errorText: { color: '#991B1B', fontSize: 13 },
});
