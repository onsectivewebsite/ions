'use client';
import { useEffect, useState, use, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Label,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { setAccessToken } from '../../../lib/session';
import { Logo } from '../../../components/Logo';
import {
  PasswordField,
  PasswordStrengthMeter,
  checkPassword,
} from '../../../components/PasswordField';

type PreviewResp = {
  firmName: string;
  roleName: string;
  recipientName: string;
  recipientEmail: string;
  branding: Branding | null;
};

type AcceptResp = {
  ok: true;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
};

export default function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpcQuery<PreviewResp>('invite.preview', { token })
      .then(setPreview)
      .catch((e) => setPreviewError(e instanceof Error ? e.message : 'Invalid invite'));
  }, [token]);

  const policy = checkPassword(password);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!policy.meetsPolicy) {
      setError('Password must be 8+ chars with upper, lower, and a digit.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const r = await rpcMutation<AcceptResp>('invite.accept', { token, password });
      setAccessToken(r.accessToken);
      // Show the 2FA prompt before dropping them into the dashboard. Page is
      // skippable so it never blocks the user.
      router.push('/onboarding/secure');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed');
    } finally {
      setBusy(false);
    }
  }

  if (previewError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
        <Card className="max-w-md">
          <h1 className="text-base font-semibold">Invite unavailable</h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">{previewError}</p>
          <Button className="mt-4 w-full" onClick={() => router.push('/sign-in')}>
            Back to sign-in
          </Button>
        </Card>
      </main>
    );
  }

  if (!preview) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-mesh">
        <Spinner />
      </main>
    );
  }

  const branding: Branding = preview.branding ?? { themeCode: 'maple' };

  return (
    <ThemeProvider branding={branding}>
      <main className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
        <div className="w-full max-w-md space-y-6">
          <div className="flex items-center justify-between">
            <Logo />
            <div className="text-xs text-[var(--color-text-muted)]">Step {step} of 2</div>
          </div>

          <Card>
            {step === 1 ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold tracking-tight">
                      Welcome, {preview.recipientName}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                      You&apos;ve been invited to{' '}
                      <span className="font-medium text-[var(--color-text)]">
                        {preview.firmName}
                      </span>{' '}
                      as <Badge tone="neutral">{preview.roleName}</Badge>.
                    </p>
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs">
                  Account email: <span className="font-mono">{preview.recipientEmail}</span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  After you set a password, you&apos;ll land on your dashboard. You can enroll an
                  authenticator app at any time from <span className="font-mono">Settings → Security</span>.
                </p>
                <div className="flex justify-end pt-2">
                  <Button onClick={() => setStep(2)}>
                    Set password <ArrowRight size={14} />
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight">Choose a password</h1>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    You&apos;ll use this to sign in.
                  </p>
                </div>
                <div>
                  <Label htmlFor="pw">Password</Label>
                  <div className="mt-1">
                    <PasswordField
                      id="pw"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      autoFocus
                      placeholder="••••••••"
                    />
                  </div>
                  <PasswordStrengthMeter password={password} />
                </div>
                <div>
                  <Label htmlFor="cf">Confirm password</Label>
                  <div className="mt-1">
                    <PasswordField
                      id="cf"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                    />
                  </div>
                  {confirm && confirm !== password ? (
                    <div className="mt-1 text-[11px] text-[var(--color-danger)]">
                      Doesn&rsquo;t match.
                    </div>
                  ) : null}
                </div>
                {error ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                    {error}
                  </div>
                ) : null}
                <Button type="submit" disabled={busy || !policy.meetsPolicy || password !== confirm} className="w-full">
                  {busy ? <Spinner /> : <ShieldCheck size={14} />}
                  Activate account
                </Button>
              </form>
            )}
          </Card>

          <p className="text-center text-xs text-[var(--color-text-muted)]">
            © Onsective Inc. · Already activated? <a href="/sign-in" className="hover:underline">Sign in</a>
          </p>
        </div>
      </main>
    </ThemeProvider>
  );
}
