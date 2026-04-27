'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type IrccType =
  | 'submission'
  | 'rfe_received'
  | 'rfe_responded'
  | 'biometrics_requested'
  | 'biometrics_completed'
  | 'interview_scheduled'
  | 'interview_completed'
  | 'medical_requested'
  | 'medical_completed'
  | 'decision'
  | 'other';

type IrccEvent = {
  id: string;
  type: IrccType;
  occurredAt: string;
  notes: string | null;
  attachmentUploadId: string | null;
  recordedById: string;
  createdAt: string;
};

const TYPE_OPTIONS: Array<{ value: IrccType; label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = [
  { value: 'submission', label: 'Submission', tone: 'success' },
  { value: 'rfe_received', label: 'RFE received', tone: 'warning' },
  { value: 'rfe_responded', label: 'RFE responded', tone: 'success' },
  { value: 'biometrics_requested', label: 'Biometrics requested', tone: 'neutral' },
  { value: 'biometrics_completed', label: 'Biometrics completed', tone: 'success' },
  { value: 'interview_scheduled', label: 'Interview scheduled', tone: 'neutral' },
  { value: 'interview_completed', label: 'Interview completed', tone: 'success' },
  { value: 'medical_requested', label: 'Medical requested', tone: 'neutral' },
  { value: 'medical_completed', label: 'Medical completed', tone: 'success' },
  { value: 'decision', label: 'Decision', tone: 'success' },
  { value: 'other', label: 'Other', tone: 'neutral' },
];

const TYPE_TONE = new Map(TYPE_OPTIONS.map((o) => [o.value, o.tone]));
const TYPE_LABEL = new Map(TYPE_OPTIONS.map((o) => [o.value, o.label]));

export function IrccLogCard({
  caseId,
  caseStatus,
  onChanged,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [items, setItems] = useState<IrccEvent[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<IrccEvent[]>('cases.irccList', { caseId }, { token });
      setItems(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load IRCC log');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function remove(id: string): Promise<void> {
    if (!confirm('Delete this IRCC entry? This cannot be undone.')) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('cases.irccDelete', { id }, { token });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  // Only meaningful once the file has been submitted, but staff may want to
  // pre-record a submission in advance — render whenever the case is in
  // SUBMITTED_TO_IRCC, IN_REVIEW, or COMPLETED, and also on any pre-submit
  // status if there's already at least one entry (e.g. notes about the prep).
  const showCard =
    caseStatus === 'SUBMITTED_TO_IRCC' ||
    caseStatus === 'IN_REVIEW' ||
    caseStatus === 'COMPLETED' ||
    (items?.length ?? 0) > 0;
  if (!showCard) return null;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>IRCC log</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd((s) => !s)}>
          <Plus size={12} /> Add entry
        </Button>
      </div>

      {showAdd ? (
        <AddEntryForm
          caseId={caseId}
          onClose={() => setShowAdd(false)}
          onSaved={async () => {
            setShowAdd(false);
            await load();
            await onChanged();
          }}
          onError={onError}
        />
      ) : null}

      {items === null ? (
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
          <Building2 size={20} className="mx-auto mb-2 opacity-40" />
          No IRCC events recorded yet.
        </div>
      ) : (
        <ol className="mt-3 space-y-3">
          {items.map((e) => (
            <li
              key={e.id}
              className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={TYPE_TONE.get(e.type) ?? 'neutral'}>
                    {TYPE_LABEL.get(e.type) ?? e.type}
                  </Badge>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {new Date(e.occurredAt).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => void remove(e.id)}
                  disabled={busy}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                  aria-label="Delete entry"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {e.notes ? (
                <p className="mt-2 whitespace-pre-line text-sm">{e.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function AddEntryForm({
  caseId,
  onClose,
  onSaved,
  onError,
}: {
  caseId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState<IrccType>('rfe_received');
  const [occurredAt, setOccurredAt] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 16);
  });
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<'approved' | 'refused' | 'withdrawn' | 'returned' | ''>('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'cases.irccRecord',
        {
          caseId,
          type,
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes || undefined,
          decision: type === 'decision' && decision ? decision : undefined,
        },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Type</Label>
          <select
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as IrccType)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Occurred at</Label>
          <Input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            required
          />
        </div>
        {type === 'decision' ? (
          <div className="md:col-span-2">
            <Label>Decision</Label>
            <select
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              value={decision}
              onChange={(e) => setDecision(e.target.value as typeof decision)}
              required
            >
              <option value="">Select…</option>
              <option value="approved">Approved</option>
              <option value="refused">Refused</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="returned">Returned</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Recording a decision auto-completes the case.
            </p>
          </div>
        ) : null}
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <textarea
            className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. RFE letter requests proof of funds; response due 2026-05-15."
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy || (type === 'decision' && !decision)}>
          {busy ? <Spinner /> : null} Save entry
        </Button>
      </div>
    </form>
  );
}
