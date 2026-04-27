'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Music2, Trash2 } from 'lucide-react';
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
  advertiserId: string | null;
  accessTokenMasked: string | null;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function TikTokSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [advertiserId, setAdvertiserId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<ConfigResp>('tiktokConfig.get', undefined, { token });
      setConfig(r);
      if (r.advertiserId) setAdvertiserId(r.advertiserId);
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
        'tiktokConfig.update',
        {
          advertiserId,
          appSecret: appSecret || undefined,
          accessToken: accessToken || undefined,
        },
        { token },
      );
      setInfo(`Saved · mode: ${r.mode}`);
      setAppSecret('');
      setAccessToken('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    if (!confirm('Clear TikTok config? Inbound TikTok lead webhooks will be ignored.')) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('tiktokConfig.clear', undefined, { token });
      setInfo('TikTok config cleared.');
      setAdvertiserId('');
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
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">TikTok Lead Generation</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Receive leads from TikTok lead-gen ads. Until you save real credentials, the webhook
              runs in <strong>dry-run mode</strong>.
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
                <Row label="Advertiser ID">
                  <span className="font-mono">{config.advertiserId}</span>
                </Row>
                <Row label="Access token">
                  <span className="font-mono">{config.accessTokenMasked ?? '—'}</span>
                </Row>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                No TikTok credentials configured.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Configure TikTok</CardTitle>
            <form onSubmit={save} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="adv">Advertiser ID *</Label>
                <Input
                  id="adv"
                  value={advertiserId}
                  onChange={(e) => setAdvertiserId(e.target.value)}
                  placeholder="7000000000000000000"
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label htmlFor="secret">App secret</Label>
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    {showSecret ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showSecret ? 'Hide' : 'Show'}
                  </button>
                </div>
                <Input
                  id="secret"
                  type={showSecret ? 'text' : 'password'}
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={config.configured ? 'Leave blank to keep current' : 'App secret from TikTok Marketing API'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="tok">Access token</Label>
                <Input
                  id="tok"
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={config.configured ? 'Leave blank to keep current' : 'Long-lived advertiser access token'}
                  className="font-mono text-xs"
                />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--color-border-muted)] pt-4">
                {config.configured ? (
                  <Button type="button" variant="danger" disabled={busy} onClick={clear}>
                    <Trash2 size={14} /> Clear config
                  </Button>
                ) : (
                  <span></span>
                )}
                <Button type="submit" disabled={busy || !advertiserId}>
                  {busy ? <Spinner /> : <Music2 size={14} />} Save
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle>Webhook URL</CardTitle>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Paste this into your TikTok Marketing API webhook configuration. Subscribe to the{' '}
              <code>lead.create</code> event.
            </p>
            <code className="mt-3 block break-all rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 text-xs">
              https://api.onsective.cloud/api/v1/webhooks/tiktok-leads
            </code>
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
