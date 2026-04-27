'use client';
import { Suspense, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { Button, Card, CardTitle, Input, Label, Skeleton, Spinner, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { setPortalToken } from '../../../lib/portal-session';
import { Logo } from '../../../components/Logo';

type Preview = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string };
  firm: { displayName: string; branding: Branding };
};

export default function PortalSetupPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <PortalSetupInner />
    </Suspense>
  );
}

function PortalSetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setPreview(null);
      setError('Missing or invalid link.');
      return;
    }
    rpcQuery<Preview>('portal.setupPreview', { token })
      .then(setPreview)
      .catch((e) => {
        setPreview(null);
        setError(e instanceof Error ? e.message : 'Link is invalid or expired.');
      });
  }, [token]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await rpcMutation<{ accessToken: string }>('portal.completeSetup', {
        token,
        password,
      });
      setPortalToken(r.accessToken);
      router.push('/portal/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  if (preview === undefined) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }
  if (preview === null) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <Card>
          <CardTitle>Link unavailable</CardTitle>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {error ?? 'This setup link is no longer valid. Ask your firm to send a new one.'}
          </p>
        </Card>
      </main>
    );
  }

  const branding = preview.firm.branding ?? { themeCode: 'maple' };
  const fullName =
    [preview.client.firstName, preview.client.lastName].filter(Boolean).join(' ') ||
    'New client';

  return (
    <ThemeProvider branding={branding}>
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 py-12">
        <Logo />
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">{preview.firm.displayName}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Welcome, {fullName}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Pick a password for your client portal. You&apos;ll sign in with{' '}
            <strong>{preview.email}</strong> from now on.
          </p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Password (min 8 characters)</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
              />
            </div>
            {error ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            ) : null}
            <Button type="submit" disabled={busy || password.length < 8} className="w-full">
              {busy ? <Spinner /> : <KeyRound size={14} />} Set password &amp; continue
            </Button>
          </form>
        </Card>
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <CheckCircle2 size={12} className="text-[var(--color-success)]" />
          You&apos;ll be signed in automatically after setting your password.
        </div>
      </main>
    </ThemeProvider>
  );
}
