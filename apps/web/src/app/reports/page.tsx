'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, BarChart3, Download, MessageSquare, Phone, TrendingUp, Users } from 'lucide-react';
import {
  Card,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type KpiSummary = {
  range: { from: string; to: string };
  leads: {
    total: number;
    converted: number;
    conversionRate: number;
    bySource: Array<{ source: string; count: number }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  calls: { total: number; completed: number; answerRate: number };
  sms: { total: number; inbound: number };
  perAgent: Array<{
    agentId: string;
    agentName: string;
    calls: number;
    totalDurationSec: number;
    conversions: number;
  }>;
};

type Me = {
  kind: 'firm' | 'platform';
  name: string;
  email: string;
  tenant?: { displayName: string; branding: Branding };
};

const RANGES: Array<{ key: '7' | '30' | '90'; label: string; days: number }> = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
];

export default function ReportsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<KpiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<'7' | '30' | '90'>('30');

  const range = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === rangeKey)!;
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - cfg.days);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangeKey]);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [m, k] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<KpiSummary>('kpi.summary', range, { token }),
      ]);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setData(k);
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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, rangeKey]);

  if (!me || !data) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
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
    scope: 'firm',
    contextLabel: me.tenant?.displayName ?? '',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Reports</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">KPI dashboard</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Lead, call, and conversion metrics over the selected window.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!data}
                onClick={() => exportReportCsv(data, RANGES.find((r) => r.key === rangeKey)!.label)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-medium hover:bg-[var(--color-surface-muted)] disabled:opacity-40"
              >
                <Download size={12} />
                Export CSV
              </button>
              <div className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border)] p-1 text-xs">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRangeKey(r.key)}
                    className={
                      'rounded-[var(--radius-pill)] px-3 py-1 ' +
                      (rangeKey === r.key
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
                    }
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile icon={Users} label="Leads" value={data.leads.total} />
            <KpiTile
              icon={TrendingUp}
              label="Converted"
              value={data.leads.converted}
              hint={`${(data.leads.conversionRate * 100).toFixed(1)}% rate`}
            />
            <KpiTile
              icon={Phone}
              label="Calls"
              value={data.calls.total}
              hint={`${(data.calls.answerRate * 100).toFixed(1)}% answered`}
            />
            <KpiTile
              icon={MessageSquare}
              label="SMS"
              value={data.sms.total}
              hint={`${data.sms.inbound} inbound`}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardTitle>Leads by source</CardTitle>
              <BarRow rows={data.leads.bySource.map((r) => ({ label: r.source, value: r.count }))} />
            </Card>
            <Card>
              <CardTitle>Leads by status</CardTitle>
              <BarRow rows={data.leads.byStatus.map((r) => ({ label: r.status, value: r.count }))} />
            </Card>
          </div>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Per-agent activity</CardTitle>
              <BarChart3 size={14} className="text-[var(--color-text-muted)]" />
            </div>
            {data.perAgent.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-muted)]">
                <Activity size={20} className="mx-auto mb-2 opacity-40" />
                No call activity in this window.
              </div>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2 text-left font-medium">Agent</th>
                    <th className="py-2 text-right font-medium">Calls</th>
                    <th className="py-2 text-right font-medium">Talk time</th>
                    <th className="py-2 text-right font-medium">Conversions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-muted)]">
                  {data.perAgent.map((a) => (
                    <tr key={a.agentId}>
                      <td className="py-2.5 font-medium">{a.agentName}</td>
                      <td className="py-2.5 text-right">{a.calls}</td>
                      <td className="py-2.5 text-right text-[var(--color-text-muted)]">
                        {fmtDuration(a.totalDurationSec)}
                      </td>
                      <td className="py-2.5 text-right">{a.conversions}</td>
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

function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
          <Icon size={16} />
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
          {hint ? <div className="text-xs text-[var(--color-text-muted)]">{hint}</div> : null}
        </div>
      </div>
    </Card>
  );
}

function BarRow({ rows }: { rows: Array<{ label: string; value: number }> }) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">No data</div>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="mt-3 space-y-2 text-xs">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-[var(--color-text-muted)]">{r.label}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)]">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--color-primary)]"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="w-10 text-right tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportReportCsv(data: KpiSummary | null, rangeLabel: string): void {
  if (!data || typeof window === 'undefined') return;
  const lines: string[] = [];
  lines.push(`# OnsecBoad report — ${rangeLabel}`);
  lines.push(`# Range: ${data.range.from} → ${data.range.to}`);
  lines.push('');
  lines.push('Section,Metric,Value');
  lines.push(`Headline,Leads total,${data.leads.total}`);
  lines.push(`Headline,Leads converted,${data.leads.converted}`);
  lines.push(`Headline,Conversion rate,${(data.leads.conversionRate * 100).toFixed(2)}%`);
  lines.push(`Headline,Calls total,${data.calls.total}`);
  lines.push(`Headline,Calls completed,${data.calls.completed}`);
  lines.push(`Headline,Answer rate,${(data.calls.answerRate * 100).toFixed(2)}%`);
  lines.push(`Headline,SMS total,${data.sms.total}`);
  lines.push(`Headline,SMS inbound,${data.sms.inbound}`);
  lines.push('');
  lines.push('Leads by source,Source,Count');
  for (const r of data.leads.bySource) {
    lines.push(`Leads by source,${csvEscape(r.source)},${r.count}`);
  }
  lines.push('');
  lines.push('Leads by status,Status,Count');
  for (const r of data.leads.byStatus) {
    lines.push(`Leads by status,${csvEscape(r.status)},${r.count}`);
  }
  lines.push('');
  lines.push('Per-agent activity,Agent,Calls,Talk seconds,Conversions');
  for (const a of data.perAgent) {
    lines.push(
      `Per-agent activity,${csvEscape(a.agentName)},${a.calls},${a.totalDurationSec},${a.conversions}`,
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const filename = `onsecboad-report-${rangeLabel.replace(/\s+/g, '')}-${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
