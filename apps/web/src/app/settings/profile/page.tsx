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
          <OfficeHoursCard />
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

type OfficeHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [number, number] | null>
>;

const DAYS: { key: keyof OfficeHours; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const DEFAULT_HOURS: OfficeHours = {
  mon: [9, 17],
  tue: [9, 17],
  wed: [9, 17],
  thu: [9, 17],
  fri: [9, 17],
  sat: null,
  sun: null,
};

function OfficeHoursCard() {
  const [hours, setHours] = useState<OfficeHours | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    rpcQuery<OfficeHours | null>('user.getOfficeHours', undefined, { token })
      .then((r) => setHours(r ?? DEFAULT_HOURS))
      .catch(() => setHours(DEFAULT_HOURS));
  }, []);

  if (!hours) return null;

  function toggleDay(key: keyof OfficeHours): void {
    setHours((h) => {
      if (!h) return h;
      const cur = h[key];
      return { ...h, [key]: cur === null ? [9, 17] : null };
    });
  }
  function setOpen(key: keyof OfficeHours, value: number): void {
    setHours((h) => {
      if (!h) return h;
      const cur = h[key];
      if (!cur) return h;
      return { ...h, [key]: [value, cur[1]] };
    });
  }
  function setClose(key: keyof OfficeHours, value: number): void {
    setHours((h) => {
      if (!h) return h;
      const cur = h[key];
      if (!cur) return h;
      return { ...h, [key]: [cur[0], value] };
    });
  }
  async function save(): Promise<void> {
    if (!hours) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      // Backfill any missing day keys with null so the schema accepts.
      const full: OfficeHours = {
        mon: hours.mon ?? null,
        tue: hours.tue ?? null,
        wed: hours.wed ?? null,
        thu: hours.thu ?? null,
        fri: hours.fri ?? null,
        sat: hours.sat ?? null,
        sun: hours.sun ?? null,
      };
      await rpcMutation('user.updateOfficeHours', full, { token });
      setSavedAt(new Date());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Office hours</CardTitle>
      <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
        When can clients be booked with you? Booking dialog warns staff when they pick a
        time outside these windows. Doesn&rsquo;t hard-block — overrides are still allowed.
      </CardBody>
      <div className="mt-4 space-y-2">
        {DAYS.map(({ key, label }) => {
          const window = hours[key] ?? null;
          const off = window === null;
          return (
            <div
              key={key}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-2"
            >
              <label className="flex w-20 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={() => toggleDay(key)}
                  className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                />
                <span className="font-medium">{label}</span>
              </label>
              {window ? (
                <>
                  <select
                    value={window[0]}
                    onChange={(e) => setOpen(key, Number(e.target.value))}
                    className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                  >
                    {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-[var(--color-text-muted)]">to</span>
                  <select
                    value={window[1]}
                    onChange={(e) => setClose(key, Number(e.target.value))}
                    className="h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                  >
                    {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                      <option key={h} value={h}>
                        {h}:00
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="text-xs text-[var(--color-text-muted)]">Off</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
            <Check size={12} />
            Saved {savedAt.toLocaleTimeString()}
          </span>
        ) : null}
        <Button onClick={save} disabled={busy} size="sm">
          {busy ? 'Saving…' : 'Save hours'}
        </Button>
      </div>
    </Card>
  );
}

type CalendarList = {
  configured: boolean;
  googleConfigured: boolean;
  outlookConfigured: boolean;
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

      {!data.googleConfigured || !data.outlookConfigured ? (
        <div className="mt-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] p-3 text-xs">
          {!data.googleConfigured && !data.outlookConfigured ? (
            <p>No calendar provider is configured for this install yet.</p>
          ) : !data.googleConfigured ? (
            <p>Google Calendar isn&rsquo;t configured.</p>
          ) : (
            <p>Outlook / Microsoft 365 isn&rsquo;t configured.</p>
          )}
          <details className="cursor-pointer">
            <summary className="font-medium">How to enable</summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed">
              {!data.googleConfigured ? (
                <div>
                  <div className="font-medium">Google</div>
                  <ol className="ml-4 list-decimal space-y-0.5">
                    <li>Open Google Cloud Console → APIs &amp; Services → Credentials.</li>
                    <li>Create an OAuth 2.0 Client ID (type: Web application).</li>
                    <li>
                      Add redirect URI:{' '}
                      <span className="font-mono">
                        {(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '') ||
                          'https://api.onsective.cloud'}
                        /api/v1/calendar/google/callback
                      </span>
                    </li>
                    <li>
                      Set <span className="font-mono">GOOGLE_OAUTH_CLIENT_ID</span> and{' '}
                      <span className="font-mono">GOOGLE_OAUTH_CLIENT_SECRET</span> in the API env, restart.
                    </li>
                  </ol>
                </div>
              ) : null}
              {!data.outlookConfigured ? (
                <div>
                  <div className="font-medium">Outlook / Microsoft 365</div>
                  <ol className="ml-4 list-decimal space-y-0.5">
                    <li>Open Azure Portal → App Registrations → New registration.</li>
                    <li>Account types: any Microsoft account (multitenant + personal).</li>
                    <li>
                      Add redirect URI (Web):{' '}
                      <span className="font-mono">
                        {(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '') ||
                          'https://api.onsective.cloud'}
                        /api/v1/calendar/outlook/callback
                      </span>
                    </li>
                    <li>API permissions → add Calendars.ReadWrite (delegated).</li>
                    <li>Certificates &amp; Secrets → New client secret.</li>
                    <li>
                      Set <span className="font-mono">MS_OAUTH_CLIENT_ID</span> and{' '}
                      <span className="font-mono">MS_OAUTH_CLIENT_SECRET</span> in the API env, restart.
                    </li>
                  </ol>
                </div>
              ) : null}
            </div>
          </details>
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
          disabled={!data.googleConfigured}
          title={!data.googleConfigured ? 'Google OAuth not configured' : undefined}
        >
          Connect Google
        </Button>
        <Button
          onClick={() => connect('outlook')}
          size="sm"
          variant="secondary"
          disabled={!data.outlookConfigured}
          title={!data.outlookConfigured ? 'Microsoft OAuth not configured' : undefined}
        >
          Connect Outlook
        </Button>
      </div>
    </Card>
  );
}
