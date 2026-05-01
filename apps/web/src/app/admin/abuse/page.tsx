'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
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

type Signal<T extends string> = {
  tenantId: string;
  tenantName: string;
} & { [K in T]: number };

type Signals = {
  failedLogins: Signal<'count'>[];
  smsVolume: Signal<'count'>[];
  aiCost: Signal<'costCents'>[];
  suppressionGrowth: Signal<'count'>[];
};

const THRESHOLDS = {
  failedLogins: 50, // 24h
  smsVolume: 5000, // 7d
  aiCostCents: 100_000, // $1000 in 7d
  suppressionGrowth: 100, // 7d
};

export default function PlatformAbusePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<Signals | null>(null);

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
    rpcQuery<Signals>('platform.abuse.signals', undefined, { token }).then(setData);
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

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <ShieldAlert size={20} />
              Abuse signals
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Top 10 firms per signal. Cells turn red above the threshold — click into the
              firm to investigate, suspend, or contact.
            </p>
          </div>

          <SignalCard
            title="Failed logins (24h)"
            description="High counts often mean credential stuffing or a misconfigured client. >50 hits/24h is unusual for a single firm."
            rows={data?.failedLogins ?? null}
            value={(r) => r.count}
            format={(n) => n.toLocaleString()}
            threshold={THRESHOLDS.failedLogins}
          />
          <SignalCard
            title="SMS volume (7d)"
            description="Excess SMS sends drive Twilio bills + spam complaints. >5000 in 7d for a small firm is worth a phone call."
            rows={data?.smsVolume ?? null}
            value={(r) => r.count}
            format={(n) => n.toLocaleString()}
            threshold={THRESHOLDS.smsVolume}
          />
          <SignalCard
            title="AI spend (7d)"
            description="Runaway AI spend usually means a stuck loop. Tier limits are per-firm in /settings/ai but the platform side checks too."
            rows={data?.aiCost ?? null}
            value={(r) => r.costCents}
            format={(n) => `$${(n / 100).toFixed(2)}`}
            threshold={THRESHOLDS.aiCostCents}
          />
          <SignalCard
            title="Suppression list growth (7d)"
            description="CASL: every unsubscribe / hard-bounce adds a row. Sudden growth = a campaign hit a bad list."
            rows={data?.suppressionGrowth ?? null}
            value={(r) => r.count}
            format={(n) => n.toLocaleString()}
            threshold={THRESHOLDS.suppressionGrowth}
          />
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function SignalCard<T extends { tenantId: string; tenantName: string }>({
  title,
  description,
  rows,
  value,
  format,
  threshold,
}: {
  title: string;
  description: string;
  rows: T[] | null;
  value: (r: T) => number;
  format: (n: number) => string;
  threshold: number;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
        {description}
      </CardBody>
      <div className="mt-3">
        {rows === null ? (
          <Skeleton className="h-32" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            No activity. Healthy.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <tr>
                <th className="py-2 text-left font-medium">Firm</th>
                <th className="py-2 text-right font-medium">Value</th>
                <th className="py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-muted)]">
              {rows.map((r) => {
                const v = value(r);
                const flagged = v > threshold;
                return (
                  <tr key={r.tenantId}>
                    <td className="py-2.5">
                      <Link
                        href={`/p/firms/${r.tenantId}`}
                        className="font-medium hover:underline"
                      >
                        {r.tenantName}
                      </Link>
                    </td>
                    <td
                      className="py-2.5 text-right tabular-nums"
                      style={{ color: flagged ? 'var(--color-danger)' : undefined }}
                    >
                      {format(v)}
                    </td>
                    <td className="py-2.5 text-right">
                      {flagged ? (
                        <Badge tone="danger">Investigate</Badge>
                      ) : (
                        <Badge tone="neutral">Normal</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
