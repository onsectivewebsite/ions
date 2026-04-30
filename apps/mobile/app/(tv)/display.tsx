/**
 * Lobby TV display.
 *
 * Two-column landscape layout, dark theme, big readable type designed
 * for a wall-mounted screen 2-4 metres from a waiting client. Auto-polls
 * every 30 seconds; nothing on this screen needs sub-minute precision.
 *
 * Left column: today's appointments (chronological, "Now" / "Next up"
 * headline rows treated specially). Right column: recent walk-in /
 * arrival activity (fresh leads, ARRIVED appointments not started yet).
 *
 * Footer: firm name + branch + clock + small unpair affordance hidden in
 * the corner so a curious client doesn't accidentally unpair the TV.
 */
import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { rpcQuery, RpcError } from '../../src/shared/api';
import {
  getTvBranchId,
  getTvBranchName,
  getTvToken,
  setTvBranchId,
  setTvBranchName,
  setTvToken,
} from '../../src/shared/session';

type ApptStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

type Appt = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  kind: string;
  caseType: string | null;
  status: ApptStatus;
  provider: { id: string; name: string };
  client: { firstName: string | null; lastName: string | null } | null;
  lead: { firstName: string | null; lastName: string | null; phone: string | null } | null;
};

type Lead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  status: 'NEW' | 'CONTACTED' | 'FOLLOWUP' | 'INTERESTED' | 'BOOKED' | 'CONVERTED' | 'LOST' | 'DNC';
  source: string;
  caseInterest: string | null;
  createdAt: string;
};

type Me = { kind: 'firm'; tenant: { displayName: string } };

const POLL_MS = 30 * 1000;

function todayBounds(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
}

function nameOf(a: Appt): string {
  const c = a.client;
  if (c) return [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Client';
  const l = a.lead;
  if (l) return [l.firstName, l.lastName].filter(Boolean).join(' ') || l.phone || 'Lead';
  return 'No subject';
}

function leadName(l: Lead): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ') || 'New lead';
}

