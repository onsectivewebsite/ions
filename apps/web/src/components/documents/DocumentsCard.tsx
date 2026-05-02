'use client';
import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FileUp,
  Pencil,
  Plus,
  Sparkles,
  Lock,
  Mail,
  MessageSquare,
  Send,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Spinner,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type Upload = {
  id: string;
  itemKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedById: string | null;
  uploadedByName: string | null;
  createdAt: string;
  aiCategory: string | null;
  aiCategoryLabel: string | null;
  aiConfidence: number | null;
  aiClassifiedAt: string | null;
  aiClassifyMode: 'real' | 'dry-run' | null;
};

type Item = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
  uploads: Upload[];
  complete: boolean;
};

type Collection = {
  id: string;
  status: 'DRAFT' | 'SENT' | 'LOCKED' | 'UNLOCKED';
  sentAt: string | null;
  sentVia: string | null;
  publicTokenExpiresAt: string | null;
  submittedAt: string | null;
  lockedAt: string | null;
  unlockedAt: string | null;
  unlockReason: string | null;
  items: Item[];
  requiredCount: number;
  requiredDone: number;
};

const STATUS_TONE: Record<Collection['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'warning',
  SENT: 'warning',
  LOCKED: 'success',
  UNLOCKED: 'warning',
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function DocumentsCard({
  caseId,
  caseStatus,
  clientPhone,
  clientEmail,
  onError,
}: {
  caseId: string;
  caseStatus: string;
  clientPhone: string;
  clientEmail: string | null;
  onError: (m: string) => void;
}) {
  const [collection, setCollection] = useState<Collection | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [linkOnce, setLinkOnce] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<Collection | null>(
        'documentCollection.getForCase',
        { caseId },
        { token },
      );
      setCollection(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load documents');
      setCollection(null);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function send(via: 'sms' | 'email' | 'none'): Promise<void> {
    setBusy(true);
    setInfo(null);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ publicUrl: string; pushed: { ok: boolean; mode?: string; error?: string } }>(
        'documentCollection.send',
        { caseId, via, ttlDays: 14 },
        { token },
      );
      setLinkOnce(r.publicUrl);
      if (via === 'sms')
        setInfo(r.pushed.ok ? `SMS sent (mode: ${r.pushed.mode}).` : `SMS failed: ${r.pushed.error}`);
      else if (via === 'email')
        setInfo(r.pushed.ok ? 'Email sent.' : `Email failed: ${r.pushed.error}`);
      else setInfo('Public link generated. Copy it below.');
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  }

  async function unlock(): Promise<void> {
    const reason = prompt('Reason for unlocking?');
    if (!reason) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('documentCollection.unlock', { caseId, reason }, { token });
      setInfo('Unlocked. Client can upload again.');
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Unlock failed');
    } finally {
      setBusy(false);
    }
  }

  async function download(uploadId: string): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<{ url: string }>(
        'documentCollection.signedDownloadUrl',
        { uploadId },
        { token },
      );
      window.open(r.url, '_blank');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  if (collection === undefined) {
    return (
      <Card>
        <CardTitle>Documents</CardTitle>
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">Loading…</div>
      </Card>
    );
  }
  if (collection === null) {
    return (
      <Card>
        <CardTitle>Documents</CardTitle>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Document collection becomes available once the case enters PENDING_DOCUMENTS.
        </p>
      </Card>
    );
  }

  const isLocked = collection.status === 'LOCKED';
  const requiredOk = collection.requiredDone === collection.requiredCount;
  const [editOpen, setEditOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle>Documents</CardTitle>
        <Badge tone={STATUS_TONE[collection.status]}>{collection.status}</Badge>
      </div>
      <div className="mt-1 text-xs text-[var(--color-text-muted)]">
        {collection.requiredDone}/{collection.requiredCount} required items uploaded
        {collection.sentAt
          ? ` · link sent ${collection.sentVia ?? 'manually'} on ${new Date(collection.sentAt).toLocaleString()}`
          : ''}
        {collection.submittedAt
          ? ` · client submitted ${new Date(collection.submittedAt).toLocaleString()}`
          : ''}
      </div>

      {info ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-2 text-xs text-[var(--color-success)]">
          {info}
        </div>
      ) : null}

      {linkOnce ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-2 text-xs">
          <div className="text-[var(--color-text-muted)]">Public upload link (shown once):</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="break-all font-mono">{linkOnce}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(linkOnce);
                setInfo('Link copied.');
              }}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface)]"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
      ) : null}

      {/* Send link controls — visible until LOCKED */}
      {!isLocked ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--color-border-muted)] pt-3">
          <span className="text-xs text-[var(--color-text-muted)]">Send link:</span>
          <Button size="sm" variant="secondary" disabled={busy || !clientPhone} onClick={() => send('sms')}>
            <MessageSquare size={12} /> SMS
          </Button>
          <Button size="sm" variant="secondary" disabled={busy || !clientEmail} onClick={() => send('email')}>
            <Mail size={12} /> Email
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => send('none')}>
            <Send size={12} /> Generate link only
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} className="ml-auto" onClick={() => setEditOpen(true)}>
            <Pencil size={12} /> Edit items
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border-muted)] pt-3">
          <Lock size={14} className="text-[var(--color-success)]" />
          <span className="text-xs text-[var(--color-text-muted)]">
            Locked after client submission. {collection.unlockReason ? `Note: ${collection.unlockReason}` : ''}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} className="ml-auto" onClick={unlock}>
            <Unlock size={12} /> Unlock
          </Button>
        </div>
      )}

      {/* Per-item upload UI for staff */}
      <ul className="mt-4 space-y-3">
        {collection.items.map((item) => (
          <DocumentItemRow
            key={item.key}
            caseId={caseId}
            item={item}
            disabled={isLocked || busy}
            onAfter={load}
            onError={onError}
            onDownload={download}
          />
        ))}
      </ul>

      {!requiredOk && caseStatus === 'PENDING_DOCUMENTS' ? (
        <p className="mt-3 text-xs text-[var(--color-warning)]">
          {collection.requiredCount - collection.requiredDone} required item(s) still missing.
        </p>
      ) : null}

      {editOpen ? (
        <EditItemsDialog
          caseId={caseId}
          items={collection.items}
          onClose={() => setEditOpen(false)}
          onSaved={async () => {
            setEditOpen(false);
            await load();
          }}
          onError={onError}
        />
      ) : null}
    </Card>
  );
}

