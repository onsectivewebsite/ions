'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  Calendar,
  ClipboardList,
  Mail,
  MessageSquare,
  Phone,
  Save,
  UserCog,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';
import { IntakeForm, type IntakeField } from '../../../components/intake/IntakeForm';

type LeadStatus = 'NEW' | 'CONTACTED' | 'FOLLOWUP' | 'INTERESTED' | 'BOOKED' | 'CONVERTED' | 'LOST' | 'DNC';

type CallLog = { id: string; direction: string; status: string; durationSec: number | null; disposition: string | null; notes: string | null; startedAt: string; endedAt: string | null };
type SmsLog = { id: string; direction: string; body: string; status: string; createdAt: string };
type EmailLog = { id: string; subject: string; toEmail: string; status: string; createdAt: string };

type Lead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: LeadStatus;
  language: string | null;
  caseInterest: string | null;
  notes: string | null;
  dncFlag: boolean;
  consentMarketing: boolean;
  lastContactedAt: string | null;
  followupDueAt: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string; email: string } | null;
  branch: { id: string; name: string } | null;
  callLogs: CallLog[];
  smsLogs: SmsLog[];
  emailLogs: EmailLog[];
  cases: Array<{ id: string; status: string; caseType: string; createdAt: string }>;
  appointments: Array<{
    id: string;
    scheduledAt: string;
    status: string;
    outcome: string | null;
    kind: string;
    provider: { id: string; name: string };
  }>;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

type CandidateUser = { id: string; name: string; email: string; role: { name: string } };

const STATUS_TONE: Record<LeadStatus, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  NEW: 'info',
  CONTACTED: 'neutral',
  FOLLOWUP: 'warning',
  INTERESTED: 'success',
  BOOKED: 'success',
  CONVERTED: 'success',
  LOST: 'neutral',
  DNC: 'danger',
};

function fullName(l: Lead): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Unnamed lead';
}

