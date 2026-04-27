'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';
import {
  RetainerTemplateEditor,
  type TemplateState,
} from '../../../../components/retainer/RetainerEditor';

type Me = { kind: 'firm'; name: string; email: string; tenant: { displayName: string; branding: Branding } };

type TemplateRow = {
  id: string;
  name: string;
  caseType: string | null;
  description: string | null;
  contentMd: string;
  isActive: boolean;
  isDefault: boolean;
};

export default function EditRetainerTemplatePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [initial, setInitial] = useState<TemplateState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<TemplateRow>('retainerTemplate.get', { id: params.id }, { token }),
    ])
      .then(([m, t]) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
        setInitial({
          id: t.id,
          name: t.name,
          caseType: t.caseType ?? '',
          description: t.description ?? '',
          contentMd: t.contentMd,
          isActive: t.isActive,
          isDefault: t.isDefault,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [router, params.id]);

  if (!me || !initial) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : (
            <>
              <Skeleton className="h-12" />
              <Skeleton className="h-64" />
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <ThemeProvider branding={me.tenant.branding ?? { themeCode: 'maple' }}>
      <AppShell
        user={{
          name: me.name,
          email: me.email,
          scope: 'firm',
          contextLabel: me.tenant.displayName,
        }}
      >
        <RetainerTemplateEditor initial={initial} />
      </AppShell>
    </ThemeProvider>
  );
}
