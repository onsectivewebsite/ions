'use client';
import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  CircleDollarSign,
  Phone,
  Save,
  User,
  XCircle,
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
import { useRealtime } from '../../../lib/realtime';
import { RetainerCard } from '../../../components/retainer/RetainerCard';
import { DocumentsCard } from '../../../components/documents/DocumentsCard';
import { LawyerReviewCard } from '../../../components/cases/LawyerReviewCard';
import { IrccLogCard } from '../../../components/cases/IrccLogCard';
import { PortalAccessCard } from '../../../components/cases/PortalAccessCard';

type CaseStatus =
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

type CaseRow = {
  id: string;
  caseType: string;
  status: CaseStatus;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  usiNumber: string | null;
  irccFileNumber: string | null;
  irccPortalDate: string | null;
  irccDecision: string | null;
  retainerApprovedAt: string | null;
  retainerSignedAt: string | null;
  documentsLockedAt: string | null;
  lawyerApprovedAt: string | null;
  submittedToIrccAt: string | null;
  completedAt: string | null;
  closedReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string;
    email: string | null;
    language: string | null;
  };
  lead: { id: string; firstName: string | null; lastName: string | null; phone: string | null; status: string } | null;
  lawyer: { id: string; name: string; email: string };
  filer: { id: string; name: string; email: string } | null;
  branch: { id: string; name: string } | null;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

type UserRow = { id: string; name: string; email: string; status: string; role?: { name: string } | null };
type Paged<T> = { items: T[]; total: number };

const NEXT_OPTIONS: Record<CaseStatus, CaseStatus[]> = {
  PENDING_RETAINER: ['PENDING_RETAINER_SIGNATURE', 'PENDING_DOCUMENTS'],
  PENDING_RETAINER_SIGNATURE: ['PENDING_DOCUMENTS'],
  PENDING_DOCUMENTS: ['PREPARING', 'PENDING_LAWYER_APPROVAL'],
  PREPARING: ['PENDING_LAWYER_APPROVAL'],
  PENDING_LAWYER_APPROVAL: ['PREPARING', 'SUBMITTED_TO_IRCC'],
  SUBMITTED_TO_IRCC: ['IN_REVIEW', 'COMPLETED'],
  IN_REVIEW: ['COMPLETED'],
  COMPLETED: [],
  WITHDRAWN: [],
  ABANDONED: [],
};

const STATUS_TONE: Record<CaseStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
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

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString();
}

