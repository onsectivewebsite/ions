'use client';
import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { Button, Card, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { Logo } from '../../components/Logo';

function ResetInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await rpcMutation('auth.completePasswordReset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
        <Card className="max-w-sm">
          <h1 className="text-base font-semibold">Missing reset token</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Use the link from your reset email, or request a new one.
          </p>
          <Button className="mt-4 w-full" onClick={() => router.push('/forgot-password')}>
            Request a new link
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <button
            onClick={() => router.push('/sign-in')}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to sign-in
          </button>
          <Logo />
        </div>

        <Card>
          <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            8 characters minimum. We&apos;ll sign you out of every device.
          </p>

          {done ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-4 text-sm text-[var(--color-success)]">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck size={14} />
                  Password updated
                </div>
                <p className="mt-1 text-xs">
                  Sign in with your new password. We sent a confirmation email.
                </p>
              </div>
              <Button onClick={() => router.push('/sign-in')} className="w-full">
                Go to sign-in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="password">New password</Label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    onClick={() => setShowPw((s) => !s)}
                  >
                    {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="relative">
                  <Lock
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                  />
                  <Input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    autoFocus
                    placeholder="••••••••"
                    className="pl-9"
                  />
                </div>
                {tooShort ? (
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {8 - password.length} more character{8 - password.length === 1 ? '' : 's'} needed
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="confirm">Confirm new password</Label>
                <div className="relative mt-1">
                  <Lock
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                  />
                  <Input
                    id="confirm"
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9"
                  />
                </div>
                {mismatch ? (
                  <p className="mt-1 text-xs text-[var(--color-danger)]">Passwords don&apos;t match</p>
                ) : null}
              </div>

              {error ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={loading || password.length < 8 || password !== confirm}
                className="w-full"
              >
                {loading ? <Spinner /> : null}
                Update password
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-[var(--color-text-muted)]">
          Loading…
        </main>
      }
    >
      <ResetInner />
    </Suspense>
  );
}