type EditableItem = {
  key: string;
  label: string;
  description?: string;
  required: boolean;
};

function EditItemsDialog({
  caseId,
  items,
  onClose,
  onSaved,
  onError,
}: {
  caseId: string;
  items: Item[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [draft, setDraft] = useState<EditableItem[]>(() =>
    items.map((i) => ({
      key: i.key,
      label: i.label,
      description: i.description ?? '',
      required: !!i.required,
    })),
  );
  const [busy, setBusy] = useState(false);

  function makeKey(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || `item_${Math.random().toString(36).slice(2, 7)}`;
  }

  function add(): void {
    const label = 'New item';
    setDraft((d) => [
      ...d,
      { key: `${makeKey(label)}_${d.length + 1}`, label, description: '', required: false },
    ]);
  }

  function patch(idx: number, patch: Partial<EditableItem>): void {
    setDraft((d) => {
      const next = [...d];
      next[idx] = { ...next[idx]!, ...patch };
      return next;
    });
  }

  function remove(idx: number): void {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      // Re-derive keys from labels for any items where the user changed
      // the label but the key is still the default placeholder, so the
      // saved keys stay readable. Existing keys (already-uploaded items)
      // we leave alone to preserve the link to existing uploads.
      const existingKeys = new Set(items.map((i) => i.key));
      const itemsJson = draft.map((d) => ({
        key: existingKeys.has(d.key) ? d.key : makeKey(d.label),
        label: d.label.trim() || 'Untitled',
        description: d.description?.trim() || undefined,
        required: d.required,
      }));
      // Defend against duplicate keys on the wire (Zod would reject them
      // anyway but the error is uglier than a client-side prevent).
      const seen = new Set<string>();
      for (const it of itemsJson) {
        if (seen.has(it.key)) {
          onError(`Two items have the same key "${it.key}". Rename one.`);
          setBusy(false);
          return;
        }
        seen.add(it.key);
      }
      await rpcMutation('documentCollection.editItems', { caseId, itemsJson }, { token });
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Edit document checklist</CardTitle>
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
          Add or remove items even after the link is sent. The client&apos;s upload page
          updates on their next visit. Removing an item that&apos;s already been uploaded
          leaves the file in place but unreferenced — re-add the item later if you need it
          back.
        </p>

        <div className="mt-4 space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          {draft.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No items. Click <span className="font-medium">Add item</span> below.
            </p>
          ) : (
            draft.map((d, idx) => (
              <div
                key={idx}
                className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                  <div>
                    <Label htmlFor={`it-label-${idx}`} className="text-xs">
                      Label
                    </Label>
                    <Input
                      id={`it-label-${idx}`}
                      value={d.label}
                      onChange={(e) => patch(idx, { label: e.target.value })}
                      placeholder="e.g. Passport bio page"
                      maxLength={200}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={d.required}
                        onChange={(e) => patch(idx, { required: e.target.checked })}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      />
                      Required
                    </label>
                    <Button size="sm" variant="ghost" onClick={() => remove(idx)} disabled={busy}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </div>
                <div className="mt-2">
                  <Label htmlFor={`it-desc-${idx}`} className="text-xs">
                    Description (optional)
                  </Label>
                  <Input
                    id={`it-desc-${idx}`}
                    value={d.description ?? ''}
                    onChange={(e) => patch(idx, { description: e.target.value })}
                    placeholder="Anything the client should know about this item"
                    maxLength={1000}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border-muted)] pt-3">
          <Button variant="ghost" size="sm" disabled={busy} onClick={add}>
            <Plus size={12} /> Add item
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || draft.length === 0}>
              {busy ? <Spinner /> : null} Save changes
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function DocumentItemRow({
  caseId,
  item,
  disabled,
  onAfter,
  onError,
  onDownload,
}: {
  caseId: string;
  item: Item;
  disabled: boolean;
  onAfter: () => Promise<void>;
  onError: (m: string) => void;
  onDownload: (uploadId: string) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(): Promise<void> {
    fileRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      const url = `${API_BASE}/api/v1/cases/${caseId}/upload?itemKey=${encodeURIComponent(item.key)}&fileName=${encodeURIComponent(f.name)}&contentType=${encodeURIComponent(f.type || 'application/octet-stream')}`;
      const buf = await f.arrayBuffer();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': f.type || 'application/octet-stream',
        },
        body: buf,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Upload failed (${res.status})`);
      }
      await onAfter();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const accept = (item.accept ?? []).join(',');

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            {item.complete ? (
              <CheckCircle2 size={14} className="text-[var(--color-success)]" />
            ) : (
              <span className="inline-block h-3 w-3 rounded-full border border-[var(--color-border)]" />
            )}
            <span className="text-sm font-semibold">{item.label}</span>
            {item.required ? <Badge tone="warning">Required</Badge> : null}
          </div>
          {item.description ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{item.description}</p>
          ) : null}
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
            {item.accept?.length ? `Accepts: ${item.accept.join(', ')}` : 'Any type'}
            {item.maxSizeMb ? ` · max ${item.maxSizeMb} MB` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={accept || undefined}
            className="hidden"
            onChange={onFile}
          />
          <Button size="sm" variant="secondary" disabled={disabled || busy} onClick={() => void pick()}>
            {busy ? <Spinner /> : <FileUp size={12} />}
            Upload
          </Button>
        </div>
      </div>

      {item.uploads.length > 0 ? (
        <ul className="mt-3 divide-y divide-[var(--color-border-muted)] text-xs">
          {item.uploads.map((u) => (
            <UploadRow
              key={u.id}
              u={u}
              itemKey={item.key}
              onDownload={onDownload}
              onError={onError}
              onAfterReclassify={onAfter}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function UploadRow({
  u,
  itemKey,
  onDownload,
  onError,
  onAfterReclassify,
}: {
  u: Upload;
  itemKey: string;
  onDownload: (uploadId: string) => Promise<void>;
  onError: (m: string) => void;
  onAfterReclassify: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function reclassify(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('documentCollection.reclassify', { uploadId: u.id }, { token });
      await onAfterReclassify();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Reclassify failed');
    } finally {
      setBusy(false);
    }
  }

  // Mismatch: AI thinks this doc belongs under a different checklist item.
  const mismatch =
    u.aiCategory != null &&
    u.aiConfidence != null &&
    u.aiConfidence >= 0.7 &&
    u.aiCategory !== itemKey;
  const aiTone: 'success' | 'warning' | 'neutral' =
    u.aiConfidence == null ? 'neutral' : u.aiConfidence >= 0.85 ? 'success' : 'warning';

  return (
    <li className="flex items-center justify-between py-1.5">
      <div className="min-w-0">
        <div className="font-medium">{u.fileName}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <span>
            {(u.sizeBytes / 1024).toFixed(1)} KB · {new Date(u.createdAt).toLocaleString()}
            {u.uploadedByName ? ` · uploaded by ${u.uploadedByName}` : ''}
            {!u.uploadedById && !u.uploadedByName ? ' · client (public link)' : ''}
          </span>
          {u.aiCategory ? (
            <Badge tone={aiTone}>
              AI: {u.aiCategoryLabel ?? u.aiCategory}
              {u.aiConfidence != null ? ` · ${Math.round(u.aiConfidence * 100)}%` : ''}
            </Badge>
          ) : u.aiClassifiedAt ? (
            <Badge tone="neutral">AI: no match</Badge>
          ) : null}
          {mismatch ? <Badge tone="warning">↪ Slot mismatch</Badge> : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => void reclassify()}
          disabled={busy}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title="Re-classify with AI"
        >
          {busy ? <Spinner /> : <Sparkles size={12} />}
        </button>
        <button
          onClick={() => void onDownload(u.id)}
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          title="Download"
        >
          <Download size={12} />
        </button>
      </div>
    </li>
  );
}
