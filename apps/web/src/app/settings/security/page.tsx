'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Smartphone, ShieldCheck, Copy, Check } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Me =
  | {
      kind: 'platform';
      name: string;
      email: string;
      twoFAEnrolled: boolean;
    }
  | {
      kind: 'firm';
      name: string;
      email: string;
      twoFAEnrolled: boolean;
      tenant: { displayName: string; branding: Branding };
    };

type Enrollment = { secret: string; uri: string; qrDataUrl: string };

export default function SecurityPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function loadMe(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    try {
      const data = await rpcQuery<Me>('user.me', undefined, { token });
      setMe(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  useEffect(() => {
    void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll(): Promise<void> {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const token = getAccessToken();
      const data = await rpcMutation<Enrollment>('auth.totpBeginEnroll', undefined, { token });
      setEnrollment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!enrollment) return;
    setError(null);
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'auth.totpConfirmEnroll',
        { secret: enrollment.secret, code },
        { token },
      );
      setInfo('Authenticator app linked. You will be asked for a code at sign-in.');
      setEnrollment(null);
      setCode('');
      await loadMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Code did not match');
    } finally {
      setBusy(false);
    }
  }

  async function copySecret(): Promise<void> {
    if (!enrollment) return;
    await navigator.clipboard.writeText(enrollment.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding: Branding =
    me.kind === 'firm' ? me.tenant.branding ?? { themeCode: 'maple' } : { themeCode: 'maple' };

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: me.kind,
    contextLabel: me.kind === 'firm' ? me.tenant.displayName : 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-8">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Security</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Two-factor authentication. Required at every sign-in.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Authenticator app</CardTitle>
                {me.twoFAEnrolled ? (
                  <Badge tone="success">Enabled</Badge>
                ) : (
                  <Badge tone="neutral">Not enabled</Badge>
                )}
              </div>

              {info ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
                  {info}
                </div>
              ) : null}
              {error ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              {!enrollment ? (
                <div className="mt-6 space-y-4">
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {me.twoFAEnrolled
                      ? 'You can re-link a different authenticator app at any time. The previous one stops working as soon as you confirm.'
                      : 'Use Microsoft Authenticator, Google Authenticator, 1Password, or any TOTP app. Codes work even when offline.'}
                  </p>
                  <Button onClick={startEnroll} disabled={busy}>
                    {busy ? <Spinner /> : <Smartphone size={14} />}
                    {me.twoFAEnrolled ? 'Re-link authenticator' : 'Set up authenticator'}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <ol className="space-y-4 text-sm text-[var(--color-text)]">
                    <li>
                      <div className="font-medium">1. Open Microsoft Authenticator</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        Tap <span className="font-medium">+</span> →{' '}
                        <span className="font-medium">Other account (Google, Facebook, etc.)</span>.
                      </div>
                    </li>
                    <li>
                      <div className="font-medium">2. Scan this QR code</div>
                      <div className="mt-2 inline-block rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3">
                        <Image
                          src={enrollment.qrDataUrl}
                          alt="Authenticator QR"
                          width={200}
                          height={200}
                          unoptimized
                        />
                      </div>
                      <div className="mt-2 text-xs text-[var(--color-text-muted)]">
                        Can&apos;t scan? Enter this secret manually:
                      </div>
                      <div className="mt-1 inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-mono text-xs">
                        {enrollment.secret}
                        <button
                          type="button"
                          onClick={copySecret}
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          aria-label="Copy secret"
                        >
                          {copied ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </div>
                    </li>
                    <li>
                      <div className="font-medium">3. Enter the 6-digit code</div>
                      <form onSubmit={confirmEnroll} className="mt-2 flex items-center gap-2">
                        <input
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="123456"
                          className="h-10 w-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-center font-mono tracking-widest focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
                          autoFocus
                        />
                        <Button type="submit" disabled={busy || code.length !== 6}>
                          {busy ? <Spinner /> : null}
                          Confirm
                        </Button>
                        <button
                          type="button"
                          onClick={() => {
                            setEnrollment(null);
                            setCode('');
                          }}
                          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        >
                          Cancel
                        </button>
                      </form>
                    </li>
                  </ol>
                </div>
              )}
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Why an authenticator?</CardTitle>
                <ShieldCheck size={16} className="text-[var(--color-text-muted)]" />
              </div>
              <CardBody className="mt-3 space-y-3 text-sm text-[var(--color-text-muted)]">
                <p>
                  Authenticator codes never travel over email or SMS, so they can&apos;t be
                  intercepted. They work offline once linked.
                </p>
                <p>
                  Email OTP stays available as a fallback when you don&apos;t have your phone.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
