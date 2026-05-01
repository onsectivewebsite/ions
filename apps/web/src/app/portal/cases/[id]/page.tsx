'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Calendar, CalendarPlus, CheckCircle2, ClipboardCheck, FileText, X } from 'lucide-react';
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
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getPortalToken } from '../../../../lib/portal-session';
import { PortalShell } from '../../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type CaseDetail = {
  id: string;
  caseType: string;
  status: string;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  irccDecision: string | null;
  irccPortalDate: string | null;
  retainerApprovedAt: string | null;
  retainerSignedAt: string | null;
  documentsLockedAt: string | null;
  lawyerApprovedAt: string | null;
  submittedToIrccAt: string | null;
  completedAt: string | null;
  appointments: Array<{
    id: string;
    scheduledAt: string;
    durationMin: number;
    kind: string;
    caseType: string | null;
    status: string;
    outcome: string | null;
    provider: { name: string };
  }>;
  intake: Array<{ id: string; caseType: string; submittedAt: string; template: { name: string } }>;
  irccLog: Array<{ id: string; type: string; occurredAt: string }>;
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

const IRCC_LABELS: Record<string, string> = {
  submission: 'Submitted to IRCC',
  decision: 'Decision received',
  biometrics_requested: 'Biometrics requested',
  biometrics_completed: 'Biometrics completed',
  interview_scheduled: 'Interview scheduled',
  interview_completed: 'Interview completed',
  medical_requested: 'Medical exam requested',
  medical_completed: 'Medical exam completed',
};

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function PortalCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [c, setCase] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refetch(): Promise<void> {
    const token = getPortalToken();
    if (!token) return;
    try {
      const k = await rpcQuery<CaseDetail>('portal.caseDetail', { id }, { token });
      setCase(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('portal.me', undefined, { token }),
      rpcQuery<CaseDetail>('portal.caseDetail', { id }, { token }),
    ])
      .then(([m, k]) => {
        setMe(m);
        setCase(k);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, [router, id]);

  if (!me || !c) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        {error ? (
          <Card>
            <CardTitle>File unavailable</CardTitle>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{error}</p>
          </Card>
        ) : (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-64" />
          </>
        )}
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  const lifecycle: Array<{ label: string; at: string | null }> = [
    { label: 'Retainer approved', at: c.retainerApprovedAt },
    { label: 'Retainer signed', at: c.retainerSignedAt },
    { label: 'Documents submitted', at: c.documentsLockedAt },
    { label: 'Lawyer approved file', at: c.lawyerApprovedAt },
    { label: 'Submitted to IRCC', at: c.submittedToIrccAt },
    { label: 'Decision received', at: c.completedAt },
  ];
  const target = c.totalFeeCents ?? c.retainerFeeCents;
  const owed = target != null ? Math.max(0, target - c.amountPaidCents) : null;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-6">
          <Link
            href="/portal/dashboard"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to my files
          </Link>

          <div>
            <div className="text-xs text-[var(--color-text-muted)]">{c.caseType.replace('_', ' ')}</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your file</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status.replaceAll('_', ' ')}</Badge>
              {c.feesCleared ? <Badge tone="success">Fees cleared</Badge> : <Badge tone="warning">Fees outstanding</Badge>}
              {c.irccDecision ? <Badge tone="success">Decision: {c.irccDecision}</Badge> : null}
            </div>
          </div>

          <Link
            href={`/portal/cases/${id}/documents`}
            className="block"
          >
            <Card>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-[var(--color-primary)]" />
                  <div>
                    <CardTitle>Documents</CardTitle>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {c.documentsLockedAt
                        ? 'Submitted — click to review what you uploaded.'
                        : 'Upload the documents your firm has requested.'}
                    </p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
              </div>
            </Card>
          </Link>

          <Card>
            <CardTitle>Progress</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {lifecycle.map((s) => (
                <li key={s.label} className="flex items-center gap-3">
                  <CheckCircle2
                    size={14}
                    className={s.at ? 'text-[var(--color-success)]' : 'text-[var(--color-border)]'}
                  />
                  <span className={s.at ? '' : 'text-[var(--color-text-muted)]'}>{s.label}</span>
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">{fmtDate(s.at)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle>Fees</CardTitle>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Row label="Retainer">{fmtMoney(c.retainerFeeCents)}</Row>
              <Row label="Total fee">{fmtMoney(c.totalFeeCents)}</Row>
              <Row label="Paid">{fmtMoney(c.amountPaidCents)}</Row>
              <Row label="Outstanding">{owed != null ? fmtMoney(owed) : '—'}</Row>
            </dl>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Files are not submitted to IRCC until all fees are cleared. Contact your firm if you
              need to discuss payment.
            </p>
          </Card>

          {c.irccFileNumber || c.irccPortalDate ? (
            <Card>
              <CardTitle>IRCC reference</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                {c.irccFileNumber ? <Row label="IRCC file #">{c.irccFileNumber}</Row> : null}
                {c.irccPortalDate ? <Row label="Submitted">{fmtDate(c.irccPortalDate)}</Row> : null}
              </dl>
            </Card>
          ) : null}

          <AppointmentsCard caseId={c.id} appointments={c.appointments} onChanged={refetch} />


          {c.irccLog.length > 0 ? (
            <Card>
              <CardTitle>IRCC milestones</CardTitle>
              <ul className="mt-3 space-y-2 text-sm">
                {c.irccLog.map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <Calendar size={12} className="text-[var(--color-text-muted)]" />
                      {IRCC_LABELS[e.type] ?? e.type.replaceAll('_', ' ')}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(e.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {c.intake.length > 0 ? (
            <Card>
              <CardTitle>Intake on file</CardTitle>
              <ul className="mt-3 space-y-2 text-sm">
                {c.intake.map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <ClipboardCheck size={12} className="text-[var(--color-text-muted)]" />
                      {i.template.name}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(i.submittedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </PortalShell>
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

type ApptRow = CaseDetail['appointments'][number];

function AppointmentsCard({
  caseId,
  appointments,
  onChanged,
}: {
  caseId: string;
  appointments: ApptRow[];
  onChanged: () => Promise<void>;
}) {
  // dialog state: 'request' for a brand-new ask, or { mode: 'reschedule', appt }
  // to move an existing one. Same date-time picker drives both.
  const [dialog, setDialog] = useState<
    | { mode: 'request' }
    | { mode: 'reschedule'; appt: ApptRow }
    | null
  >(null);

  const upcoming = appointments.filter(
    (a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED',
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Appointments</CardTitle>
        <Button size="sm" onClick={() => setDialog({ mode: 'request' })}>
          <CalendarPlus size={14} /> Request a time
        </Button>
      </div>

      {appointments.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          No appointments yet. Click <span className="font-medium">Request a time</span> to
          propose a slot for a follow-up. Your firm confirms by email.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
          {appointments.map((a) => {
            const canEdit = a.status === 'SCHEDULED' || a.status === 'CONFIRMED';
            return (
              <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {new Date(a.scheduledAt).toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    {a.kind} · {a.provider.name} · {a.durationMin} min
                  </div>
                </div>
                <div className="flex items-center gap-2 sm:shrink-0">
                  <Badge tone={a.status === 'COMPLETED' ? 'success' : 'neutral'}>
                    {a.status}
                  </Badge>
                  {canEdit ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ mode: 'reschedule', appt: a })}
                      >
                        Reschedule
                      </Button>
                      <CancelButton id={a.id} onChanged={onChanged} />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {upcoming.length === 0 && appointments.length > 0 ? (
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">
          No upcoming bookings — request another consultation any time.
        </div>
      ) : null}

      {dialog ? (
        <BookingDialog
          caseId={caseId}
          mode={dialog.mode}
          existingAppt={dialog.mode === 'reschedule' ? dialog.appt : undefined}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

function CancelButton({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function cancel(): Promise<void> {
    if (!confirm('Cancel this appointment? Your firm will be notified.')) return;
    setBusy(true);
    try {
      const token = getPortalToken();
      await rpcMutation('portal.cancelAppointment', { id }, { token });
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>
      {busy ? <Spinner /> : <X size={12} />} Cancel
    </Button>
  );
}

function BookingDialog({
  caseId,
  mode,
  existingAppt,
  onClose,
  onSaved,
}: {
  caseId: string;
  mode: 'request' | 'reschedule';
  existingAppt?: ApptRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [when, setWhen] = useState<string>(() => {
    // Default: tomorrow at 10am (or the existing appt's time on reschedule).
    if (existingAppt) {
      const d = new Date(existingAppt.scheduledAt);
      // Convert to local-iso-without-tz for <input type="datetime-local">.
      const pad = (n: number): string => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
        d.getHours(),
      )}:${pad(d.getMinutes())}`;
    }
    const t = new Date(Date.now() + 24 * 60 * 60 * 1000);
    t.setHours(10, 0, 0, 0);
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T10:00`;
  });
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const token = getPortalToken();
      const iso = new Date(when).toISOString();
      if (mode === 'request') {
        await rpcMutation(
          'portal.requestAppointment',
          { caseId, scheduledAt: iso, durationMin: duration, notes: notes || undefined },
          { token },
        );
      } else if (existingAppt) {
        await rpcMutation(
          'portal.rescheduleAppointment',
          { id: existingAppt.id, scheduledAt: iso },
          { token },
        );
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>
            {mode === 'request' ? 'Request a consultation time' : 'Reschedule appointment'}
          </CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          {mode === 'request'
            ? 'Pick a date and time that works for you. Your firm will confirm by email or message you on the portal if they need to suggest a different slot.'
            : 'Pick a new time. Your firm will be notified to re-confirm.'}
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <Label htmlFor="when">Date &amp; time</Label>
            <Input
              id="when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          {mode === 'request' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Duration</Label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={45}>45 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>
          ) : null}
          {mode === 'request' ? (
            <div>
              <Label htmlFor="notes">Anything to flag for your lawyer?</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. follow-up about the police certificate request"
                className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
                maxLength={2000}
              />
            </div>
          ) : null}
          {err ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
              {err}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[var(--color-border-muted)] pt-3">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : <CalendarPlus size={14} />}{' '}
              {mode === 'request' ? 'Send request' : 'Save new time'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