export default function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [c, setCase] = useState<CaseRow | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const k = await rpcQuery<CaseRow>('cases.get', { id }, { token });
      setCase(k);
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
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Paged<UserRow>>('user.list', { page: 1 }, { token }).catch(
        () => ({ items: [], total: 0 }) as Paged<UserRow>,
      ),
    ])
      .then(([m, u]) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
        setUsers(u.items.filter((x) => x.status === 'ACTIVE'));
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useRealtime((ev) => {
    if (ev.type === 'case.status' && ev.caseId === id) void refresh();
  });

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

  if (!me || !c) {
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
  const subject =
    [c.client.firstName, c.client.lastName].filter(Boolean).join(' ') || c.client.phone;
  const token = (): string => getAccessToken() ?? '';
  const target = c.totalFeeCents ?? c.retainerFeeCents;
  const owed = target != null ? Math.max(0, target - c.amountPaidCents) : null;
  const lifecycle: Array<{ label: string; at: string | null }> = [
    { label: 'Created', at: c.createdAt },
    { label: 'Retainer approved (lawyer)', at: c.retainerApprovedAt },
    { label: 'Retainer signed (client)', at: c.retainerSignedAt },
    { label: 'Documents locked', at: c.documentsLockedAt },
    { label: 'Lawyer approved file', at: c.lawyerApprovedAt },
    { label: 'Submitted to IRCC', at: c.submittedToIrccAt },
    { label: 'Completed', at: c.completedAt },
  ];

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <Link
            href="/cases"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to cases
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{subject}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Badge tone={STATUS_TONE[c.status]}>{c.status.replaceAll('_', ' ')}</Badge>
                <Badge tone="neutral">{c.caseType.replace('_', ' ')}</Badge>
                {c.feesCleared ? <Badge tone="success">Fees cleared</Badge> : <Badge tone="warning">Outstanding</Badge>}
                {c.branch ? <span>· {c.branch.name}</span> : null}
              </div>
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

          {/* State transitions */}
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">Move to:</span>
              {NEXT_OPTIONS[c.status].length === 0 ? (
                <span className="text-xs text-[var(--color-text-muted)]">
                  Case is in a terminal state.
                </span>
              ) : (
                NEXT_OPTIONS[c.status].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      action(`Moved to ${s.replaceAll('_', ' ')}`, () =>
                        rpcMutation('cases.transition', { id, to: s }, { token: token() }),
                      )
                    }
                  >
                    {s.replaceAll('_', ' ')}
                  </Button>
                ))
              )}
              {!['COMPLETED', 'WITHDRAWN', 'ABANDONED'].includes(c.status) ? (
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt('Withdraw reason?');
                      if (!reason) return;
                      void action('Withdrawn', () =>
                        rpcMutation('cases.transition', { id, to: 'WITHDRAWN', reason }, { token: token() }),
                      );
                    }}
                  >
                    <XCircle size={14} /> Withdraw
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const reason = prompt('Abandon reason?');
                      if (!reason) return;
                      void action('Abandoned', () =>
                        rpcMutation('cases.transition', { id, to: 'ABANDONED', reason }, { token: token() }),
                      );
                    }}
                  >
                    Abandon
                  </Button>
                </div>
              ) : null}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <Card>
                <CardTitle>Client</CardTitle>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Row label="Name">{subject}</Row>
                  <Row label="Phone">
                    <span className="inline-flex items-center gap-1">
                      <Phone size={12} /> {c.client.phone}
                    </span>
                  </Row>
                  {c.client.email ? <Row label="Email">{c.client.email}</Row> : null}
                  {c.client.language ? <Row label="Language">{c.client.language}</Row> : null}
                  {c.lead ? (
                    <Row label="Lead">
                      <Link
                        href={`/leads/${c.lead.id}`}
                        className="text-[var(--color-primary)] hover:underline"
                      >
                        {[c.lead.firstName, c.lead.lastName].filter(Boolean).join(' ') ||
                          c.lead.phone ||
                          'Open lead'}
                      </Link>
                    </Row>
                  ) : null}
                </dl>
              </Card>

              {/* Retainer agreement (Phase 5.2) — auto-loads, exposes
                  approve/edit/sign actions appropriate to current state. */}
              <RetainerCard
                caseId={id}
                caseStatus={c.status}
                lawyer={c.lawyer}
                client={c.client}
                onChanged={refresh}
                onError={setError}
              />

              {/* Document collection (Phase 5.3) — staff upload + send public
                  link. Card only renders meaningfully once the case has moved
                  past retainer signature; before that, it shows a placeholder. */}
              <DocumentsCard
                caseId={id}
                caseStatus={c.status}
                clientPhone={c.client.phone}
                clientEmail={c.client.email}
                onError={setError}
              />

              {/* Lawyer review pane (Phase 5.4) — only renders at
                  PENDING_LAWYER_APPROVAL. Pre-flight checklist + attestation
                  approval that flips to SUBMITTED_TO_IRCC. */}
              <LawyerReviewCard
                caseId={id}
                caseStatus={c.status}
                lawyer={c.lawyer}
                onChanged={refresh}
                onError={setError}
              />

              {/* IRCC correspondence log (Phase 5.4) — visible after
                  submission, or whenever there's at least one entry. */}
              <IrccLogCard
                caseId={id}
                caseStatus={c.status}
                onChanged={refresh}
                onError={setError}
              />

              <Card>
                <CardTitle>Money</CardTitle>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <Row label="Retainer">{fmtMoney(c.retainerFeeCents)}</Row>
                  <Row label="Full file fee">{fmtMoney(c.totalFeeCents)}</Row>
                  <Row label="Paid to date">{fmtMoney(c.amountPaidCents)}</Row>
                  <Row label="Outstanding">{owed != null ? fmtMoney(owed) : '—'}</Row>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {c.feesCleared ? (
                    <Badge tone="success">Cleared</Badge>
                  ) : (
                    <Badge tone="warning">Unpaid</Badge>
                  )}
                  <span className="text-xs text-[var(--color-text-muted)]">
                    Hard rule: fees must clear before SUBMITTED_TO_IRCC.
                  </span>
                </div>
                <PaymentForm caseId={id} disabled={busy} onDone={refresh} onError={setError} />
              </Card>

              <Card>
                <CardTitle>IRCC</CardTitle>
                <IrccForm
                  caseId={id}
                  initial={{
                    usiNumber: c.usiNumber ?? '',
                    irccFileNumber: c.irccFileNumber ?? '',
                    irccPortalDate: c.irccPortalDate ?? '',
                    irccDecision: c.irccDecision ?? '',
                    totalFeeCents: c.totalFeeCents,
                    notes: c.notes ?? '',
                  }}
                  disabled={busy}
                  onSaved={() => action('Saved', async () => null)}
                  onError={setError}
                  onAfter={refresh}
                />
              </Card>

              <Card>
                <CardTitle>Lifecycle</CardTitle>
                <ul className="mt-3 space-y-2 text-sm">
                  {lifecycle.map((s) => (
                    <li key={s.label} className="flex items-center gap-3">
                      <CheckCircle2
                        size={14}
                        className={s.at ? 'text-[var(--color-success)]' : 'text-[var(--color-border)]'}
                      />
                      <span className={s.at ? '' : 'text-[var(--color-text-muted)]'}>
                        {s.label}
                      </span>
                      <span className="ml-auto text-xs text-[var(--color-text-muted)]">
                        {fmtDate(s.at)}
                      </span>
                    </li>
                  ))}
                </ul>
                {c.closedReason ? (
                  <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                    Closed reason: {c.closedReason}
                  </p>
                ) : null}
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardTitle>Assignments</CardTitle>
                <AssignmentForm
                  caseId={id}
                  users={users}
                  current={{ lawyerId: c.lawyer.id, filerId: c.filer?.id ?? null }}
                  onSaved={() => action('Reassigned', async () => null)}
                  onError={setError}
                  onAfter={refresh}
                />
              </Card>

              <PortalAccessCard
                clientId={c.client.id}
                clientEmail={c.client.email}
                onError={setError}
              />

              <Card>
                <CardTitle>Notes</CardTitle>
                {c.notes ? (
                  <p className="mt-2 whitespace-pre-line text-sm">{c.notes}</p>
                ) : (
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">No notes yet.</p>
                )}
              </Card>
            </div>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function PaymentForm({
  caseId,
  disabled,
  onDone,
  onError,
}: {
  caseId: string;
  disabled: boolean;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'card' | 'cash' | 'etransfer' | 'cheque' | 'invoice'>('card');
  const [busy, setBusy] = useState(false);

  async function record(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'cases.recordPayment',
        { id: caseId, amountCents: Math.round(Number(amount) * 100), method },
        { token: t },
      );
      setAmount('');
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Payment record failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={record} className="mt-4 flex items-end gap-2 border-t border-[var(--color-border-muted)] pt-3">
      <div className="flex-1">
        <Label htmlFor="amt">Record payment</Label>
        <Input
          id="amt"
          type="number"
          min={1}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="500"
        />
      </div>
      <select
        className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        value={method}
        onChange={(e) => setMethod(e.target.value as typeof method)}
      >
        <option value="card">Card</option>
        <option value="cash">Cash</option>
        <option value="etransfer">e-Transfer</option>
        <option value="cheque">Cheque</option>
        <option value="invoice">Invoice</option>
      </select>
      <Button type="submit" disabled={busy || disabled || !amount}>
        {busy ? <Spinner /> : <CircleDollarSign size={14} />} Record
      </Button>
    </form>
  );
}

