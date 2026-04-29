'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Phone, Sparkles, User, X } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

export type Appointment = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  kind: string;
  caseType: string | null;
  status:
    | 'SCHEDULED'
    | 'CONFIRMED'
    | 'ARRIVED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  feeCents: number | null;
  paidAt: string | null;
  outcome: 'RETAINER' | 'FOLLOWUP' | 'DONE' | 'NO_SHOW' | null;
  outcomeNotes: string | null;
  retainerFeeCents: number | null;
  notes: string | null;
  aiSummary: string | null;
  aiSummarizedAt: string | null;
  aiSummaryMode: 'real' | 'dry-run' | null;
  provider: { id: string; name: string; email: string };
  client: { id: string; firstName: string | null; lastName: string | null; phone: string } | null;
  lead: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    status: string;
  } | null;
};

const STATUS_TONE: Record<Appointment['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'success',
  ARRIVED: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

// Per-status forward transitions allowed from the UI. Mirrors server NEXT map.
const NEXT_OPTIONS: Record<Appointment['status'], Array<Appointment['status']>> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'IN_PROGRESS', 'NO_SHOW'],
  ARRIVED: ['IN_PROGRESS', 'COMPLETED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export function AppointmentDetail({
  appt,
  onClose,
  onChanged,
  onError,
}: {
  appt: Appointment;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function transition(to: Appointment['status']): Promise<void> {
    if (
      to === 'NO_SHOW' &&
      !confirm('Mark this appointment as a no-show? This is a terminal state.')
    )
      return;
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation('appointment.transition', { id: appt.id, to }, { token: t });
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    const reason = prompt('Cancel reason?') ?? '';
    if (!reason) return;
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'appointment.transition',
        { id: appt.id, to: 'CANCELLED', reason },
        { token: t },
      );
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {appt.kind} {appt.caseType ? `· ${appt.caseType.replace('_', ' ')}` : null}
            </div>
            <h2 className="mt-1 text-lg font-semibold">
              {new Date(appt.scheduledAt).toLocaleString()}
            </h2>
          </div>
          <button onClick={onClose} className="text-[var(--color-text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[appt.status]}>{appt.status}</Badge>
          {appt.outcome ? <Badge tone="success">{appt.outcome}</Badge> : null}
          <Badge tone="neutral">{appt.durationMin} min</Badge>
          <Badge tone="neutral">{fmtMoney(appt.feeCents)}</Badge>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <Row label="Provider">
            <span className="inline-flex items-center gap-1">
              <User size={12} /> {appt.provider.name}
            </span>
          </Row>
          {appt.lead ? (
            <Row label="Lead">
              <Link
                href={`/leads/${appt.lead.id}`}
                className="text-[var(--color-primary)] hover:underline"
              >
                {[appt.lead.firstName, appt.lead.lastName].filter(Boolean).join(' ') || appt.lead.phone}
              </Link>
              <Badge tone="neutral">{appt.lead.status}</Badge>
            </Row>
          ) : null}
          {appt.client ? (
            <Row label="Client">
              <span>
                {[appt.client.firstName, appt.client.lastName].filter(Boolean).join(' ') || appt.client.phone}
              </span>
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <Phone size={10} /> {appt.client.phone}
              </span>
            </Row>
          ) : null}
          {appt.arrivedAt ? (
            <Row label="Arrived">
              <span className="inline-flex items-center gap-1">
                <Clock size={12} /> {new Date(appt.arrivedAt).toLocaleTimeString()}
              </span>
            </Row>
          ) : null}
          {appt.completedAt ? (
            <Row label="Completed">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={12} /> {new Date(appt.completedAt).toLocaleTimeString()}
              </span>
            </Row>
          ) : null}
          {appt.cancelReason ? (
            <Row label="Cancel reason">
              <span className="text-[var(--color-text-muted)]">{appt.cancelReason}</span>
            </Row>
          ) : null}
        </dl>

        {appt.notes ? (
          <Card className="mt-4">
            <div className="text-xs text-[var(--color-text-muted)]">Notes</div>
            <p className="mt-1 text-sm whitespace-pre-line">{appt.notes}</p>
          </Card>
        ) : null}

        {NEXT_OPTIONS[appt.status].length > 0 ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-muted)] pt-4">
            <span className="text-xs text-[var(--color-text-muted)]">Move to:</span>
            {NEXT_OPTIONS[appt.status].map((s) => (
              <Button key={s} size="sm" variant="secondary" disabled={busy} onClick={() => transition(s)}>
                {s}
              </Button>
            ))}
            <Button size="sm" variant="danger" disabled={busy} onClick={cancel}>
              Cancel
            </Button>
          </div>
        ) : null}

        {(appt.status === 'IN_PROGRESS' || appt.status === 'COMPLETED' || appt.status === 'NO_SHOW') &&
        !appt.outcome ? (
          <OutcomeForm appt={appt} onChanged={onChanged} onError={onError} />
        ) : null}

        {appt.outcome ? (
          <Card className="mt-4">
            <CardTitle>Outcome — {appt.outcome}</CardTitle>
            {appt.outcome === 'RETAINER' ? (
              <p className="mt-2 text-sm">
                Retainer fee: <span className="font-medium">{fmtMoney(appt.retainerFeeCents)}</span>
              </p>
            ) : null}
            {appt.outcomeNotes ? (
              <p className="mt-2 whitespace-pre-line text-sm text-[var(--color-text-muted)]">
                {appt.outcomeNotes}
              </p>
            ) : null}
          </Card>
        ) : null}

        <ConsultSummaryCard appt={appt} />
      </div>
    </div>
  );
}

