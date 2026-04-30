/**
 * Pair this TV to a branch.
 *
 * Big tap targets so receptionists can pick the right branch easily.
 * Branch is stored in SecureStore + shown on the display footer; sign-out
 * (or a 401 from the API) clears both token + branch and bounces back to
 * /sign-in.
 */
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { rpcQuery, RpcError } from '../../src/shared/api';
import {
  getTvToken,
  setTvBranchId,
  setTvBranchName,
  setTvToken,
} from '../../src/shared/session';

type Branch = {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
  manager: { name: string } | null;
};

type ListResp = { items: Branch[]; total: number };

export default function PairScreen() {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const token = await getTvToken();
      if (!token) {
        router.replace('/(tv)/sign-in');
        return;
      }
      try {
        const r = await rpcQuery<ListResp>('branch.list', { page: 1 }, { token });
        setBranches(r.items);
      } catch (err) {
        if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
          await setTvToken(null);
          router.replace('/(tv)/sign-in');
          return;
        }
        Alert.alert('Branches', err instanceof RpcError ? err.message : 'Failed to load branches');
      }
    })();
  }, []);

  async function pick(b: Branch): Promise<void> {
    setBusyId(b.id);
    try {
      await setTvBranchId(b.id);
      await setTvBranchName(b.name);
      router.replace('/(tv)/display');
    } finally {
      setBusyId(null);
    }
  }

  async function unpair(): Promise<void> {
    Alert.alert('Unpair this TV?', 'This signs the TV out completely. You can re-pair anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpair',
        style: 'destructive',
        onPress: async () => {
          await setTvToken(null);
          await setTvBranchId(null);
          await setTvBranchName(null);
          router.replace('/(tv)/sign-in');
        },
      },
    ]);
  }

  if (branches === null) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.brand}>OnsecBoad · Lobby</Text>
        <Text style={styles.h1}>Which branch is this display for?</Text>
        <Text style={styles.subtitle}>Tap a branch to start showing today&apos;s lobby view.</Text>
      </View>
      <FlatList
        data={branches}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.grid}
        numColumns={2}
        columnWrapperStyle={{ gap: 16 }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void pick(item)}
            disabled={busyId !== null}
            style={({ pressed }) => [
              styles.card,
              pressed && { opacity: 0.7 },
              busyId !== null && busyId !== item.id && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.cardName}>{item.name}</Text>
            {item.city ? <Text style={styles.cardCity}>{item.city}</Text> : null}
            {item.manager ? <Text style={styles.cardManager}>Manager: {item.manager.name}</Text> : null}
            {busyId === item.id ? (
              <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />
            ) : null}
          </Pressable>
        )}
      />
      <Pressable onPress={() => void unpair()} hitSlop={12} style={styles.unpairBtn}>
        <Text style={styles.unpairText}>Unpair this display</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A', padding: 32 },
  header: { marginBottom: 24 },
  brand: { fontSize: 14, color: '#94a3b8', fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  h1: { fontSize: 36, fontWeight: '800', color: '#fff', marginTop: 12 },
  subtitle: { color: '#cbd5e1', fontSize: 16, marginTop: 4 },
  grid: { gap: 16, paddingBottom: 16 },
  card: {
    flex: 1,
    minHeight: 140,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'flex-start',
  },
  cardName: { color: '#fff', fontSize: 24, fontWeight: '700' },
  cardCity: { color: '#cbd5e1', fontSize: 14, marginTop: 6 },
  cardManager: { color: '#94a3b8', fontSize: 12, marginTop: 8 },
  unpairBtn: { paddingVertical: 12, alignItems: 'center' },
  unpairText: { color: '#94a3b8', fontSize: 14 },
});
