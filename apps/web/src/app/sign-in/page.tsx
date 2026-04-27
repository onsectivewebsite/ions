'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../lib/api';
import { Logo } from '../../components/Logo';
import { AuthHero } from '../../components/illustrations/AuthHero';
import { PasskeyButton } from '../../components/PasskeyButton';

type SignInResult = { ticket: string; methods: ('totp' | 'email_otp')[] };

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await rpcMutation<SignInResult>('auth.signIn', { email, password });
      const params = new URLSearchParams({
        ticket: res.ticket,
        methods: res.methods.join(','),
      });
      router.push(`/sign-in/2fa?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-mesh">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[1fr_minmax(420px,540px)]">
        {/* Hero panel — hidden on mobile */}
        <div className="hidden lg:block">
          <AuthHero />
        </div>

        {/* Form panel */}
        <div className="flex flex-col">
          <div className="mb-8 flex items-center justify-between">
            <Logo />
            <span className="text-xs text-[var(--color-text-muted)]">
              Need help? hello@onsective.com
            </span>
          </div>

          <div className="my-auto">
            <div className="mx-auto w-full max-w-sm">
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">
                Welcome back
              </h1>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Sign in to your OnsecBoad workspace.
              </p>

              <form onSubmit={onSubmit} className="mt-8 space-y-4">
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

                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
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
                      autoComplete="current-password"
                      placeholder="••••••••"
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
                  Sign in
                  {!loading ? <ArrowRight size={14} /> : null}
                </Button>

                <div className="relative my-2 text-center text-xs text-[var(--color-text-muted)]">
                  <span className="relative z-10 bg-[var(--color-bg)] px-2">
                    or continue with
                  </span>
                  <div className="absolute left-0 top-1/2 h-px w-full bg-[var(--color-border)]" />
                </div>

                <PasskeyButton />
              </form>

              <div className="mt-8 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                <button
                  type="button"
                  onClick={() => router.push('/forgot-password')}
                  className="hover:text-[var(--color-text)]"
                >
                  Forgot password?
                </button>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Two-factor required
                </span>
              </div>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-[var(--color-text-muted)]">
            © Onsective Inc. · Privacy · Terms
          </p>
        </div>
      </div>
    </main>
  );
}
