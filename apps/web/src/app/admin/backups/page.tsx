'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Inbox } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Me = { kind: 'platform' | 'firm'; name: string; email: string };

type BackupResp = {
  dryRun: boolean;
  items: { key: string; size: number; lastModified: string | null }[];
  newest: string | null;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ageOf(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)} min ago`;
  if (h < 48) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

export default function PlatformBackupsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<BackupResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'platform') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  useEffect(() => {
    if (!me) return;
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<BackupResp>('platform.backups.list', undefined, { token })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load backups'));
  }, [me]);

  if (!me) {
    return (
      <main className="grid min-h-screen md:grid-cols-[240px_1fr]">
        <div className="hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:block">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-4 sm:p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding: Branding = { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };
  const newestAgeHours = data?.newest
    ? (Date.now() - new Date(data.newest).getTime()) / 3_600_000
    : null;
  const status: 'fresh' | 'stale' | 'missing' = !data?.newest
    ? 'missing'
    : newestAgeHours !== null && newestAgeHours > 36
      ? 'stale'
      : 'fresh';

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Database size={20} />
              Backups
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Encrypted nightly Postgres dumps stored in R2. Restore is a runbook step — not
              in-app — see{' '}
              <span className="font-mono">infra/runbooks/restore.md</span>.
            </p>
          </div>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <div className="text-xs text-[var(--color-text-muted)]">Most recent</div>
              <div className="mt-1 text-lg font-semibold">
                {data?.newest ? new Date(data.newest).toLocaleString() : '—'}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {data?.newest ? ageOf(data.newest) : 'No backups found'}
              </div>
              <div className="mt-2">
                <Badge
                  tone={
                    status === 'fresh' ? 'success' : status === 'stale' ? 'warning' : 'danger'
                  }
                >
                  {status === 'fresh'
                    ? 'Fresh (< 36h)'
                    : status === 'stale'
                      ? 'Stale (> 36h)'
                      : 'Missing'}
                </Badge>
              </div>
            </Card>
            <Card>
              <div className="text-xs text-[var(--color-text-muted)]">Total objects</div>
              <div className="mt-1 text-lg font-semibold">{data?.items.length ?? '—'}</div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                Listing latest 50 under <span className="font-mono">backups/</span>.
              </div>
            </Card>
            <Card>
              <div className="text-xs text-[var(--color-text-muted)]">R2 mode</div>
              <div className="mt-1 text-lg font-semibold">
                {data?.dryRun ? 'Dry-run' : 'Connected'}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                {data?.dryRun
                  ? 'Configure R2 credentials in API .env to list real backups.'
                  : 'Listing is read-only; nothing is mutated.'}
              </div>
            </Card>
          </section>

          {err ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {err}
            </div>
          ) : null}

          <Card>
            <CardTitle>Backup objects</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              Each row is one nightly dump. Filename includes the date. Files are
              openssl-encrypted; the passphrase lives in the operator&rsquo;s 1Password.
            </CardBody>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Key</th>
                    <th className="py-2 pr-4">Size</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {data === null ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={4} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : data.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <Inbox size={20} />
                        </div>
                        <div className="text-sm font-medium">
                          {data.dryRun
                            ? 'R2 not configured.'
                            : 'No backups found in this bucket.'}
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          {data.dryRun
                            ? 'Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY in the API env.'
                            : 'Verify pg_backup.sh cron is running on the host.'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    data.items.map((it) => (
                      <tr
                        key={it.key}
                        className="border-b border-[var(--color-border-muted)] hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4 font-mono text-xs">{it.key}</td>
                        <td className="py-3 pr-4 tabular-nums">{fmtBytes(it.size)}</td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {it.lastModified ? new Date(it.lastModified).toLocaleString() : '—'}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {ageOf(it.lastModified)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>How to restore</CardTitle>
            <CardBody className="mt-2 space-y-2 text-sm text-[var(--color-text-muted)]">
              <p>
                Restore is intentionally manual — the wrong file at the wrong moment can
                blow away production. Follow the runbook:
              </p>
              <ol className="ml-4 list-decimal space-y-1">
                <li>SSH to the prod host as <span className="font-mono">ions-api</span>.</li>
                <li>Pick the backup key from the table above.</li>
                <li>
                  Run <span className="font-mono">infra/scripts/pg_restore.sh &lt;key&gt;</span>{' '}
                  from the API repo root.
                </li>
                <li>The script downloads, decrypts, drops the active DB, and re-imports.</li>
                <li>
                  Verify with <span className="font-mono">psql ... -c &apos;select count(*) from &quot;Tenant&quot;&apos;</span>.
                </li>
              </ol>
              <p className="text-xs">
                Do a quarterly restore drill against a staging DB —{' '}
                <span className="font-mono">infra/scripts/restore_drill.sh</span>.
              </p>
            </CardBody>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