function IrccForm({
  caseId,
  initial,
  disabled,
  onSaved,
  onError,
  onAfter,
}: {
  caseId: string;
  initial: {
    usiNumber: string;
    irccFileNumber: string;
    irccPortalDate: string;
    irccDecision: string;
    totalFeeCents: number | null;
    notes: string;
  };
  disabled: boolean;
  onSaved: () => void;
  onError: (m: string) => void;
  onAfter: () => Promise<void>;
}) {
  const [state, setState] = useState({
    usiNumber: initial.usiNumber,
    irccFileNumber: initial.irccFileNumber,
    irccPortalDate: initial.irccPortalDate ? initial.irccPortalDate.slice(0, 10) : '',
    irccDecision: initial.irccDecision,
    totalFee: initial.totalFeeCents != null ? (initial.totalFeeCents / 100).toString() : '',
    notes: initial.notes,
  });
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'cases.update',
        {
          id: caseId,
          usiNumber: state.usiNumber || null,
          irccFileNumber: state.irccFileNumber || null,
          irccPortalDate: state.irccPortalDate ? new Date(state.irccPortalDate).toISOString() : null,
          irccDecision: state.irccDecision || null,
          totalFeeCents: state.totalFee ? Math.round(Number(state.totalFee) * 100) : null,
          notes: state.notes || null,
        },
        { token: t },
      );
      onSaved();
      await onAfter();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>USI number</Label>
          <Input
            value={state.usiNumber}
            onChange={(e) => setState({ ...state, usiNumber: e.target.value })}
            className="font-mono"
          />
        </div>
        <div>
          <Label>IRCC file number</Label>
          <Input
            value={state.irccFileNumber}
            onChange={(e) => setState({ ...state, irccFileNumber: e.target.value })}
            className="font-mono"
          />
        </div>
        <div>
          <Label>Portal upload date</Label>
          <Input
            type="date"
            value={state.irccPortalDate}
            onChange={(e) => setState({ ...state, irccPortalDate: e.target.value })}
          />
        </div>
        <div>
          <Label>IRCC decision</Label>
          <select
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            value={state.irccDecision}
            onChange={(e) => setState({ ...state, irccDecision: e.target.value })}
          >
            <option value="">—</option>
            <option value="approved">Approved</option>
            <option value="refused">Refused</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="returned">Returned</option>
          </select>
        </div>
        <div className="col-span-2">
          <Label>Full file fee (CAD)</Label>
          <Input
            type="number"
            value={state.totalFee}
            onChange={(e) => setState({ ...state, totalFee: e.target.value })}
            placeholder="3500"
          />
        </div>
        <div className="col-span-2">
          <Label>Internal notes</Label>
          <textarea
            className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy || disabled}>
          {busy ? <Spinner /> : <Save size={14} />} Save IRCC fields
        </Button>
      </div>
    </div>
  );
}

function AssignmentForm({
  caseId,
  users,
  current,
  onSaved,
  onError,
  onAfter,
}: {
  caseId: string;
  users: UserRow[];
  current: { lawyerId: string; filerId: string | null };
  onSaved: () => void;
  onError: (m: string) => void;
  onAfter: () => Promise<void>;
}) {
  const [lawyerId, setLawyerId] = useState(current.lawyerId);
  const [filerId, setFilerId] = useState(current.filerId ?? '');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'cases.assign',
        {
          id: caseId,
          lawyerId: lawyerId || undefined,
          filerId: filerId === '' ? null : filerId,
        },
        { token: t },
      );
      onSaved();
      await onAfter();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div>
        <Label>Lawyer</Label>
        <select
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={lawyerId}
          onChange={(e) => setLawyerId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} {u.role?.name ? `· ${u.role.name}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label>Filer (optional)</Label>
        <select
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          value={filerId}
          onChange={(e) => setFilerId(e.target.value)}
        >
          <option value="">— Unassigned —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} {u.role?.name ? `· ${u.role.name}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner /> : <User size={14} />} Save assignments
        </Button>
      </div>
    </div>
  );
}
