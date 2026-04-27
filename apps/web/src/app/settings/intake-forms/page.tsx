'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Pencil, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Template = {
  id: string;
  name: string;
  caseType: string;
  description: string | null;
  isActive: boolean;
  fieldsJson: unknown;
  createdAt: string;
  updatedAt: string;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const CASE_TYPE_LABELS: Record<string, string> = {
  work_permit: 'Work permit',
  study_permit: 'Study permit',
  pr: 'Permanent residence',
  visitor_visa: 'Visitor visa',
  citizenship: 'Citizenship',
  lmia: 'LMIA',
  other: 'Other',
};

export default function IntakeFormsListPage() {
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
      rpcQuery<Template[]>('intakeTemplate.list', undefined, { token }),
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

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  // Group by case type for readability.
  const byCase = new Map<string, Template[]>();
  for (const t of items) {
    if (!byCase.has(t.caseType)) byCase.set(t.caseType, []);
    byCase.get(t.caseType)!.push(t);
  }

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
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
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Intake forms</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Per-case-type forms used during reception walk-ins and lead follow-up.
              </p>
            </div>
            <Link href="/settings/intake-forms/new">
              <Button>
                <Plus size={14} /> New template
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
                No intake forms yet. Create one for each case type your firm handles.
              </div>
            </Card>
          ) : (
            [...byCase.entries()].map(([caseType, list]) => (
              <Card key={caseType}>
                <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  {CASE_TYPE_LABELS[caseType] ?? caseType}
                </div>
                <ul className="mt-2 divide-y divide-[var(--color-border-muted)]">
                  {list.map((t) => {
                    const fieldCount = Array.isArray(t.fieldsJson)
                      ? (t.fieldsJson as unknown[]).length
                      : 0;
                    return (
                      <li key={t.id}>
                        <Link
                          href={`/settings/intake-forms/${t.id}`}
                          className="flex items-center justify-between py-3 hover:bg-[var(--color-surface-muted)]"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{t.name}</span>
                              <Badge tone={t.isActive ? 'success' : 'neutral'}>
                                {t.isActive ? 'Active' : 'Paused'}
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                              {fieldCount} field{fieldCount === 1 ? '' : 's'}
                              {t.description ? ` · ${t.description}` : ''}
                            </div>
                          </div>
                          <Pencil
                            size={14}
                            className="text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5"
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