export default function DisplayScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [branchName, setBranchName] = useState<string>('');
  const [appts, setAppts] = useState<Appt[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const token = await getTvToken();
    const branchId = await getTvBranchId();
    if (!token || !branchId) {
      router.replace('/(tv)/sign-in');
      return;
    }
    try {
      const [m, a, l, name] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<Appt[]>(
          'appointment.list',
          { ...todayBounds(), branchId },
          { token },
        ),
        rpcQuery<{ items: Lead[]; total: number }>(
          'lead.list',
          { page: 1, status: 'NEW' },
          { token },
        ),
        getTvBranchName(),
      ]);
      setMe(m);
      setAppts(a);
      // Filter to today's leads — list returns the most recent regardless.
      const sinceMs = todayBounds().from;
      setLeads(l.items.filter((x) => x.createdAt >= sinceMs).slice(0, 10));
      setBranchName(name ?? '');
    } catch (err) {
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setTvToken(null);
        router.replace('/(tv)/sign-in');
        return;
      }
      setError(err instanceof RpcError ? err.message : 'Failed to load lobby');
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function unpair(): Promise<void> {
    Alert.alert('Unpair this TV?', 'This signs the TV out completely.', [
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

  if (!me) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  // Categorise appointments for the headline row.
  const upcoming = appts
    .filter((a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED' || a.status === 'ARRIVED')
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const inProgress = appts.find((a) => a.status === 'IN_PROGRESS');
  const nextUp = upcoming.find((a) => new Date(a.scheduledAt) > now) ?? upcoming[0];
  const headline = inProgress ?? nextUp ?? null;
  const headlineKind = inProgress ? 'In session' : nextUp ? 'Next up' : null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View>
          <Text style={styles.firm}>{me.tenant.displayName}</Text>
          <Text style={styles.branch}>{branchName || 'Lobby'}</Text>
        </View>
        <View style={styles.clockBox}>
          <Text style={styles.clock}>
            {now.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <Text style={styles.clockDate}>
            {now.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
        </View>
      </View>

      {headline ? (
        <View style={styles.headline}>
          <Text style={styles.headlineKind}>{headlineKind}</Text>
          <Text style={styles.headlineName}>{nameOf(headline)}</Text>
          <Text style={styles.headlineMeta}>
            {fmtTime(headline.scheduledAt)} · {headline.kind}
            {headline.caseType ? ` · ${headline.caseType.replace('_', ' ')}` : ''} · with {headline.provider.name}
          </Text>
        </View>
      ) : (
        <View style={styles.headlineQuiet}>
          <Text style={styles.headlineKind}>Quiet morning</Text>
          <Text style={styles.headlineName}>No appointments scheduled right now</Text>
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.col}>
          <Text style={styles.colTitle}>Today&apos;s appointments</Text>
          {appts.length === 0 ? (
            <Text style={styles.colEmpty}>Nothing on the calendar today.</Text>
          ) : (
            appts.slice(0, 8).map((a) => (
              <View
                key={a.id}
                style={[
                  styles.apptRow,
                  a.status === 'IN_PROGRESS' && styles.apptRowActive,
                  a.status === 'COMPLETED' && styles.apptRowMuted,
                ]}
              >
                <Text style={styles.apptTime}>{fmtTime(a.scheduledAt)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.apptName}>{nameOf(a)}</Text>
                  <Text style={styles.apptMeta}>
                    {a.provider.name} · {a.kind}
                    {a.caseType ? ` · ${a.caseType.replace('_', ' ')}` : ''}
                  </Text>
                </View>
                <View style={[styles.apptStatus, statusToneStyle(a.status)]}>
                  <Text style={styles.apptStatusText}>{a.status.replace('_', ' ')}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.col}>
          <Text style={styles.colTitle}>New today</Text>
          {leads.length === 0 ? (
            <Text style={styles.colEmpty}>No new leads yet today.</Text>
          ) : (
            leads.map((l) => (
              <View key={l.id} style={styles.leadRow}>
                <Text style={styles.leadName}>{leadName(l)}</Text>
                <Text style={styles.leadMeta}>
                  {l.source}
                  {l.caseInterest ? ` · ${l.caseInterest.replace('_', ' ')}` : ''}
                </Text>
                <Text style={styles.leadTime}>
                  {new Date(l.createdAt).toLocaleTimeString('en-CA', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          {error ? `⚠ ${error}` : 'Updated every 30 seconds'}
        </Text>
        <Pressable onPress={() => void unpair()} hitSlop={12}>
          <Text style={styles.footerUnpair}>·</Text>
        </Pressable>
      </View>
    </View>
  );
}

function statusToneStyle(s: ApptStatus) {
  switch (s) {
    case 'IN_PROGRESS':
    case 'ARRIVED':
      return styles.tonePrimary;
    case 'COMPLETED':
      return styles.toneSuccess;
    case 'CANCELLED':
    case 'NO_SHOW':
      return styles.toneDanger;
    default:
      return styles.toneNeutral;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A', padding: 32 },
  loadingRoot: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
  firm: { color: '#94a3b8', fontSize: 14, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  branch: { color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 4 },
  clockBox: { alignItems: 'flex-end' },
  clock: { color: '#fff', fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 60 },
  clockDate: { color: '#cbd5e1', fontSize: 14, marginTop: 4 },
  headline: {
    backgroundColor: 'rgba(181,19,43,0.16)',
    borderColor: '#B5132B',
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  headlineQuiet: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  headlineKind: { color: '#cbd5e1', fontSize: 14, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  headlineName: { color: '#fff', fontSize: 44, fontWeight: '800', marginTop: 8 },
  headlineMeta: { color: '#cbd5e1', fontSize: 18, marginTop: 8 },
  body: { flex: 1, flexDirection: 'row', gap: 24 },
  col: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    gap: 6,
  },
  colTitle: { color: '#94a3b8', fontSize: 14, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
  colEmpty: { color: '#64748b', fontSize: 16, textAlign: 'center', paddingVertical: 32 },
  apptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 16,
    borderBottomColor: '#334155',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  apptRowActive: { backgroundColor: 'rgba(181,19,43,0.18)', borderRadius: 8 },
  apptRowMuted: { opacity: 0.4 },
  apptTime: { color: '#fff', fontSize: 18, fontWeight: '700', width: 70, fontVariant: ['tabular-nums'] },
  apptName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  apptMeta: { color: '#cbd5e1', fontSize: 12, textTransform: 'capitalize', marginTop: 2 },
  apptStatus: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  apptStatusText: { color: '#fff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  tonePrimary: { backgroundColor: '#B5132B' },
  toneSuccess: { backgroundColor: '#15803D' },
  toneNeutral: { backgroundColor: '#475569' },
  toneDanger: { backgroundColor: '#7f1d1d' },
  leadRow: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomColor: '#334155',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leadName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  leadMeta: { color: '#cbd5e1', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  leadTime: { color: '#94a3b8', fontSize: 11, marginTop: 2, fontVariant: ['tabular-nums'] },
  footer: { marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerHint: { color: '#475569', fontSize: 11 },
  footerUnpair: { color: '#1e293b', fontSize: 32, fontWeight: '700', paddingHorizontal: 8 },
});