function ConsultSummaryCard({ appt }: { appt: Appointment }) {
  const [summary, setSummary] = useState<string | null>(appt.aiSummary);
  const [summaryAt, setSummaryAt] = useState<string | null>(appt.aiSummarizedAt);
  const [mode, setMode] = useState<'real' | 'dry-run' | null>(appt.aiSummaryMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const t = getAccessToken();
      const r = await rpcMutation<{
        aiSummary: string | null;
        aiSummarizedAt: string | null;
        aiSummaryMode: 'real' | 'dry-run' | null;
      }>('appointment.summarize', { id: appt.id }, { token: t });
      setSummary(r.aiSummary);
      setSummaryAt(r.aiSummarizedAt);
      setMode(r.aiSummaryMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Summary failed');
    } finally {
      setBusy(false);
    }
  }

  // Render only when there's something to summarize OR a summary exists.
  const eligible = summary != null || (appt.outcomeNotes ?? appt.notes ?? '').length >= 20;
  if (!eligible) return null;

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between">
        <CardTitle>AI summary</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => void regenerate()} disabled={busy}>
          {busy ? <Spinner /> : <Sparkles size={12} />}
          {summary ? 'Regenerate' : 'Generate'}
        </Button>
      </div>
      {error ? (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      {summary ? (
        <>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{summary}</pre>
          <div className="mt-2 text-[10px] text-[var(--color-text-muted)]">
            {summaryAt ? `Generated ${new Date(summaryAt).toLocaleString()}` : ''}
            {mode ? ` · ${mode}` : ''}
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          AI will turn the consultation notes into a structured brief — key facts, risks, action
          items, and outcome.
        </p>
      )}
    </Card>
  );
}

function OutcomeForm({
  appt,
  onChanged,
  onError,
}: {
  appt: Appointment;
  onChanged: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [outcome, setOutcome] = useState<'RETAINER' | 'FOLLOWUP' | 'DONE' | 'NO_SHOW'>('RETAINER');
  const [notes, setNotes] = useState('');
  const [retainerFee, setRetainerFee] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const t = getAccessToken();
      await rpcMutation(
        'appointment.recordOutcome',
        {
          id: appt.id,
          outcome,
          outcomeNotes: notes || undefined,
          retainerFeeCents:
            outcome === 'RETAINER' && retainerFee ? Math.round(Number(retainerFee) * 100) : undefined,
        },
        { token: t },
      );
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardTitle>Record outcome</CardTitle>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Closing the consult moves the linked lead to the matching pipeline state.
      </p>
      <div className="mt-3 space-y-3">
        <div>
          <Label>Outcome</Label>
          <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
            {(['RETAINER', 'FOLLOWUP', 'DONE', 'NO_SHOW'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setOutcome(v)}
                className={
                  'rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium ' +
                  (outcome === v
                    ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)]')
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        {outcome === 'RETAINER' ? (
          <div>
            <Label>Retainer fee (CAD)</Label>
            <Input
              type="number"
              value={retainerFee}
              onChange={(e) => setRetainerFee(e.target.value)}
              placeholder="2500"
            />
          </div>
        ) : null}
        <div>
          <Label>Notes</Label>
          <textarea
            className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was discussed, next steps, blockers…"
          />
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null} Save outcome
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
