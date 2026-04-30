/**
 * Lead detail — telecaller's primary tap target.
 *
 * Tap-to-call uses the device's native dialer (Linking.openURL('tel:…')).
 * That's the right move on mobile: skips the Twilio softphone wiring
 * complexity in 9.2, and a real phone call from the agent's device works
 * out of the box. Twilio integration on mobile can land in 9.x.
 *
 * Status changer + DNC toggle exposed inline. Notes editor deferred to
 * a later slice — for now staff make notes via the web side.
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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, C, Card, CardTitle, Row } from '../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../src/shared/api';
import { getStaffToken, setStaffToken } from '../../../src/shared/session';

type LeadStatus =
  | 'NEW'
  | 'CONTACTED'
  | 'FOLLOWUP'
  | 'INTERESTED'
  | 'BOOKED'
  | 'CONVERTED'
  | 'LOST'
  | 'DNC';

type LeadDetail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: LeadStatus;
  source: string;
  caseInterest: string | null;
  language: string | null;
  notes: string | null;
  dncFlag: boolean;
  followupDueAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
};

const ALL_STATUSES: LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'FOLLOWUP',
  'INTERESTED',
  'BOOKED',
  'CONVERTED',
  'LOST',
];

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

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getStaffToken();
      if (!token) {
        router.replace('/(staff)/sign-in');
        return;
      }
      const r = await rpcQuery<LeadDetail>('lead.get', { id }, { token });
      setLead(r);
    } catch (err) {
      setError(err instanceof RpcError ? err.message : 'Failed to load lead');
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setStaffToken(null);
        router.replace('/(staff)/sign-in');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(status: LeadStatus): Promise<void> {
    if (!lead || lead.status === status) return;
    setBusy(true);
    try {
      const token = await getStaffToken();
      await rpcMutation('lead.changeStatus', { id: lead.id, status }, { token });
      await load();
    } catch (err) {
      Alert.alert('Status', err instanceof RpcError ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDnc(): Promise<void> {
    if (!lead) return;
    if (lead.dncFlag) {
      Alert.alert('DNC', 'Removing DNC must be done from the web admin for compliance.');
      return;
    }
    Alert.alert(
      'Mark Do-Not-Contact?',
      'This stops outbound calls + SMS to this lead going forward. Cannot be undone here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark DNC',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const token = await getStaffToken();
              await rpcMutation('lead.markDnc', { id: lead.id }, { token });
              await load();
            } catch (err) {
              Alert.alert('DNC', err instanceof RpcError ? err.message : 'Update failed');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (!lead) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Lead' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const fullName =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.phone || 'Unnamed lead';

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
          <Text style={styles.h1}>{fullName}</Text>
          <View style={styles.headerBadges}>
            <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
            {lead.dncFlag ? <Badge tone="danger">DNC</Badge> : null}
            {lead.source ? <Badge tone="neutral">{lead.source}</Badge> : null}
          </View>
        </View>

        <Card>
          <CardTitle>Contact</CardTitle>
          <Row label="Phone" value={lead.phone ?? '—'} />
          <Row label="Email" value={lead.email ?? '—'} />
          <Row label="Language" value={lead.language ?? '—'} />
          <Row label="Case interest" value={lead.caseInterest?.replace('_', ' ') ?? '—'} />
          {lead.phone && !lead.dncFlag ? (
            <Pressable
              onPress={() => Linking.openURL(`tel:${lead.phone}`)}
              style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.callBtnText}>Call {lead.phone}</Text>
            </Pressable>
          ) : null}
          {lead.email && !lead.dncFlag ? (
            <Pressable
              onPress={() => Linking.openURL(`mailto:${lead.email}`)}
              style={({ pressed }) => [styles.linkBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.linkBtnText}>Email {lead.email}</Text>
            </Pressable>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Status</CardTitle>
          <View style={styles.statusGrid}>
            {ALL_STATUSES.map((s) => (
              <Pressable
                key={s}
                onPress={() => void changeStatus(s)}
                disabled={busy || lead.status === s}
                style={({ pressed }) => [
                  styles.statusChip,
                  lead.status === s && styles.statusChipActive,
                  pressed && { opacity: 0.7 },
                  busy && { opacity: 0.5 },
                ]}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    lead.status === s && styles.statusChipTextActive,
                  ]}
                >
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <CardTitle>Compliance</CardTitle>
          <Row label="DNC" value={lead.dncFlag ? 'On' : 'Off'} tone={lead.dncFlag ? 'danger' : 'muted'} />
          {!lead.dncFlag ? (
            <Button variant="secondary" onPress={() => void toggleDnc()} busy={busy} style={{ marginTop: 8 }}>
              Mark Do-Not-Contact
            </Button>
          ) : (
            <Text style={styles.muted}>Removing DNC must be done from the web admin.</Text>
          )}
        </Card>

        <Card>
          <CardTitle>Activity</CardTitle>
          <Row
            label="Last contacted"
            value={lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : '—'}
          />
          <Row
            label="Followup due"
            value={lead.followupDueAt ? new Date(lead.followupDueAt).toLocaleString() : '—'}
          />
          <Row label="Created" value={new Date(lead.createdAt).toLocaleString()} />
          <Row label="Assigned to" value={lead.assignedTo?.name ?? '—'} />
          {lead.branch ? <Row label="Branch" value={lead.branch.name} /> : null}
        </Card>

        {lead.notes ? (
          <Card>
            <CardTitle>Notes</CardTitle>
            <Text style={styles.notes}>{lead.notes}</Text>
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
  linkBtn: {
    marginTop: 8,
    height: 40,
    borderRadius: 8,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBtnText: { color: C.text, fontWeight: '500', fontSize: 14 },
  statusGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  statusChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  statusChipText: { color: C.text, fontSize: 12, fontWeight: '600' },
  statusChipTextActive: { color: C.textOnPrimary },
  notes: { color: C.text, fontSize: 14, lineHeight: 20 },
  muted: { color: C.textMuted, fontSize: 12, marginTop: 8 },
});
