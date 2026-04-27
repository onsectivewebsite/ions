'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell } from '../../../components/AppShell';

type Template = {
  id: string;
  name: string;
  caseType: string | null;
  description: string | null;
  fileName: string;
  sizeBytes: number;
  isActive: boolean;
  detectedFieldsJson: unknown;
  mappingJson: unknown;
};

type Me = { kind: 'firm'; name: string; email: string; tenant: { displayName: string; branding: Branding } };

const CASE_LABEL: Record<string, string> = {
  work_permit: 'Work permit',
  study_permit: 'Study permit',
  pr: 'Permanent residence',
  visitor_visa: 'Visitor visa',
  citizenship: 'Citizenship',
  lmia: 'LMIA',
  other: 'Other',
};

export default function PdfTemplatesListPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Template[]>('pdfTemplate.list', undefined, { token }),
    ])
      .then(([m, list]) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
        setItems(list);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [router]);

  if (!me || items === null) {
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
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <ArrowLeft size={12} />
                Back to settings
              </Link>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">PDF form templates</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Upload fillable IRCC PDFs (IMM 1295, IMM 0008, etc.) and map their form fields to
                the AI-extracted case data. Generate filled PDFs from the case page.
              </p>
            </div>
            <Link href="/settings/pdf-templates/new">
              <Button>
                <Plus size={14} /> New PDF template
              </Button>
            </Link>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {items.length === 0 ? (
            <Card>
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <FileText size={28} className="mx-auto mb-2 opacity-40" />
                No PDF templates yet.
              </div>
            </Card>
          ) : (
            <Card>
              <ul className="divide-y divide-[var(--color-border-muted)]">
                {items.map((t) => {
                  const fieldCount = Array.isArray(t.detectedFieldsJson)
                    ? (t.detectedFieldsJson as unknown[]).length
                    : 0;
                  const mappedCount = Array.isArray(t.mappingJson)
                    ? (t.mappingJson as unknown[]).length
                    : 0;
                  return (
                    <li key={t.id}>
                      <Link
                        href={`/settings/pdf-templates/${t.id}`}
                        className="flex items-center justify-between py-3 hover:bg-[var(--color-surface-muted)]"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{t.name}</span>
                            {!t.isActive ? <Badge tone="neutral">Paused</Badge> : null}
                            <Badge tone={mappedCount > 0 ? 'success' : 'warning'}>
                              {mappedCount}/{fieldCount} mapped
                            </Badge>
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {t.caseType ? CASE_LABEL[t.caseType] ?? t.caseType : 'All case types'}
                            {' · '}
                            {t.fileName} · {(t.sizeBytes / 1024).toFixed(0)} KB
                            {t.description ? ` · ${t.description}` : ''}
                          </div>
                        </div>
                        <Pencil size={14} className="text-[var(--color-text-muted)]" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
