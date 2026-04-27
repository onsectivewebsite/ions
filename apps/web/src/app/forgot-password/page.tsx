'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react';
import { Button, Card, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { Logo } from '../../components/Logo';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setEmailFailed(false);
    setEmailError(null);
    setLoading(true);
    try {
      const r = await rpcMutation<{ ok: true; emailSent: boolean; emailError?: string }>(
        'auth.requestPasswordReset',
        { email },
      );
      setSent(true);
      if (!r.emailSent) {
        setEmailFailed(true);
        setEmailError(r.emailError ?? 'unknown SMTP error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setLoading(false);
    }
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
          <h1 className="text-xl font-semibold tracking-tight">Forgot your password?</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Enter your work email and we&apos;ll send you a reset link.
          </p>

          {sent ? (
            <div className="mt-6 space-y-4">
              {emailFailed ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-4 text-sm text-[var(--color-warning)]">
                  <div className="font-medium">Email failed</div>
                  <p className="mt-1 text-xs">Contact your firm admin for help.</p>
                </div>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-4 text-sm text-[var(--color-success)]">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck size={14} />
                    Check your inbox
                  </div>
                  <p className="mt-1 text-xs">
                    If an account exists for <span className="font-mono">{email}</span>,
                    a reset link is on its way. The link expires in 30 minutes.
                  </p>
                </div>
              )}
              <Button onClick={() => router.push('/sign-in')} className="w-full">
                Back to sign-in
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <Label htmlFor="email">Work email</Label>
                <div className="relative mt-1">
                  <Mail
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                  />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="you@firm.com"
                    className="pl-9"
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? <Spinner /> : null}
                Send reset link
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}
