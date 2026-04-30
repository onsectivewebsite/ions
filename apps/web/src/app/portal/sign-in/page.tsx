'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { Button, Card, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../../lib/api';
import { setPortalToken } from '../../../lib/portal-session';
import { Logo } from '../../../components/Logo';
import { PasswordField } from '../../../components/PasswordField';

export default function PortalSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await rpcMutation<{ accessToken: string }>(
        'portal.signIn',
        { email, password },
      );
      setPortalToken(r.accessToken);
      router.push('/portal/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-4 py-12">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Client portal</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Sign in to track your file with your immigration firm.
        </p>
      </div>
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label>Password</Label>
            <div className="mt-1">
              <PasswordField
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}
          <Button type="submit" disabled={busy || !email || !password} className="w-full">
            {busy ? <Spinner /> : <LogIn size={14} />} Sign in
          </Button>
        </form>
      </Card>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
        <ShieldCheck size={12} className="mr-1 inline-block" />
        Your firm will email you a setup link the first time. If you haven&apos;t received one,
        contact your firm directly.
      </div>
      <Link
        href="/sign-in"
        className="text-center text-xs text-[var(--color-text-muted)] hover:underline"
      >
        Are you firm staff? Sign in here →
      </Link>
    </main>
  );
}
