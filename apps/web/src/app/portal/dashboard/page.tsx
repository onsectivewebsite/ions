'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Briefcase, Calendar, ShieldCheck } from 'lucide-react';
import { Badge, Card, CardTitle, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getPortalToken } from '../../../lib/portal-session';
import { useRealtimePortal } from '../../../lib/portal-realtime';
import { PortalShell } from '../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type CaseRow = {
  id: string;
  caseType: string;
  status: string;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  irccDecision: string | null;
  updatedAt: string;
};

type UpcomingAppt = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  kind: string;
  status: string;
  caseType: string | null;
  provider: { name: string };
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  PENDING_RETAINER: 'warning',
  PENDING_RETAINER_SIGNATURE: 'warning',
  PENDING_DOCUMENTS: 'warning',
  PREPARING: 'neutral',
  PENDING_LAWYER_APPROVAL: 'warning',
  SUBMITTED_TO_IRCC: 'success',
  IN_REVIEW: 'success',
  COMPLETED: 'success',
  WITHDRAWN: 'danger',
  ABANDONED: 'danger',
};

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PortalDashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingAppt[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadAll(): Promise<void> {
    const token = getPortalToken();
    if (!token) return;
    try {
      const [m, c, u] = await Promise.all([
        rpcQuery<Me>('portal.me', undefined, { token }),
        rpcQuery<CaseRow[]>('portal.cases', undefined, { token }),
        rpcQuery<UpcomingAppt[]>('portal.upcomingAppointments', undefined, { token }),
      ]);
      setMe(m);
      setCases(c);
      setUpcoming(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    loadAll().catch(() => router.replace('/portal/sign-in'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Refresh the upcoming list when the firm reschedules / confirms /
  // cancels — keeps the dashboard accurate without a manual refresh.
  useRealtimePortal((ev) => {
    if (ev.type === 'appointment.created' || ev.type === 'case.status') {
      void loadAll();
    }
  });

  if (!me || cases === null) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome, {fullName}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Track each of your files with {me.tenant.displayName}.
            </p>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
            <ShieldCheck size={12} className="mr-1 inline-block" />
            Your data is private to your firm. If you have questions, contact{' '}
            <strong>{me.tenant.displayName}</strong> directly.
          </div>

          {upcoming.length > 0 ? (
            <Card>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Upcoming appointments</CardTitle>
                <span className="text-xs text-[var(--color-text-muted)]">
                  Next {upcoming.length === 1 ? 'one' : upcoming.length}
                </span>
              </div>
              <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                {upcoming.map((a) => {
                  const when = new Date(a.scheduledAt);
                  const isToday = when.toDateString() === new Date().toDateString();
                  const dayLabel = isToday
                    ? 'Today'
                    : when.toLocaleDateString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      });
                  const timeLabel = when.toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  });
                  return (
                    <li
                      key={a.id}
                      className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] text-center">
                          <Calendar size={14} className="text-[var(--color-text-muted)]" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {dayLabel} · {timeLabel}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {a.kind}
                            {a.caseType ? ` · ${a.caseType.replace(/_/g, ' ')}` : ''}
                            {' · '}
                            {a.provider.name} · {a.durationMin} min
                          </div>
                        </div>
                      </div>
                      <Badge tone={a.status === 'CONFIRMED' ? 'success' : 'neutral'}>
                        {a.status === 'CONFIRMED' ? 'Confirmed' : 'Awaiting confirmation'}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] text-[var(--color-text-muted)]">
                Need to reschedule or add another consultation? Open the file and use the
                Appointments card.
              </p>
            </Card>
          ) : null}

          {cases.length === 0 ? (
            <Card>
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <Briefcase size={28} className="mx-auto mb-2 opacity-40" />
                No files on record yet. Once your firm opens a file for you, it will appear here.
              </div>
            </Card>
          ) : (
            <Card>
              <CardTitle>Your files ({cases.length})</CardTitle>
              <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                {cases.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/portal/cases/${c.id}`}
                      className="flex items-center gap-4 py-3 hover:bg-[var(--color-surface)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{c.caseType.replace('_', ' ')}</span>
                          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>
                            {c.status.replaceAll('_', ' ')}
                          </Badge>
                          {c.feesCleared ? <Badge tone="success">Paid</Badge> : null}
                          {c.irccDecision ? <Badge tone="success">{c.irccDecision}</Badge> : null}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {fmtMoney(c.amountPaidCents)} paid of {fmtMoney(c.totalFeeCents ?? c.retainerFeeCents)}
                          {c.irccFileNumber ? ` · IRCC #${c.irccFileNumber}` : ''}
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}
