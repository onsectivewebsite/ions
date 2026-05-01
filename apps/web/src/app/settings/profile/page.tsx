'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShieldCheck, User } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { Input, Label } from '@onsecboad/ui';
import { AppShell, type ShellUser } from '../../../components/AppShell';
import {
  PasswordField,
  PasswordStrengthMeter,
  checkPassword,
} from '../../../components/PasswordField';

type Me = {
  kind: 'firm' | 'platform';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [emailCurrent, setEmailCurrent] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [emailDone, setEmailDone] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then(setMe)
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  async function submit(): Promise<void> {
    setErr(null);
    setDone(false);
    if (next !== confirm) {
      setErr('Confirmation does not match the new password.');
      return;
    }
    const policy = checkPassword(next);
    if (!policy.meetsPolicy) {
      setErr('New password must be 8+ chars with upper, lower, and a digit.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'auth.changePassword',
        { currentPassword: current, newPassword: next },
        { token },
      );
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to change password');
    } finally {
      setBusy(false);
    }
  }

  async function changeEmail(): Promise<void> {
    setEmailErr(null);
    setEmailDone(false);
    setEmailBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ ok: true; email: string }>(
        'auth.changeEmail',
        { currentPassword: emailCurrent, newEmail },
        { token },
      );
      setEmailDone(true);
      setEmailCurrent('');
      setNewEmail('');
      setMe((m) => (m ? { ...m, email: r.email } : m));
    } catch (e) {
      setEmailErr(e instanceof Error ? e.message : 'Failed to change email');
    } finally {
      setEmailBusy(false);
    }
  }

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding = me.tenant?.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: me.kind === 'platform' ? 'platform' : 'firm',
    contextLabel: me.tenant?.displayName ?? 'Onsective',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Profile</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Update your account details and password.
            </p>
          </div>

          <Card>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <User size={16} />
              </div>
              <div>
                <CardTitle>Account</CardTitle>
                <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Signed in as <span className="font-mono">{me.email}</span>
                </CardBody>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Change password</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              Other active sessions stay signed in. We&rsquo;ll email you a confirmation.
            </CardBody>
            <div className="mt-4 space-y-3 max-w-md">
              <label className="block text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Current password</div>
                <PasswordField
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your current password"
                />
              </label>
              <label className="block text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">New password</div>
                <PasswordField
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  placeholder="New password"
                />
                <PasswordStrengthMeter password={next} />
              </label>
              <label className="block text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Confirm new password</div>
                <PasswordField
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Re-type the new password"
                />
                {confirm && next !== confirm ? (
                  <div className="mt-1 text-[11px] text-[var(--color-danger)]">
                    Doesn&rsquo;t match.
                  </div>
                ) : null}
              </label>
              {err ? <div className="text-xs text-[var(--color-danger)]">{err}</div> : null}
              {done ? (
                <div className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <Check size={12} />
                  Password updated.
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  onClick={submit}
                  disabled={busy || !current || !next || !confirm}
                >
                  {busy ? 'Saving…' : 'Update password'}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle>Change email</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              We&rsquo;ll notify your current address that the change happened.
            </CardBody>
            <div className="mt-4 space-y-3 max-w-md">
              <label className="block text-xs">
                <Label className="mb-1 block">New email</Label>
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@firm.com"
                />
              </label>
              <label className="block text-xs">
                <Label className="mb-1 block">Current password</Label>
                <PasswordField
                  value={emailCurrent}
                  onChange={(e) => setEmailCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              {emailErr ? (
                <div className="text-xs text-[var(--color-danger)]">{emailErr}</div>
              ) : null}
              {emailDone ? (
                <div className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                  <Check size={12} />
                  Email updated.
                </div>
              ) : null}
              <div className="flex justify-end">
                <Button
                  onClick={changeEmail}
                  disabled={emailBusy || !newEmail || !emailCurrent}
                >
                  {emailBusy ? 'Saving…' : 'Update email'}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Two-factor authentication</CardTitle>
                <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Manage authenticator app + passkeys.
                </CardBody>
              </div>
              <a
                href="/settings/security"
                className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-muted)]"
              >
                <ShieldCheck size={12} />
                Open security settings
              </a>
            </div>
          </Card>

          <CalendarCard />
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

type CalendarList = {
  configured: boolean;
  items: {
    id: string;
    provider: string;
    externalAccount: string;
    status: string;
    lastSyncedAt: string | null;
    lastError: string | null;
  }[];
};

function CalendarCard() {
  const [data, setData] = useState<CalendarList | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    const token = getAccessToken();
    const r = await rpcQuery<CalendarList>('calendar.list', undefined, { token });
    setData(r);
  }

  useEffect(() => {
    void load();
  }, []);

  async function disconnect(id: string): Promise<void> {
    if (!confirm('Disconnect this calendar? Future appointments stop syncing.')) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('calendar.disconnect', { id }, { token });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function connect(provider: 'google' | 'outlook'): void {
    if (typeof window === 'undefined') return;
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const token = getAccessToken();
    if (!token) return;
    window.location.href = `${apiBase}/api/v1/calendar/${provider}/connect?token=${encodeURIComponent(token)}`;
  }

  if (!data) return null;

  return (
    <Card>
      <CardTitle>Calendar sync</CardTitle>
      <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
        Push booked consultations to your Google Calendar automatically.
      </CardBody>

      {!data.configured ? (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-3 text-xs">
          Google Calendar isn&rsquo;t configured for this OnsecBoad install. Ask your firm
          admin or Onsective to set <span className="font-mono">GOOGLE_OAUTH_CLIENT_ID</span>{' '}
          + secret in the API .env.
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {data.items.length === 0 ? (
          <div className="text-xs text-[var(--color-text-muted)]">No calendars connected.</div>
        ) : (
          data.items.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
            >
              <div>
                <div className="text-sm font-medium">
                  {c.provider === 'google' ? 'Google Calendar' : c.provider}
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {c.externalAccount} · {c.status}
                  {c.lastSyncedAt
                    ? ` · last synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                    : ''}
                </div>
                {c.lastError ? (
                  <div className="mt-1 text-[11px] text-[var(--color-danger)]">
                    {c.lastError}
                  </div>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || c.status !== 'active'}
                onClick={() => disconnect(c.id)}
              >
                Disconnect
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => connect('google')}
          size="sm"
          variant="secondary"
          disabled={!data.configured}
          title={!data.configured ? 'Google OAuth not configured' : undefined}
        >
          Connect Google
        </Button>
        <Button
          onClick={() => connect('outlook')}
          size="sm"
          variant="secondary"
        >
          Connect Outlook
        </Button>
      </div>
    </Card>
  );
}
