'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, FileSignature, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type Readiness = {
  retainerSigned: boolean;
  feesCleared: boolean;
  feesTarget: number | null;
  feesPaid: number;
  documentsLocked: boolean;
  documentsCollectionExists: boolean;
  missingRequired: Array<{ key: string; label: string }>;
  readyForApproval: boolean;
  viewerIsAssignedLawyer: boolean;
};

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function CheckRow({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 size={14} className="mt-0.5 text-[var(--color-success)]" />
      ) : (
        <XCircle size={14} className="mt-0.5 text-[var(--color-warning)]" />
      )}
      <div className="flex-1">
        <div className="text-sm">{label}</div>
        {detail ? (
          <div className="text-xs text-[var(--color-text-muted)]">{detail}</div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Lawyer review pane shown when case is in PENDING_LAWYER_APPROVAL.
 * Pre-flight checklist + Approve form (typed-name attestation, mirrors
 * the retainer pattern) + Request-revision flow back to PREPARING.
 */
export function LawyerReviewCard({
  caseId,
  caseStatus,
  lawyer,
  onChanged,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  lawyer: { id: string; name: string };
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [typedName, setTypedName] = useState('');
  const [attested, setAttested] = useState(false);
  const [portalDate, setPortalDate] = useState<string>('');
  const [revisionNotes, setRevisionNotes] = useState('');
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<Readiness>('cases.reviewReadiness', { id: caseId }, { token });
      setReadiness(r);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load readiness');
    }
  }

  useEffect(() => {
    if (caseStatus !== 'PENDING_LAWYER_APPROVAL') return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, caseStatus]);

  if (caseStatus !== 'PENDING_LAWYER_APPROVAL') return null;
  if (!readiness) {
    return (
      <Card>
        <CardTitle>Lawyer review</CardTitle>
        <div className="mt-2 text-xs text-[var(--color-text-muted)]">Loading readiness…</div>
      </Card>
    );
  }

  async function approve(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'cases.lawyerApprove',
        {
          id: caseId,
          typedName,
          attestation: true,
          irccPortalDate: portalDate ? new Date(portalDate).toISOString() : undefined,
        },
        { token },
      );
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  }

  async function reject(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'cases.requestRevision',
        { id: caseId, notes: revisionNotes },
        { token },
      );
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Revision failed');
    } finally {
      setBusy(false);
    }
  }

  const feesDetail =
    readiness.feesTarget == null
      ? 'No fee target set'
      : `${fmtMoney(readiness.feesPaid)} of ${fmtMoney(readiness.feesTarget)} paid`;

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Lawyer review</CardTitle>
        <Badge tone={readiness.readyForApproval ? 'success' : 'warning'}>
          {readiness.readyForApproval ? 'Ready for approval' : 'Not ready'}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Confirm every gate below before approving. Approval submits the file to IRCC and is
        recorded with your typed name + IP for the case audit.
      </p>

      <ul className="mt-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3">
        <CheckRow
          ok={readiness.retainerSigned}
          label="Retainer signed by client"
          detail={readiness.retainerSigned ? 'In-house signature recorded' : 'Client has not signed yet'}
        />
        <CheckRow
          ok={readiness.feesCleared}
          label="Fees cleared"
          detail={feesDetail}
        />
        <CheckRow
          ok={readiness.documentsLocked}
          label="Document collection locked"
          detail={
            readiness.documentsCollectionExists
              ? readiness.documentsLocked
                ? 'Client submitted'
                : 'Collection still open — locks on client submit'
              : 'Collection not initialised'
          }
        />
        <CheckRow
          ok={readiness.missingRequired.length === 0}
          label="All required documents uploaded"
          detail={
            readiness.missingRequired.length === 0
              ? `${readiness.missingRequired.length === 0 ? 'OK' : 'Missing'}`
              : `Missing: ${readiness.missingRequired.map((m) => m.label).join(', ')}`
          }
        />
      </ul>

      {!readiness.viewerIsAssignedLawyer ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]">
          Only the assigned lawyer ({lawyer.name}) can approve or request revisions on this file.
        </div>
      ) : (
        <>
          {/* Approve form */}
          <form
            onSubmit={approve}
            className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Approve and submit to IRCC
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <Label>Typed name</Label>
                <Input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={lawyer.name}
                  required
                />
              </div>
              <div>
                <Label>IRCC portal upload date</Label>
                <Input
                  type="datetime-local"
                  value={portalDate}
                  onChange={(e) => setPortalDate(e.target.value)}
                />
              </div>
            </div>
            <label className="mt-3 inline-flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={attested}
                onChange={(e) => setAttested(e.target.checked)}
              />
              I have personally reviewed the assembled file, fees are cleared, the retainer is
              signed, and I am uploading this submission to IRCC.
            </label>
            <div className="mt-3 flex justify-end">
              <Button
                type="submit"
                disabled={
                  busy ||
                  !typedName ||
                  !attested ||
                  !readiness.readyForApproval ||
                  !readiness.viewerIsAssignedLawyer
                }
              >
                {busy ? <Spinner /> : <ShieldCheck size={14} />}
                Approve &amp; submit
              </Button>
            </div>
          </form>

          {/* Request revision */}
          {!showRevisionForm ? (
            <div className="mt-3 flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowRevisionForm(true)}
                disabled={busy}
              >
                <RotateCcw size={12} /> Request revision (back to PREPARING)
              </Button>
            </div>
          ) : (
            <form
              onSubmit={reject}
              className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Send back to filer
              </div>
              <textarea
                className="mt-2 min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
                value={revisionNotes}
                onChange={(e) => setRevisionNotes(e.target.value)}
                placeholder="What needs to change before this is ready?"
                required
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" type="button" onClick={() => setShowRevisionForm(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="danger"
                  disabled={busy || revisionNotes.trim().length < 2}
                >
                  {busy ? <Spinner /> : <FileSignature size={12} />} Send back
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </Card>
  );
}
