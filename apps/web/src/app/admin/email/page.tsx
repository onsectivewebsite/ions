'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
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

type Metrics = {
  days: number;
  totalSent: number;
  byStatus: { status: string; count: number }[];
  perTenant: {
    tenantId: string;
    tenantName: string;
    sent: number;
    delivered: number;
    bounced: number;
    complained: number;
    bounceRate: number;
    complaintRate: number;
  }[];
};

const STATUS_TONE: Record<string, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  sent: 'info',
  delivered: 'success',
  opened: 'success',
  clicked: 'success',
  bounced: 'danger',
  complained: 'danger',
  failed: 'warning',
};

export default function PlatformEmailPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<Metrics | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);

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
    setData(null);
    rpcQuery<Metrics>('platform.email.metrics', { days }, { token }).then(setData);
  }, [me, days]);

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
  const totalDelivered =
    data?.byStatus.find((s) => s.status === 'delivered')?.count ??
    0 + (data?.byStatus.find((s) => s.status === 'opened')?.count ?? 0);
  const totalBounced = data?.byStatus.find((s) => s.status === 'bounced')?.count ?? 0;
  const totalComplained =
    data?.byStatus.find((s) => s.status === 'complained')?.count ?? 0;
  const overallBounceRate =
    data && data.totalSent > 0 ? totalBounced / data.totalSent : 0;
  const overallComplaintRate =
    data && data.totalSent > 0 ? totalComplained / data.totalSent : 0;

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
              <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Mail size={20} />
                Email deliverability
              </h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Cross-firm bounce / complaint / open metrics. Populated by{' '}
                <span className="font-mono">/api/v1/webhooks/email</span> from your SMTP
                provider.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-border)] p-1 text-xs">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={
                    'rounded-[var(--radius-pill)] px-3 py-1 ' +
                    (days === d
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
                  }
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Sent" value={(data?.totalSent ?? 0).toLocaleString()} />
            <Tile label="Delivered" value={totalDelivered.toLocaleString()} />
            <Tile
              label="Bounce rate"
              value={`${(overallBounceRate * 100).toFixed(2)}%`}
              tone={overallBounceRate > 0.05 ? 'warning' : 'ok'}
            />
            <Tile
              label="Complaint rate"
              value={`${(overallComplaintRate * 100).toFixed(2)}%`}
              tone={overallComplaintRate > 0.001 ? 'warning' : 'ok'}
            />
          </section>

          {data && data.byStatus.length > 0 ? (
            <Card>
              <CardTitle>Status breakdown</CardTitle>
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Count</th>
                    <th className="py-2 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-muted)]">
                  {data.byStatus.map((s) => (
                    <tr key={s.status}>
                      <td className="py-2.5">
                        <Badge tone={STATUS_TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{s.count.toLocaleString()}</td>
                      <td className="py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                        {data.totalSent > 0
                          ? `${((s.count / data.totalSent) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <Card>
            <CardTitle>Top firms by volume</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              High bounce or complaint rates can damage shared sender reputation. Investigate
              firms above 5% bounce or above 0.1% complaint.
            </CardBody>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Firm</th>
                    <th className="py-2 pr-4 text-right">Sent</th>
                    <th className="py-2 pr-4 text-right">Delivered</th>
                    <th className="py-2 pr-4 text-right">Bounced</th>
                    <th className="py-2 pr-4 text-right">Bounce %</th>
                    <th className="py-2 pr-4 text-right">Complaint %</th>
                  </tr>
                </thead>
                <tbody>
                  {data === null ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={6} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : data.perTenant.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-12 text-center text-xs text-[var(--color-text-muted)]"
                      >
                        No email activity in this window.
                      </td>
                    </tr>
                  ) : (
                    data.perTenant.map((t) => (
                      <tr
                        key={t.tenantId}
                        className="border-b border-[var(--color-border-muted)] hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4">
                          <Link
                            href={`/p/firms/${t.tenantId}`}
                            className="font-medium hover:underline"
                          >
                            {t.tenantName}
                          </Link>
                        </td>
                        <td className="py-3 pr-4 text-right tabular-nums">{t.sent}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{t.delivered}</td>
                        <td className="py-3 pr-4 text-right tabular-nums">{t.bounced}</td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums"
                          style={{
                            color: t.bounceRate > 0.05 ? 'var(--color-danger)' : undefined,
                          }}
                        >
                          {(t.bounceRate * 100).toFixed(2)}%
                        </td>
                        <td
                          className="py-3 pr-4 text-right tabular-nums"
                          style={{
                            color: t.complaintRate > 0.001 ? 'var(--color-danger)' : undefined,
                          }}
                        >
                          {(t.complaintRate * 100).toFixed(2)}%
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Wire your provider</CardTitle>
            <CardBody className="mt-2 space-y-2 text-sm text-[var(--color-text-muted)]">
              <p>
                The webhook endpoint{' '}
                <span className="font-mono">POST /api/v1/webhooks/email</span> accepts
                Postmark, SendGrid, Resend, and SES JSON shapes (auto-detected). Set the
                shared secret as{' '}
                <span className="font-mono">EMAIL_WEBHOOK_SECRET</span> in the API .env, and
                configure the same value at the provider as a Bearer token in the Authorization
                header.
              </p>
              <p className="text-xs">
                Hostinger SMTP doesn&rsquo;t emit deliverability events. To populate this page
                with real data, switch the API&rsquo;s SMTP creds to a transactional provider
                (Postmark / SendGrid / Resend / SES).
              </p>
            </CardBody>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warning';
}) {
  return (
    <Card>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div
        className="mt-1 text-2xl font-semibold tabular-nums"
        style={{ color: tone === 'warning' ? 'var(--color-danger)' : undefined }}
      >
        {value}
      </div>
    </Card>
  );
}
