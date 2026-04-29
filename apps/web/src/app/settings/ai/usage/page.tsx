'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { Badge, Card, CardTitle, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  twoFAEnrolled: boolean;
  tenant: { displayName: string; branding: Branding };
};

type Summary = {
  from: string;
  to: string;
  callCount: number;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costCents: number;
  };
  byFeature: Array<{
    feature: string;
    callCount: number;
    inputTokens: number;
    outputTokens: number;
    costCents: number;
  }>;
  byModel: Array<{ model: string; callCount: number; costCents: number }>;
  byMode: Array<{ mode: string; callCount: number; costCents: number }>;
};

type Row = {
  id: string;
  feature: string;
  model: string;
  mode: 'real' | 'dry-run';
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  refType: string | null;
  refId: string | null;
  createdAt: string;
};

type Range = '7d' | '30d' | '90d';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function rangeBoundary(r: Range): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  const days = r === '7d' ? 7 : r === '30d' ? 30 : 90;
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function AiUsagePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [range, setRange] = useState<Range>('30d');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    const bounds = rangeBoundary(range);
    const [m, s, l] = await Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Summary>('aiUsage.summary', bounds, { token }),
      rpcQuery<{ items: Row[]; total: number }>(
        'aiUsage.list',
        { ...bounds, page: 1, pageSize: 50 },
        { token },
      ),
    ]);
    setMe(m);
    setSummary(s);
    setRows(l.items);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (!me || !summary || rows === null) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32" />
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

  const maxFeatureCost = Math.max(1, ...summary.byFeature.map((f) => f.costCents));

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <Link
            href="/settings/ai"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} /> AI settings
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Settings · AI</div>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <BarChart3 size={20} className="text-[var(--color-primary)]" /> Usage
              </h1>
            </div>
            <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-xs">
              {(['7d', '30d', '90d'] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`rounded-[var(--radius-md)] px-3 py-1.5 ${
                    range === r
                      ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'Last 90 days'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Tile label="Total cost" value={fmtMoney(summary.totals.costCents)} />
            <Tile label="API calls" value={String(summary.callCount)} />
            <Tile label="Input tokens" value={fmtTokens(summary.totals.inputTokens)} />
            <Tile label="Output tokens" value={fmtTokens(summary.totals.outputTokens)} />
          </div>

          <Card>
            <CardTitle>By feature</CardTitle>
            {summary.byFeature.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                No AI calls in this window yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.byFeature.map((f) => {
                  const pct = (f.costCents / maxFeatureCost) * 100;
                  return (
                    <li key={f.feature}>
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium uppercase">{f.feature}</span>
                        <span className="text-[var(--color-text-muted)]">
                          {f.callCount} call{f.callCount === 1 ? '' : 's'} ·{' '}
                          {fmtTokens(f.inputTokens + f.outputTokens)} tokens ·{' '}
                          <strong className="text-[var(--color-text)]">
                            {fmtMoney(f.costCents)}
                          </strong>
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                        <div
                          className="h-full bg-[var(--color-primary)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardTitle>By model</CardTitle>
              {summary.byModel.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">No data.</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {summary.byModel.map((m) => (
                    <li key={m.model} className="flex justify-between">
                      <span className="font-mono text-xs">{m.model}</span>
                      <span className="text-[var(--color-text-muted)]">
                        {m.callCount} · {fmtMoney(m.costCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardTitle>Real vs dry-run</CardTitle>
              {summary.byMode.length === 0 ? (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">No data.</p>
              ) : (
                <ul className="mt-3 space-y-1 text-sm">
                  {summary.byMode.map((m) => (
                    <li key={m.mode} className="flex justify-between">
                      <Badge tone={m.mode === 'real' ? 'success' : 'neutral'}>{m.mode}</Badge>
                      <span className="text-[var(--color-text-muted)]">
                        {m.callCount} · {fmtMoney(m.costCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardTitle>Recent calls</CardTitle>
            {rows.length === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">No calls yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2">When</th>
                    <th className="py-2">Feature</th>
                    <th className="py-2">Model</th>
                    <th className="py-2 text-right">In/Cached/Out</th>
                    <th className="py-2 text-right">Cost</th>
                    <th className="py-2">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--color-border-muted)]">
                      <td className="py-2 text-xs text-[var(--color-text-muted)]">
                        {new Date(r.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 uppercase">{r.feature}</td>
                      <td className="py-2 font-mono text-xs">{r.model}</td>
                      <td className="py-2 text-right text-xs">
                        {fmtTokens(r.inputTokens)} / {fmtTokens(r.cachedInputTokens)} /{' '}
                        {fmtTokens(r.outputTokens)}
                      </td>
                      <td className="py-2 text-right font-medium">{fmtMoney(r.costCents)}</td>
                      <td className="py-2">
                        <Badge tone={r.mode === 'real' ? 'success' : 'neutral'}>{r.mode}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </Card>
  );
}
