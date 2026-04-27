'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Facebook, Trash2 } from 'lucide-react';
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
  pageId: string | null;
  verifyTokenMasked: string | null;
  pageAccessTokenMasked: string | null;
  graphApiVersion: string;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function MetaSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<ConfigResp | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pageId, setPageId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [pageAccessToken, setPageAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [graphApiVersion, setGraphApiVersion] = useState('v19.0');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<ConfigResp>('metaConfig.get', undefined, { token });
      setConfig(r);
      if (r.pageId) setPageId(r.pageId);
      if (r.graphApiVersion) setGraphApiVersion(r.graphApiVersion);
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
        'metaConfig.update',
        {
          pageId,
          appSecret: appSecret || undefined,
          pageAccessToken: pageAccessToken || undefined,
          verifyToken: verifyToken || undefined,
          graphApiVersion,
        },
        { token },
      );
      setInfo(`Saved · mode: ${r.mode}`);
      setAppSecret('');
      setPageAccessToken('');
      setVerifyToken('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    if (!confirm('Clear Meta config? Inbound Meta lead webhooks will be ignored.')) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('metaConfig.clear', undefined, { token });
      setInfo('Meta config cleared.');
      setPageId('');
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
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Meta Lead Ads</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Receive leads from Facebook + Instagram lead-gen forms in real time. Until you save
              real credentials below, the webhook runs in <strong>dry-run mode</strong> — calls are
              accepted but signature verification is skipped.
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
                <Row label="Page ID">
                  <span className="font-mono">{config.pageId}</span>
                </Row>
                <Row label="Graph API">{config.graphApiVersion}</Row>
                <Row label="App secret">
                  <span className="font-mono">{config.verifyTokenMasked ? '••••' : '—'}</span>
                </Row>
                <Row label="Page access token">
                  <span className="font-mono">{config.pageAccessTokenMasked ?? '—'}</span>
                </Row>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                No Meta credentials configured.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Configure Meta</CardTitle>
            <form onSubmit={save} className="mt-4 space-y-4">
              <div>
                <Label htmlFor="page">Page ID *</Label>
                <Input
                  id="page"
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="1234567890"
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
                  placeholder={config.configured ? 'Leave blank to keep current' : 'App secret from Meta App Dashboard'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="pat">Page access token</Label>
                <Input
                  id="pat"
                  type="password"
                  value={pageAccessToken}
                  onChange={(e) => setPageAccessToken(e.target.value)}
                  placeholder={config.configured ? 'Leave blank to keep current' : 'Long-lived page access token'}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="vt">Verify token</Label>
                <Input
                  id="vt"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder={config.configured ? 'Leave blank to keep current' : 'Any string — must match what you enter in Meta'}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Echoed back during Meta&apos;s subscription handshake. Pick anything random.
                </p>
              </div>
              <div>
                <Label htmlFor="gv">Graph API version</Label>
                <Input
                  id="gv"
                  value={graphApiVersion}
                  onChange={(e) => setGraphApiVersion(e.target.value)}
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
                <Button type="submit" disabled={busy || !pageId}>
                  {busy ? <Spinner /> : <Facebook size={14} />} Save
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardTitle>Webhook URL</CardTitle>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Paste this into your Meta App → Webhooks → Page subscription. Subscribe to the{' '}
              <code>leadgen</code> field. The verify token must match the one you saved here.
            </p>
            <code className="mt-3 block break-all rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 text-xs">
              https://api.onsective.cloud/api/v1/webhooks/meta-leads
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