function formatDuration(s: number | null): string {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

type TimelineEntry = {
  key: string;
  at: string;
  kind: 'call' | 'sms' | 'email' | 'created';
  label: string;
  detail: string;
};

function buildTimeline(lead: Lead): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const c of lead.callLogs) {
    entries.push({
      key: `c-${c.id}`,
      at: c.startedAt,
      kind: 'call',
      label: `${c.direction === 'outbound' ? 'Outbound' : 'Inbound'} call · ${formatDuration(c.durationSec)}${c.disposition ? ` · ${c.disposition}` : ''}`,
      detail: c.notes ?? '',
    });
  }
  for (const s of lead.smsLogs) {
    entries.push({
      key: `s-${s.id}`,
      at: s.createdAt,
      kind: 'sms',
      label: `${s.direction === 'outbound' ? 'SMS sent' : 'SMS received'}`,
      detail: s.body,
    });
  }
  for (const e of lead.emailLogs) {
    entries.push({
      key: `e-${e.id}`,
      at: e.createdAt,
      kind: 'email',
      label: `Email · ${e.subject}`,
      detail: `To: ${e.toEmail}`,
    });
  }
  entries.push({
    key: 'created',
    at: lead.createdAt,
    kind: 'created',
    label: `Lead created from ${lead.source}`,
    detail: '',
  });
  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return entries;
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const l = await rpcQuery<Lead>('lead.get', { id }, { token });
      setLead(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function action(label: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      await fn();
      setInfo(label);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !lead) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };
  const token = (): string => getAccessToken() ?? '';
  const timeline = buildTimeline(lead);

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <Link
            href="/leads"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to leads
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{fullName(lead)}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Badge tone="neutral">{lead.source}</Badge>
                {lead.language ? <span className="uppercase">{lead.language}</span> : null}
                {lead.caseInterest ? <span>· {lead.caseInterest.replace('_', ' ')}</span> : null}
                {lead.branch ? <span>· {lead.branch.name}</span> : null}
                <span>· created {new Date(lead.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[lead.status]}>{lead.status}</Badge>
              <select
                value={lead.status}
                onChange={(e) =>
                  action(`Status → ${e.target.value}`, () =>
                    rpcMutation(
                      'lead.changeStatus',
                      { id, status: e.target.value },
                      { token: token() },
                    ),
                  )
                }
                disabled={busy}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="FOLLOWUP">Followup</option>
                <option value="INTERESTED">Interested</option>
                <option value="BOOKED">Booked</option>
                <option value="CONVERTED">Converted</option>
                <option value="LOST">Lost</option>
                <option value="DNC">Do not call</option>
              </select>
            </div>
          </div>

          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {/* Action bar */}
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!lead.phone || lead.dncFlag}
                title={
                  lead.dncFlag
                    ? 'Lead is Do Not Call'
                    : !lead.phone
                      ? 'No phone on file'
                      : 'Place a call via Twilio'
                }
                onClick={() => setCallOpen(true)}
              >
                <Phone size={14} /> Call
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!lead.phone || lead.dncFlag}
                title={
                  lead.dncFlag
                    ? 'Lead is Do Not Call'
                    : !lead.phone
                      ? 'No phone on file'
                      : 'Send an SMS'
                }
                onClick={() => setSmsOpen(true)}
              >
                <MessageSquare size={14} /> SMS
              </Button>
              <Button variant="secondary" size="sm" disabled title="Email composer ships in a later slice">
                <Mail size={14} /> Email
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIntakeOpen(true)}
                title="Fill an intake form for this lead"
              >
                <ClipboardList size={14} /> Start intake
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setBookOpen(true)}
                title="Book a consultation for this lead"
              >
                <Calendar size={14} /> Book consult
              </Button>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setAssignOpen(true)}>
                  <UserCog size={14} /> Reassign
                </Button>
                {!lead.dncFlag ? (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm('Mark this lead as Do Not Call?')) return;
                      void action('Marked DNC', () =>
                        rpcMutation('lead.markDnc', { id }, { token: token() }),
                      );
                    }}
                  >
                    <Ban size={14} /> Mark DNC
                  </Button>
                ) : (
                  <Badge tone="danger">DNC — do not contact</Badge>
                )}
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            {/* Profile + notes */}
            <div className="space-y-6">
              <Card>
                <CardTitle>Profile</CardTitle>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <Row label="Phone">
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} className="hover:underline">
                        {lead.phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label="Email">
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="hover:underline">
                        {lead.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label="Last contacted">
                    {lead.lastContactedAt ? new Date(lead.lastContactedAt).toLocaleString() : '—'}
                  </Row>
                  <Row label="Followup due">
                    {lead.followupDueAt ? new Date(lead.followupDueAt).toLocaleString() : '—'}
                  </Row>
                  <Row label="Marketing consent">
                    {lead.consentMarketing ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>}
                  </Row>
                  <Row label="Branch">{lead.branch?.name ?? '—'}</Row>
                </dl>
                {lead.notes ? (
                  <div className="mt-4 border-t border-[var(--color-border-muted)] pt-4">
                    <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Notes</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{lead.notes}</p>
                  </div>
                ) : null}
              </Card>

              <Card>
                <CardTitle>Timeline ({timeline.length})</CardTitle>
                <ul className="mt-4 space-y-3">
                  {timeline.map((e) => (
                    <li key={e.key} className="flex gap-3 text-sm">
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]"></div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{e.label}</div>
                        {e.detail ? (
                          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{e.detail}</div>
                        ) : null}
                        <div className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
                          {new Date(e.at).toLocaleString()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardTitle>Assigned to</CardTitle>
                {lead.assignedTo ? (
                  <div className="mt-4 space-y-1">
                    <div className="text-sm font-medium">{lead.assignedTo.name}</div>
                    <a
                      href={`mailto:${lead.assignedTo.email}`}
                      className="text-xs text-[var(--color-text-muted)] hover:underline"
                    >
                      {lead.assignedTo.email}
                    </a>
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-[var(--color-warning)]">Unassigned</div>
                )}
                <Button size="sm" variant="ghost" className="mt-3" onClick={() => setAssignOpen(true)}>
                  <UserCog size={12} /> Change
                </Button>
              </Card>

              {lead.appointments.length > 0 ? (
                <Card>
                  <CardTitle>Appointments ({lead.appointments.length})</CardTitle>
                  <ul className="mt-3 space-y-2 text-xs">
                    {lead.appointments.map((a) => (
                      <li key={a.id}>
                        <div className="font-medium">
                          {new Date(a.scheduledAt).toLocaleString()}
                        </div>
                        <div className="text-[var(--color-text-muted)]">
                          {a.kind} · {a.provider.name} · {a.status}
                          {a.outcome ? ` · ${a.outcome}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {lead.cases.length > 0 ? (
                <Card>
                  <CardTitle>Linked cases ({lead.cases.length})</CardTitle>
                  <ul className="mt-3 space-y-2">
                    {lead.cases.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/cases/${c.id}`}
                          className="block rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-2 text-sm hover:bg-[var(--color-surface-muted)]"
                        >
                          <div className="font-medium">{c.caseType.replace('_', ' ')}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {c.status.replaceAll('_', ' ')} · {new Date(c.createdAt).toLocaleDateString()}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          </div>
        </div>

        {assignOpen ? (
          <ReassignDialog
            leadId={id}
            currentAssigneeId={lead.assignedTo?.id ?? null}
            onClose={() => setAssignOpen(false)}
            onSaved={async () => {
              setAssignOpen(false);
              setInfo('Lead reassigned.');
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {callOpen && lead.phone ? (
          <CallDialog
            leadId={id}
            leadName={fullName(lead)}
            toNumber={lead.phone}
            onClose={() => setCallOpen(false)}
            onSaved={async (msg) => {
              setCallOpen(false);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {smsOpen && lead.phone ? (
          <SmsDialog
            leadId={id}
            leadName={fullName(lead)}
            toNumber={lead.phone}
            onClose={() => setSmsOpen(false)}
            onSaved={async (msg) => {
              setSmsOpen(false);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {intakeOpen ? (
          <IntakeDialog
            leadId={id}
            initialCaseType={lead.caseInterest ?? null}
            initialValues={{
              first_name: lead.firstName ?? '',
              last_name: lead.lastName ?? '',
              phone: lead.phone ?? '',
              email: lead.email ?? '',
              language: lead.language ?? '',
            }}
            onClose={() => setIntakeOpen(false)}
            onSaved={async (msg) => {
              setIntakeOpen(false);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {bookOpen ? (
          <BookConsultDialog
            leadId={id}
            initialCaseType={lead.caseInterest ?? null}
            onClose={() => setBookOpen(false)}
            onSaved={async (msg) => {
              setBookOpen(false);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

// ─── Call modal ───────────────────────────────────────────────────────────

function CallDialog({
  leadId,
  leadName,
  toNumber,
  onClose,
  onSaved,
  onError,
}: {
  leadId: string;
  leadName: string;
  toNumber: string;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'in-call' | 'wrap-up'>('idle');
  const [callLogId, setCallLogId] = useState<string | null>(null);
  const [mode, setMode] = useState<'real' | 'dry-run'>('dry-run');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tickSec, setTickSec] = useState(0);
  const [disposition, setDisposition] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (phase !== 'in-call' || !startedAt) return;
    const t = setInterval(() => setTickSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  async function startCall(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ callLogId: string; mode: 'real' | 'dry-run' }>(
        'calls.start',
        { leadId, toNumber },
        { token },
      );
      setCallLogId(r.callLogId);
      setMode(r.mode);
      setStartedAt(Date.now());
      setPhase('in-call');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to place call');
    } finally {
      setBusy(false);
    }
  }

  async function endCall(): Promise<void> {
    if (!callLogId) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'calls.end',
        {
          callLogId,
          disposition: disposition || undefined,
          notes: notes || undefined,
          durationSec: tickSec,
        },
        { token },
      );
      await onSaved(`Call logged · ${formatDuration(tickSec)}${disposition ? ' · ' + disposition : ''}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save call');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-lg)]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {phase === 'idle' ? 'Place call' : phase === 'in-call' ? 'On call' : 'Wrap up'}
          </div>
          <div className="mt-0.5 text-sm font-medium">{leadName}</div>
          <div className="text-xs text-[var(--color-text-muted)]">{toNumber}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
        >
          <X size={14} />
        </button>
      </div>

      {phase === 'idle' ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-[var(--color-text-muted)]">
            Twilio dials {toNumber}. Click End &amp; save when the call ends — the disposition + notes
            attach to the lead timeline.
          </p>
          <Button onClick={startCall} disabled={busy} className="w-full">
            {busy ? <Spinner /> : <Phone size={14} />}
            Start call
          </Button>
        </div>
      ) : phase === 'in-call' ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-center">
            <div className="text-2xl font-mono">{formatDuration(tickSec)}</div>
            {mode === 'dry-run' ? (
              <div className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-warning)]">
                Twilio in dry-run — no actual call placed
              </div>
            ) : null}
          </div>
          <Button variant="danger" onClick={() => setPhase('wrap-up')} className="w-full">
            <X size={14} /> End call
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-[var(--color-text-muted)]">
            Duration: <span className="font-mono">{formatDuration(tickSec)}</span>
          </div>
          <div>
            <Label htmlFor="disp">Disposition</Label>
            <select
              id="disp"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              className="mt-1 h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            >
              <option value="">Choose…</option>
              <option value="interested">Interested</option>
              <option value="not_interested">Not interested</option>
              <option value="voicemail">Voicemail</option>
              <option value="callback">Callback later</option>
              <option value="wrong_number">Wrong number</option>
              <option value="dnc">Do not call (mark DNC)</option>
              <option value="booked">Booked appointment</option>
            </select>
          </div>
          <div>
            <Label htmlFor="cn">Notes</Label>
            <textarea
              id="cn"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
            />
          </div>
          <Button onClick={endCall} disabled={busy} className="w-full">
            {busy ? <Spinner /> : null}
            End &amp; save
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── SMS modal ────────────────────────────────────────────────────────────

function SmsDialog({
  leadId,
  leadName,
  toNumber,
  onClose,
  onSaved,
  onError,
}: {
  leadId: string;
  leadName: string;
  toNumber: string;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(): Promise<void> {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ mode: 'real' | 'dry-run' }>(
        'sms.send',
        { leadId, toNumber, body },
        { token },
      );
      await onSaved(r.mode === 'real' ? 'SMS sent.' : 'SMS logged (dry-run).');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to send SMS');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Send SMS to {leadName}</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 text-xs">
            To: <span className="font-mono">{toNumber}</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Message…"
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
            autoFocus
          />
          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>{body.length} chars · {Math.ceil(body.length / 160) || 1} segment{body.length > 160 ? 's' : ''}</span>
            <span>Standard rates apply</span>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={send} disabled={busy || !body.trim()}>
              {busy ? <Spinner /> : <MessageSquare size={14} />}
              Send
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function ReassignDialog({
  leadId,
  currentAssigneeId,
  onClose,
  onSaved,
  onError,
}: {
  leadId: string;
  currentAssigneeId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<CandidateUser[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(currentAssigneeId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<{ items: CandidateUser[] }>(
      'user.list',
      { page: 1, q: q || undefined },
      { token },
    )
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [q]);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('lead.assign', { id: leadId, userId: pickedId }, { token });
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Reassign lead</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search users…"
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-muted)]">
            {items === null ? (
              <Skeleton className="m-3 h-24" />
            ) : items.length === 0 ? (
              <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">
                No users found.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-border-muted)]">
                <li>
                  <button
                    type="button"
                    onClick={() => setPickedId(null)}
                    className={
                      'w-full px-3 py-2 text-left text-sm transition-colors ' +
                      (pickedId === null
                        ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]'
                        : 'hover:bg-[var(--color-surface-muted)]')
                    }
                  >
                    <span className="font-medium">Unassign</span>
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">Lead returns to the queue</span>
                  </button>
                </li>
                {items.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => setPickedId(u.id)}
                      className={
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ' +
                        (pickedId === u.id
                          ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]'
                          : 'hover:bg-[var(--color-surface-muted)]')
                      }
                    >
                      <div>
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{u.email}</div>
                      </div>
                      <Badge tone="neutral">{u.role.name}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || pickedId === currentAssigneeId}>
              {busy ? <Spinner /> : <Save size={14} />}
              Save
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Intake modal ─────────────────────────────────────────────────────────

type IntakeTemplate = {
  id: string;
  name: string;
  caseType: string;
  description: string | null;
  fieldsJson: IntakeField[];
};

function IntakeDialog({
  leadId,
  initialCaseType,
  initialValues,
  onClose,
  onSaved,
  onError,
}: {
  leadId: string;
  initialCaseType: string | null;
  initialValues: Record<string, unknown>;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [templates, setTemplates] = useState<IntakeTemplate[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = getAccessToken();
    rpcQuery<IntakeTemplate[]>('intakeTemplate.list', undefined, { token: t })
      .then((all) => {
        const active = all.filter((x) => x.fieldsJson && Array.isArray(x.fieldsJson));
        setTemplates(active);
        // Default to a template that matches the lead's caseInterest, if any.
        const match = initialCaseType
          ? active.find((x) => x.caseType === initialCaseType && x.fieldsJson.length > 0)
          : null;
        if (match) setPickedId(match.id);
        else if (active.length === 1) setPickedId(active[0]!.id);
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed to load templates'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked = templates?.find((t) => t.id === pickedId) ?? null;

  async function submit(values: Record<string, unknown>): Promise<void> {
    if (!picked) return;
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation('intake.submit', { templateId: picked.id, leadId, values }, { token: t });
      await onSaved('Intake submitted.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Start intake</h2>
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Close
          </button>
        </div>

        {templates === null ? (
          <Skeleton className="h-32" />
        ) : templates.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-4 text-sm text-[var(--color-text-muted)]">
            No intake templates yet. Ask a firm admin to create one in{' '}
            <Link
              href="/settings/intake-forms"
              className="text-[var(--color-primary)] hover:underline"
            >
              Settings → Intake forms
            </Link>
            .
          </div>
        ) : (
          <>
            <div className="mb-4">
              <label className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                Template
              </label>
              <select
                className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={pickedId ?? ''}
                onChange={(e) => setPickedId(e.target.value || null)}
              >
                <option value="">Select template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.caseType.replace('_', ' ')})
                  </option>
                ))}
              </select>
              {picked?.description ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">{picked.description}</p>
              ) : null}
            </div>

            {picked ? (
              <IntakeForm
                fields={picked.fieldsJson}
                initial={initialValues}
                busy={busy}
                onSubmit={submit}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Book consult dialog ──────────────────────────────────────────────────

type ProviderRow = {
  id: string;
  name: string;
  email: string;
  branchId: string | null;
  status: string;
  role?: { name: string } | null;
};

const KIND_OPTIONS = ['consultation', 'followup', 'document_review'] as const;
const CASE_OPTIONS = [
  '',
  'work_permit',
  'study_permit',
  'pr',
  'visitor_visa',
  'citizenship',
  'lmia',
  'other',
] as const;

function BookConsultDialog({
  leadId,
  initialCaseType,
  onClose,
  onSaved,
  onError,
}: {
  leadId: string;
  initialCaseType: string | null;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [providers, setProviders] = useState<ProviderRow[] | null>(null);
  const [providerId, setProviderId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('30');
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]>('consultation');
  const [caseType, setCaseType] = useState(initialCaseType ?? '');
  const [fee, setFee] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = getAccessToken();
    rpcQuery<{ items: ProviderRow[] }>('user.list', { page: 1 }, { token: t })
      .then((r) => {
        // Lawyers + consultants are the providers; fall back to all active users
        // if role names aren't returned by the list query.
        const eligible = r.items.filter((u) => u.status === 'ACTIVE');
        setProviders(eligible);
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed to load providers'));
    // Default the date picker to today.
    const now = new Date();
    setDate(now.toISOString().slice(0, 10));
    setTime('10:00');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(): Promise<void> {
    if (!providerId || !date || !time) {
      onError('Pick a provider and a date + time.');
      return;
    }
    const scheduledAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(scheduledAt.getTime())) {
      onError('Invalid date/time.');
      return;
    }
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'appointment.create',
        {
          leadId,
          providerId,
          scheduledAt: scheduledAt.toISOString(),
          durationMin: Number(duration) || 30,
          kind,
          caseType: caseType || undefined,
          feeCents: fee ? Math.round(Number(fee) * 100) : undefined,
          notes: notes || undefined,
        },
        { token: t },
      );
      await onSaved('Consultation booked.');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Booking failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Book consultation</h2>
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Close
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Provider</Label>
            {providers === null ? (
              <Skeleton className="h-10" />
            ) : (
              <select
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                <option value="">Select…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.email}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={5}
                max={480}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kind</Label>
              <select
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as (typeof KIND_OPTIONS)[number])}
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Case type</Label>
              <select
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={caseType}
                onChange={(e) => setCaseType(e.target.value)}
              >
                {CASE_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c ? c.replace('_', ' ') : 'None'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label>Consultation fee (CAD, optional)</Label>
            <Input
              type="number"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="100"
            />
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the provider should know before the consult."
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !providerId || !date || !time}>
              {busy ? <Spinner /> : <Calendar size={14} />}
              Book
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
