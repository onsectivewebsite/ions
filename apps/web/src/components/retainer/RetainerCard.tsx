'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, FileSignature, RefreshCw, Save } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type RetainerStatus = 'DRAFT' | 'LAWYER_APPROVED' | 'SIGNED' | 'VOID';

type Agreement = {
  id: string;
  caseId: string;
  status: RetainerStatus;
  contentMd: string;
  approvedAt: string | null;
  approvedIp: string | null;
  approvedBy: { id: string; name: string; email: string } | null;
  signedName: string | null;
  signedAt: string | null;
  signedIp: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
};

const STATUS_TONE: Record<RetainerStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'warning',
  LAWYER_APPROVED: 'success',
  SIGNED: 'success',
  VOID: 'danger',
};

/**
 * Lawyer + client retainer flow on the case detail page. Auto-fetches
 * the agreement (server lazy-instantiates on first read), exposes
 * approve/edit/regenerate/sign actions according to current state.
 */
export function RetainerCard({
  caseId,
  caseStatus,
  lawyer,
  client,
  onChanged,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  lawyer: { id: string; name: string; email: string };
  client: { firstName: string | null; lastName: string | null; phone: string };
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [agreement, setAgreement] = useState<Agreement | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const a = await rpcQuery<Agreement | null>(
        'retainer.getForCase',
        { caseId },
        { token },
      );
      setAgreement(a);
      if (a?.contentMd) setEditContent(a.contentMd);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load retainer');
      setAgreement(null);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function regenerate(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('retainer.regenerate', { caseId }, { token });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Regenerate failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('retainer.editDraft', { caseId, contentMd: editContent }, { token });
      setEditing(false);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (agreement === undefined) {
    return (
      <Card>
        <CardTitle>Retainer agreement</CardTitle>
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</div>
      </Card>
    );
  }
  if (agreement === null) {
    return (
      <Card>
        <CardTitle>Retainer agreement</CardTitle>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          No retainer yet. The agreement is auto-drafted when the case enters PENDING_RETAINER.
        </p>
      </Card>
    );
  }

  const isDraft = agreement.status === 'DRAFT';
  const isApproved = agreement.status === 'LAWYER_APPROVED';

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle>Retainer agreement</CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[agreement.status]}>{agreement.status.replaceAll('_', ' ')}</Badge>
        </div>
      </div>

      {agreement.approvedAt ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <CheckCircle2 size={12} className="text-[var(--color-success)]" />
          Approved by {agreement.approvedBy?.name ?? 'lawyer'} ·{' '}
          {new Date(agreement.approvedAt).toLocaleString()}
          {agreement.approvedIp ? ` · ${agreement.approvedIp}` : ''}
        </div>
      ) : null}
      {agreement.signedAt ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <CheckCircle2 size={12} className="text-[var(--color-success)]" />
          Signed by {agreement.signedName} · {new Date(agreement.signedAt).toLocaleString()}
          {agreement.signedIp ? ` · ${agreement.signedIp}` : ''}
        </div>
      ) : null}

      {/* Body */}
      {editing ? (
        <textarea
          className="mt-4 min-h-[280px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-xs"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
        />
      ) : (
        <pre className="mt-4 max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 font-sans text-xs leading-relaxed">
          {agreement.contentMd}
        </pre>
      )}

      {/* DRAFT actions: edit, regenerate, lawyer approve */}
      {isDraft && caseStatus === 'PENDING_RETAINER' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => void saveEdit()}>
                {busy ? <Spinner /> : <Save size={14} />} Save edits
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void regenerate()}>
                <RefreshCw size={12} /> Re-render from template
              </Button>
            </>
          )}
        </div>
      ) : null}

      {isDraft && caseStatus === 'PENDING_RETAINER' && !editing ? (
        <LawyerApproveForm
          caseId={caseId}
          lawyer={lawyer}
          onAfter={async () => {
            await load();
            await onChanged();
          }}
          onError={onError}
        />
      ) : null}

      {/* LAWYER_APPROVED + case PENDING_RETAINER_SIGNATURE → client signs */}
      {isApproved && caseStatus === 'PENDING_RETAINER_SIGNATURE' ? (
        <ClientSignForm
          caseId={caseId}
          client={client}
          onAfter={async () => {
            await load();
            await onChanged();
          }}
          onError={onError}
        />
      ) : null}
    </Card>
  );
}

function LawyerApproveForm({
  caseId,
  lawyer,
  onAfter,
  onError,
}: {
  caseId: string;
  lawyer: { id: string; name: string };
  onAfter: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function approve(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'retainer.lawyerApprove',
        { caseId, typedName },
        { token },
      );
      await onAfter();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={approve}
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Lawyer approval
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Type your full name as it appears on file ({lawyer.name}) to attest the terms above. We
        record your timestamp and IP.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <Input
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder={lawyer.name}
          required
        />
        <Button type="submit" disabled={busy || !typedName || !confirmed}>
          {busy ? <Spinner /> : <FileSignature size={14} />} Approve
        </Button>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I have reviewed the retainer terms and approve them on behalf of the firm.
      </label>
    </form>
  );
}

function ClientSignForm({
  caseId,
  client,
  onAfter,
  onError,
}: {
  caseId: string;
  client: { firstName: string | null; lastName: string | null; phone: string };
  onAfter: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const initial = [client.firstName, client.lastName].filter(Boolean).join(' ');
  const [signedName, setSignedName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function sign(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('retainer.clientSign', { caseId, signedName }, { token });
      await onAfter();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Sign failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={sign}
      className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Client signature (in-house)
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Hand the device to the client. They type their full legal name to accept the terms above.
        Timestamp + IP are recorded as part of the signature.
      </p>
      <div className="mt-3">
        <Label>Client&apos;s typed name</Label>
        <Input value={signedName} onChange={(e) => setSignedName(e.target.value)} required />
      </div>
      <label className="mt-3 inline-flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        I have read, understood, and accept the terms of this retainer agreement.
      </label>
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={busy || !signedName || !acknowledged}>
          {busy ? <Spinner /> : <FileSignature size={14} />} Sign &amp; accept
        </Button>
      </div>
    </form>
  );
}
