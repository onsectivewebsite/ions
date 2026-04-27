'use client';
import { use, useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Lock, ShieldCheck } from 'lucide-react';
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
import { Logo } from '../../../components/Logo';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type PublicUpload = {
  id: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
};

type PublicItem = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
  uploads: PublicUpload[];
  complete: boolean;
};

type PublicResp =
  | {
      ok: true;
      locked: false;
      firm: { displayName: string; branding: Branding };
      items: PublicItem[];
      requiredCount: number;
      requiredDone: number;
    }
  | {
      ok: true;
      locked: true;
      firm: { displayName: string; branding: Branding };
      submittedAt: string | null;
    };

export default function PublicDocumentCollectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [data, setData] = useState<PublicResp | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [signerName, setSignerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function load(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/v1/dc/${encodeURIComponent(token)}`);
      const j = (await res.json()) as PublicResp & { error?: string };
      if (!res.ok || !j.ok) {
        setError(('error' in j && j.error) || 'Link is invalid or has expired.');
        setData(null);
        return;
      }
      setData(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setData(null);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submit(): Promise<void> {
    if (!confirm('Submit your documents and lock this link? You won\'t be able to upload more without contacting your firm.'))
      return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/dc/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as { ok: boolean; missingRequired?: string[]; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? 'Submit failed');
      setSubmitted(true);
      if (j.missingRequired && j.missingRequired.length > 0) {
        setError(
          `Submitted, but ${j.missingRequired.length} required item(s) still missing — your firm may unlock for re-upload: ${j.missingRequired.join(', ')}`,
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (data === undefined) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }
  if (data === null) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <Card>
          <CardTitle>Link unavailable</CardTitle>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{error ?? 'This link cannot be used.'}</p>
        </Card>
      </main>
    );
  }

  const branding = data.firm.branding ?? { themeCode: 'maple' };

  return (
    <ThemeProvider branding={branding}>
      <main className="mx-auto min-h-screen max-w-2xl space-y-6 px-4 py-10">
        <header className="flex items-center justify-between">
          <Logo />
          <span className="text-xs text-[var(--color-text-muted)]">{data.firm.displayName}</span>
        </header>

        {data.locked ? (
          <Card>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={28} className="text-[var(--color-success)]" />
              <div>
                <CardTitle>Documents submitted</CardTitle>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Thank you. We received your documents
                  {data.submittedAt
                    ? ` on ${new Date(data.submittedAt).toLocaleString()}`
                    : ''}
                  . If you need to upload anything else, please contact your firm directly.
                </p>
              </div>
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <CardTitle>Upload your documents</CardTitle>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Please upload each item below. You can return to this link anytime before you click{' '}
                <strong>Submit</strong>. Once you submit, the link locks.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <Badge tone={data.requiredDone === data.requiredCount ? 'success' : 'warning'}>
                  {data.requiredDone}/{data.requiredCount} required uploaded
                </Badge>
                <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)]">
                  <ShieldCheck size={12} /> Encrypted in transit; private to your firm.
                </span>
              </div>
              {error ? (
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-2 text-xs text-[var(--color-warning)]">
                  {error}
                </div>
              ) : null}
            </Card>

            <ul className="space-y-3">
              {data.items.map((item) => (
                <PublicItemRow
                  key={item.key}
                  token={token}
                  item={item}
                  signerName={signerName}
                  onAfter={load}
                  onError={setError}
                />
              ))}
            </ul>

            <Card>
              <CardTitle>Sign &amp; submit</CardTitle>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Type your full name as a record of who uploaded these documents.
              </p>
              <input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full legal name"
                className="mt-3 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              />
              <div className="mt-3 flex justify-end">
                <Button
                  onClick={() => void submit()}
                  disabled={submitting || submitted || !signerName}
                >
                  {submitting ? <Spinner /> : <Lock size={14} />}
                  Submit and lock
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>
    </ThemeProvider>
  );
}

function PublicItemRow({
  token,
  item,
  signerName,
  onAfter,
  onError,
}: {
  token: string;
  item: PublicItem;
  signerName: string;
  onAfter: () => Promise<void>;
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
      const url = `${API_BASE}/api/v1/dc/${encodeURIComponent(token)}/upload?itemKey=${encodeURIComponent(item.key)}&fileName=${encodeURIComponent(f.name)}&contentType=${encodeURIComponent(f.type || 'application/octet-stream')}`;
      const buf = await f.arrayBuffer();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': f.type || 'application/octet-stream',
          ...(signerName ? { 'x-signer-name': signerName } : {}),
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
    <li>
      <Card>
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
            <Button size="sm" disabled={busy} onClick={() => void pick()}>
              {busy ? <Spinner /> : <FileUp size={12} />}
              {item.uploads.length > 0 ? 'Replace' : 'Upload'}
            </Button>
          </div>
        </div>

        {item.uploads.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {item.uploads.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] px-2 py-1.5"
              >
                <span className="font-medium">{u.fileName}</span>
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  {(u.sizeBytes / 1024).toFixed(1)} KB · {new Date(u.uploadedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </li>
  );
}
