'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronRight, Clock, MessageSquare, Phone, TrendingUp } from 'lucide-react';
import {
  Badge,
  Card,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';
import { useRealtime } from '../../lib/realtime';

type QueueLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: 'NEW' | 'CONTACTED' | 'FOLLOWUP' | 'INTERESTED';
  source: string;
  language: string | null;
  caseInterest: string | null;
  followupDueAt: string | null;
  lastContactedAt: string | null;
  createdAt: string;
};

type QueueResp = {
  open: QueueLead[];
  stats: {
    openCount: number;
    followupsDue: number;
    callsToday: number;
    conversionsToday: number;
    smsInboundToday: number;
  };
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  role: { name: string };
  tenant: { displayName: string; branding: Branding };
};

const STATUS_TONE: Record<QueueLead['status'], 'success' | 'neutral' | 'warning'> = {
  NEW: 'success',
  CONTACTED: 'neutral',
  FOLLOWUP: 'warning',
  INTERESTED: 'success',
};

export default function QueuePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<QueueResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [m, q] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<QueueResp>('lead.myQueue', undefined, { token }),
      ]);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setData(q);
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
  }, [router]);

  // Reload on lead-assigned / sms-received / call-completed so the queue and
  // stats stay fresh without manual refresh. Throttle: skip if a refresh is
  // already in-flight (handled by load() being idempotent).
  useRealtime((ev) => {
    if (
      ev.type === 'lead.assigned' ||
      ev.type === 'sms.received' ||
      (ev.type === 'call.status' && ev.status === 'completed')
    ) {
      setPulse((p) => p + 1);
    }
  });
  useEffect(() => {
    if (pulse === 0) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

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
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">My queue</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {greeting()}, {me.name.split(' ')[0]}
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Live view of leads assigned to you. New leads pop in automatically.
            </p>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Open" value={data.stats.openCount} icon={<TrendingUp size={16} />} />
            <StatTile
              label="Followups due"
              value={data.stats.followupsDue}
              icon={<Clock size={16} />}
              tone={data.stats.followupsDue > 0 ? 'warn' : 'normal'}
            />
            <StatTile
              label="Calls today"
              value={data.stats.callsToday}
              icon={<Phone size={16} />}
            />
            <StatTile
              label="SMS in today"
              value={data.stats.smsInboundToday}
              icon={<MessageSquare size={16} />}
            />
            <StatTile
              label="Conversions today"
              value={data.stats.conversionsToday}
              icon={<CheckCircle2 size={16} />}
            />
          </div>

          <Card>
            <CardTitle>Leads to work</CardTitle>
            {data.open.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                You&apos;re all caught up. New leads will appear here as they come in.
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border-muted)]">
                {data.open.map((l) => {
                  const name =
                    [l.firstName, l.lastName].filter(Boolean).join(' ') || l.phone || 'Unknown';
                  const due = l.followupDueAt ? new Date(l.followupDueAt) : null;
                  const isPastDue = due && due.getTime() < Date.now();
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/leads/${l.id}`}
                        className="group flex items-center gap-4 py-3 hover:bg-[var(--color-surface-muted)]"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{name}</span>
                            <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                            <Badge tone="neutral">{l.source}</Badge>
                            {l.language ? <Badge tone="neutral">{l.language}</Badge> : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                            {l.phone ? <span>{l.phone}</span> : null}
                            {l.email ? <span className="truncate">{l.email}</span> : null}
                            {l.caseInterest ? <span>· {l.caseInterest}</span> : null}
                          </div>
                        </div>
                        {due ? (
                          <span
                            className={
                              'text-xs ' +
                              (isPastDue
                                ? 'text-[var(--color-warning)]'
                                : 'text-[var(--color-text-muted)]')
                            }
                          >
                            Followup {due.toLocaleString()}
                          </span>
                        ) : null}
                        <ChevronRight
                          size={16}
                          className="text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'normal' | 'warn';
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div
          className={
            'flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] ' +
            (tone === 'warn'
              ? 'bg-[color-mix(in_srgb,var(--color-warning)_14%,transparent)] text-[var(--color-warning)]'
              : 'bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]')
          }
        >
          {icon}
        </div>
        <div>
          <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
          <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
        </div>
      </div>
    </Card>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
