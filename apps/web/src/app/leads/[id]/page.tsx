'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  Calendar,
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

          {/* Action bar — call/sms/email are stubbed for slice 3.3 */}
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled
                title="Twilio integration ships in slice 3.3"
              >
                <Phone size={14} /> Call
              </Button>
              <Button variant="secondary" size="sm" disabled title="Slice 3.3">
                <MessageSquare size={14} /> SMS
              </Button>
              <Button variant="secondary" size="sm" disabled title="Slice 3.3">
                <Mail size={14} /> Email
              </Button>
              <Button variant="secondary" size="sm" disabled title="Slice 4 (intake + appointments)">
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
      </AppShell>
    </ThemeProvider>
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
