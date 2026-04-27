'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Phone, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type ConfigResp = {
  configured: boolean;
  mode: 'real' | 'dry-run';
  accountSidMasked: string | null;
  twimlAppSidMasked: string | null;
  phoneNumber: string | null;
  recordOutbound: boolean;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function TwilioSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [twimlAppSid, setTwimlAppSid] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [recordOutbound, setRecordOutbound] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<ConfigResp>('twilioConfig.get', undefined, { token });
      setConfig(r);
      if (r.phoneNumber) setPhoneNumber(r.phoneNumber);
      setRecordOutbound(r.recordOutbound);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ mode: 'real' | 'dry-run' }>(
        'twilioConfig.update',
        {
          accountSid: accountSid || undefined,
          authToken: authToken || undefined,
          twimlAppSid: twimlAppSid || undefined,
          phoneNumber,
          recordOutbound,
        },
        { token },
      );
      setInfo(`Saved · mode: ${r.mode}`);
      setAccountSid('');
      setAuthToken('');
      setTwimlAppSid('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    if (!confirm('Clear Twilio config? Calls + SMS will fall back to dry-run.')) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('twilioConfig.clear', undefined, { token });
      setInfo('Twilio config cleared.');
      setPhoneNumber('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !config) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <div>
            <Link
              href="/settings"
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <ArrowLeft size={12} />
              Back to settings
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Twilio integration</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Per-firm Voice + SMS credentials. Stored encrypted at rest. Until you set real
              credentials below, calls and SMS run in <strong>dry-run mode</strong> — they write
              CallLog / SmsLog rows but don&apos;t actually dial out.
            </p>
          </div>

          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Status</CardTitle>
              <Badge tone={config.mode === 'real' ? 'success' : 'warning'}>
                {config.mode === 'real' ? '● Connected' : 'Dry-run'}
              </Badge>
            </div>
            {config.configured ? (
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <Row label="Account SID">
                  <span className="font-mono">{config.accountSidMasked}</span>
                </Row>
                <Row label="Phone number">
                  <span className="font-mono">{config.phoneNumber}</span>
                </Row>
                <Row label="TwiML App SID">
                  {config.twimlAppSidMasked ? (
                    <span className="font-mono">{config.twimlAppSidMasked}</span>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">—</span>
                  )}
                </Row>
                <Row label="Record outbound">
                  {config.recordOutbound ? <Badge tone="success">Yes</Badge> : <Badge tone="neutral">No</Badge>}
                </Row>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                No credentials configured. The system is operating in dry-run.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Update credentials</CardTitle>
            <form onSubmit={save} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="sid">Account SID</Label>
                <Input
                  id="sid"
                  value={accountSid}
                  onChange={(e) => setAccountSid(e.target.value)}
                  placeholder={config.accountSidMasked ? `Leave blank to keep current (${config.accountSidMasked})` : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="tok">Auth Token</Label>
                  <button
                    type="button"
                    onClick={() => setShowToken((s) => !s)}
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    {showToken ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showToken ? 'Hide' : 'Show'}
                  </button>
                </div>
                <Input
                  id="tok"
                  type={showToken ? 'text' : 'password'}
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder={config.configured ? 'Leave blank to keep current' : '32-char auth token from Twilio Console'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="app">TwiML App SID (optional — needed only for browser softphone)</Label>
                <Input
                  id="app"
                  value={twimlAppSid}
                  onChange={(e) => setTwimlAppSid(e.target.value)}
                  placeholder={config.twimlAppSidMasked ? `Leave blank to keep (${config.twimlAppSidMasked})` : 'APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="num">Phone number * (E.164)</Label>
                <Input
                  id="num"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+14165550100"
                  className="font-mono"
                  required
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Outbound caller ID + inbound destination. Must be a number you own in your Twilio account.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={recordOutbound}
                  onChange={(e) => setRecordOutbound(e.target.checked)}
                />
                Record outbound calls
              </label>
              <div className="flex items-center justify-between border-t border-[var(--color-border-muted)] pt-4">
                {config.configured ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={clear}>
                    <Trash2 size={14} /> Clear config
                  </Button>
                ) : (
                  <span></span>
                )}
                <Button type="submit" disabled={busy || !phoneNumber}>
                  {busy ? <Spinner /> : <Phone size={14} />}
                  Save
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle>Webhook URLs to configure in Twilio Console</CardTitle>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Once you have real Twilio credentials, paste these URLs into your Twilio phone number&apos;s
              configuration so inbound calls + delivery + recording status reach OnsecBoad.
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              <li>
                <span className="font-medium">Voice status callback:</span>{' '}
                <code className="block break-all rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
                  https://api.onsective.cloud/api/v1/webhooks/twilio-voice/status
                </code>
              </li>
              <li>
                <span className="font-medium">Recording status callback:</span>{' '}
                <code className="block break-all rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
                  https://api.onsective.cloud/api/v1/webhooks/twilio-recording/status
                </code>
              </li>
              <li>
                <span className="font-medium">Inbound SMS webhook:</span>{' '}
                <code className="block break-all rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
                  https://api.onsective.cloud/api/v1/webhooks/twilio-sms/incoming
                </code>
              </li>
            </ul>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
