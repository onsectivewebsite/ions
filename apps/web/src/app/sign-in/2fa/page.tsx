'use client';
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, KeyRound, Smartphone, Mail } from 'lucide-react';
import { Button, Card, Input, Spinner } from '@onsecboad/ui';
import { rpcMutation } from '../../../lib/api';
import { setAccessToken } from '../../../lib/session';
import { Logo } from '../../../components/Logo';

type Method = 'totp' | 'email_otp' | 'recovery_code';
type VerifyResult = { accessToken: string; refreshToken: string; accessExpiresAt: string };
type OtpResult = { ok: true; emailSent: boolean; emailError?: string };

// Module-level dedupe — survives React 18+ strict-mode double-mount in dev,
// which would otherwise fire two requestEmailOtp calls for the same ticket.
// Server has its own 30s lock as a backstop; this saves the round-trip.
const requestedTickets = new Set<string>();

function TwoFAInner() {
  const router = useRouter();
  const search = useSearchParams();
  const ticket = search.get('ticket') ?? '';
  const methods = useMemo<Method[]>(
    () => (search.get('methods')?.split(',').filter(Boolean) as Method[]) ?? ['email_otp'],
    [search],
  );
  const [method, setMethod] = useState<Method>(methods[0] ?? 'email_otp');
  const [code, setCode] = useState<string[]>(Array(6).fill(''));
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(() => requestedTickets.has(ticket));
  const [otpDeliveryFailed, setOtpDeliveryFailed] = useState(false);
  const [otpDeliveryError, setOtpDeliveryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (method !== 'email_otp' || !ticket || requestedTickets.has(ticket)) return;
    requestedTickets.add(ticket);
    void rpcMutation<OtpResult>('auth.requestEmailOtp', { ticket })
      .then((r) => {
        setOtpSent(true);
        if (!r.emailSent) {
          setOtpDeliveryFailed(true);
          setOtpDeliveryError(r.emailError ?? 'unknown SMTP error');
        }
      })
      .catch((err) => {
        requestedTickets.delete(ticket); // allow a retry if the request itself failed
        setError(err instanceof Error ? err.message : 'Failed to send code');
      });
  }, [method, ticket]);

  async function resend(): Promise<void> {
    if (resending) return;
    setResending(true);
    setError(null);
    setOtpDeliveryFailed(false);
    setOtpDeliveryError(null);
    try {
      const r = await rpcMutation<OtpResult>('auth.requestEmailOtp', { ticket });
      if (!r.emailSent) {
        setOtpDeliveryFailed(true);
        setOtpDeliveryError(r.emailError ?? 'unknown SMTP error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend');
    } finally {
      setResending(false);
    }
  }

  function handleDigit(i: number, v: string): void {
    const cleaned = v.replace(/\D/g, '').slice(0, 1);
    setCode((prev) => {
      const next = [...prev];
      next[i] = cleaned;
      return next;
    });
    if (cleaned && i < 5) inputs.current[i + 1]?.focus();
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace' && !code[i] && i > 0) inputs.current[i - 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>): void {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 0) return;
    e.preventDefault();
    setCode(pasted.padEnd(6, '').split('').slice(0, 6));
    inputs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const submittedCode = method === 'recovery_code' ? recoveryCode.trim() : code.join('');
      const res = await rpcMutation<VerifyResult>('auth.verify2FA', {
        ticket,
        code: submittedCode,
        method,
      });
      setAccessToken(res.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  if (!ticket) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
        <Card className="max-w-sm">
          <h1 className="text-base font-semibold">Missing ticket</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Start over from the sign-in page.
          </p>
          <Button className="mt-4" onClick={() => router.push('/sign-in')}>
            Back to sign-in
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
            Back
          </button>
          <Logo />
        </div>

        <Card>
          <h1 className="text-xl font-semibold tracking-tight">Two-factor verification</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            We need a second factor to keep client data safe.
          </p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {methods.includes('totp') ? (
              <MethodTab
                active={method === 'totp'}
                onClick={() => {
                  setMethod('totp');
                  setCode(Array(6).fill(''));
                }}
                icon={<Smartphone size={14} />}
                label="App"
              />
            ) : null}
            {methods.includes('email_otp') ? (
              <MethodTab
                active={method === 'email_otp'}
                onClick={() => {
                  setMethod('email_otp');
                  setCode(Array(6).fill(''));
                }}
                icon={<Mail size={14} />}
                label="Email"
              />
            ) : null}
            {methods.includes('totp') ? (
              <MethodTab
                active={method === 'recovery_code'}
                onClick={() => {
                  setMethod('recovery_code');
                  setRecoveryCode('');
                }}
                icon={<KeyRound size={14} />}
                label="Recovery"
              />
            ) : null}
          </div>

          {method === 'email_otp' && otpSent && !otpDeliveryFailed ? (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--color-text-muted)]">
              <span>A 6-digit code was sent to your inbox. Check spam if you don&apos;t see it.</span>
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="shrink-0 font-medium text-[var(--color-primary)] hover:underline disabled:opacity-50"
              >
                {resending ? 'Sending…' : 'Resend'}
              </button>
            </div>
          ) : null}
          {method === 'email_otp' && otpDeliveryFailed ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]">
              <div className="font-medium">Email failed</div>
              <p className="mt-1">Use an authenticator app if available, or try again.</p>
              <button
                type="button"
                onClick={resend}
                disabled={resending}
                className="mt-2 font-medium underline disabled:opacity-50"
              >
                {resending ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          ) : null}
          {method === 'totp' ? (
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
              Open your authenticator app and enter the 6-digit code shown for OnsecBoad.
            </p>
          ) : null}
          {method === 'recovery_code' ? (
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">
              Enter one of your saved recovery codes (format <span className="font-mono">xxxx-xxxx</span>).
              Each code is single-use.
            </p>
          ) : null}

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            {method === 'recovery_code' ? (
              <Input
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="xxxx-xxxx"
                autoFocus
                className="text-center font-mono text-lg tracking-widest"
              />
            ) : (
              <div className="flex justify-between gap-2" onPaste={handlePaste}>
                {code.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKey(i, e)}
                    className="h-14 w-12 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-center text-2xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                    aria-label={`Digit ${i + 1}`}
                  />
                ))}
              </div>
            )}

            {error ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={
                loading ||
                (method === 'recovery_code'
                  ? recoveryCode.trim().length < 8
                  : code.join('').length !== 6)
              }
              className="w-full"
            >
              {loading ? <Spinner /> : null}
              Verify and continue
            </Button>
          </form>

          <p className="mt-4 text-center text-xs text-[var(--color-text-muted)]">
            Lost your device <em>and</em> your codes? Contact your firm admin.
          </p>
        </Card>
      </div>
    </main>
  );
}

function MethodTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex flex-col items-center gap-1 rounded-[var(--radius-md)] border px-3 py-3 text-xs font-medium transition-colors ' +
        (active
          ? 'border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]')
      }
    >
      {icon}
      {label}
    </button>
  );
}

export default function TwoFAPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-[var(--color-text-muted)]">
          Loading…
        </main>
      }
    >
      <TwoFAInner />
    </Suspense>
  );
}
