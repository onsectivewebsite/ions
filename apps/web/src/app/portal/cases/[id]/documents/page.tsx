'use client';
import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  Upload,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../../lib/api';
import { getPortalToken } from '../../../../../lib/portal-session';
import { PortalShell } from '../../../../../components/portal/PortalShell';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type ChecklistItem = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
};

type Upload = {
  id: string;
  itemKey: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

type PortalCollection = {
  case: { id: string; caseType: string; status: string };
  collection:
    | {
        id: string;
        status: 'DRAFT' | 'SENT' | 'LOCKED' | 'UNLOCKED';
        submittedAt: string | null;
        lockedAt: string | null;
        publicTokenExpiresAt: string | null;
      }
    | null;
  items: ChecklistItem[];
  uploads: Upload[];
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function PortalCaseDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<PortalCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function load(): Promise<void> {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    try {
      const [m, dc] = await Promise.all([
        rpcQuery<Me>('portal.me', undefined, { token }),
        rpcQuery<PortalCollection>('portal.documentCollectionForCase', { caseId: id }, { token }),
      ]);
      setMe(m);
      setData(dc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submit(): Promise<void> {
    if (
      !confirm(
        "Submit your documents and lock this collection? You won't be able to upload more without contacting your firm.",
      )
    )
      return;
    setSubmitting(true);
    try {
      const token = getPortalToken();
      const r = await rpcMutation<{ ok: boolean; missingRequired?: Array<{ key: string; label: string }> }>(
        'portal.submitDocuments',
        { caseId: id },
        { token },
      );
      setSubmitted(true);
      if (r.missingRequired && r.missingRequired.length > 0) {
        setError(
          `Submitted, but ${r.missingRequired.length} required item(s) still missing — your firm may unlock for re-upload: ${r.missingRequired.map((m) => m.label).join(', ')}`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!me || !data) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  const uploadsByKey = new Map<string, Upload[]>();
  for (const u of data.uploads) {
    const list = uploadsByKey.get(u.itemKey) ?? [];
    list.push(u);
    uploadsByKey.set(u.itemKey, list);
  }
  const requiredItems = data.items.filter((it) => it.required);
  const requiredDone = requiredItems.filter((it) => (uploadsByKey.get(it.key)?.length ?? 0) > 0).length;

  const locked = data.collection?.status === 'LOCKED';
  const noCollection = data.collection === null;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-4">
          <Link
            href={`/portal/cases/${id}`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} /> Back to file
          </Link>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Upload the items your firm has requested for your{' '}
              <strong>{data.case.caseType.replace('_', ' ')}</strong> file.
            </p>
          </div>

          {noCollection ? (
            <Card>
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <FileText size={28} className="mx-auto mb-2 opacity-40" />
                Your firm hasn&apos;t requested any documents yet. Once they do, the items will
                appear here.
              </div>
            </Card>
          ) : locked ? (
            <Card>
              <div className="flex items-start gap-3">
                <CheckCircle2 size={28} className="mt-1 text-[var(--color-success)]" />
                <div>
                  <CardTitle>Documents submitted</CardTitle>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Thank you. We received your documents
                    {data.collection?.submittedAt
                      ? ` on ${new Date(data.collection.submittedAt).toLocaleString()}`
                      : ''}
                    . If you need to upload anything else, please message your firm — they can
                    unlock the collection for re-upload.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Upload checklist</CardTitle>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      You can return to this page anytime. Click <strong>Submit</strong> when
                      everything is uploaded — that locks the collection.
                    </p>
                  </div>
                  <Badge tone={requiredDone === requiredItems.length ? 'success' : 'warning'}>
                    {requiredDone}/{requiredItems.length} required
                  </Badge>
                </div>
                {error ? (
                  <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-2 text-xs text-[var(--color-warning)]">
                    {error}
                  </div>
                ) : null}
              </Card>

              <ul className="space-y-3">
                {data.items.map((item) => (
                  <PortalItemRow
                    key={item.key}
                    caseId={id}
                    item={item}
                    uploads={uploadsByKey.get(item.key) ?? []}
                    onChanged={load}
                    onError={setError}
                  />
                ))}
              </ul>

              <Card>
                <CardTitle>Submit when ready</CardTitle>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Submitting locks this collection. Your firm will see everything you uploaded and
                  proceed with file preparation.
                </p>
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => void submit()} disabled={submitting || submitted}>
                    {submitting ? <Spinner /> : <Lock size={14} />} Submit and lock
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}

function PortalItemRow({
  caseId,
  item,
  uploads,
  onChanged,
  onError,
}: {
  caseId: string;
  item: ChecklistItem;
  uploads: Upload[];
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
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
      const token = getPortalToken();
      if (!token) throw new Error('Not signed in');
      const url = `${API_BASE}/api/v1/portal/cases/${encodeURIComponent(caseId)}/upload?itemKey=${encodeURIComponent(item.key)}&fileName=${encodeURIComponent(f.name)}&contentType=${encodeURIComponent(f.type || 'application/octet-stream')}`;
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
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function downloadOne(uploadId: string, fileName: string): Promise<void> {
    try {
      const token = getPortalToken();
      const r = await rpcMutation<{ url: string }>(
        'portal.documentDownloadUrl',
        { uploadId },
        { token },
      );
      window.open(r.url, '_blank', 'noopener,noreferrer');
      void fileName;
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not generate download link');
    }
  }

  const accept = (item.accept ?? []).join(',');
  const complete = uploads.length > 0;

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {complete ? (
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
              onChange={(e) => void onFile(e)}
            />
            <Button size="sm" variant="secondary" onClick={() => void pick()} disabled={busy}>
              {busy ? <Spinner /> : <Upload size={12} />}
              {complete ? 'Replace' : 'Upload'}
            </Button>
          </div>
        </div>
        {uploads.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-[var(--color-border-muted)] pt-2">
            {uploads.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between text-xs text-[var(--color-text-muted)]"
              >
                <span>
                  {u.fileName} · {fmtBytes(u.sizeBytes)} · uploaded{' '}
                  {new Date(u.createdAt).toLocaleString()}
                </span>
                <button
                  onClick={() => void downloadOne(u.id, u.fileName)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-muted)]"
                >
                  <Download size={11} /> Download
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </li>
  );
}
