'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileUp, Upload } from 'lucide-react';
import {
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
import { rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell } from '../../../../components/AppShell';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const CASE_TYPES = [
  ['', 'Default (any case type)'],
  ['work_permit', 'Work permit'],
  ['study_permit', 'Study permit'],
  ['pr', 'Permanent residence'],
  ['visitor_visa', 'Visitor visa'],
  ['citizenship', 'Citizenship'],
  ['lmia', 'LMIA'],
  ['other', 'Other'],
] as const;

type Me = { kind: 'firm'; name: string; email: string; tenant: { displayName: string; branding: Branding } };

export default function NewPdfTemplatePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [caseType, setCaseType] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
  }, [router]);

  async function upload(): Promise<void> {
    if (!file || !name.trim()) {
      setError('Pick a file and a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      const url = new URL(`${API_BASE}/api/v1/pdf-templates`);
      url.searchParams.set('name', name.trim());
      if (caseType) url.searchParams.set('caseType', caseType);
      if (description) url.searchParams.set('description', description);
      url.searchParams.set('fileName', file.name);
      const buf = await file.arrayBuffer();
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/pdf',
        },
        body: buf,
      });
      const j = (await res.json()) as { id?: string; error?: string; fields?: unknown };
      if (!res.ok || !j.id) throw new Error(j.error ?? `Upload failed (${res.status})`);
      router.replace(`/settings/pdf-templates/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
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

  return (
    <ThemeProvider branding={me.tenant.branding ?? { themeCode: 'maple' }}>
      <AppShell user={{ name: me.name, email: me.email, scope: 'firm', contextLabel: me.tenant.displayName }}>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Link
            href="/settings/pdf-templates"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to PDF templates
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">New PDF template</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Upload a fillable IRCC PDF. We extract the form field names automatically — you map
            them to data paths on the next screen.
          </p>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="IMM 1295 — Work Permit" required />
              </div>
              <div>
                <Label>Case type</Label>
                <select
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value)}
                >
                  {CASE_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="The standard work-permit form, current revision."
                />
              </div>
              <div>
                <Label>Source PDF (must be a fillable form)</Label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <FileUp size={14} /> Pick PDF
                  </Button>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {file ? `${file.name} (${(file.size / 1024).toFixed(0)} KB)` : 'No file picked'}
                  </span>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={upload} disabled={busy || !file || !name.trim()}>
                  {busy ? <Spinner /> : <Upload size={14} />} Upload &amp; detect fields
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
