'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronLeft, ChevronRight, Clock, User } from 'lucide-react';
import {
  Badge,
  Button,
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
import { AppointmentDetail, type Appointment } from '../../components/appointments/AppointmentDetail';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

type Provider = { id: string; name: string; email: string };
type Paged<T> = { items: T[]; total: number };

const STATUS_TONE: Record<Appointment['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'success',
  ARRIVED: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'danger',
};

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerFilter, setProviderFilter] = useState<string>('');
  const [view, setView] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [selected, setSelected] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const from = startOfDay(anchor);
    const to = view === 'day' ? addDays(from, 1) : addDays(from, 7);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [anchor, view]);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [m, list, users] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<Appointment[]>(
          'appointment.list',
          { ...range, providerId: providerFilter || undefined },
          { token },
        ),
        rpcQuery<Paged<Provider & { branchId: string | null; status: string }>>(
          'user.list',
          { page: 1 },
          { token },
        ).catch(() => ({ items: [], total: 0 }) as Paged<Provider & { branchId: string | null; status: string }>),
      ]);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setItems(list);
      setProviders(users.items.filter((u) => u.status === 'ACTIVE'));
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
  }, [router, range.from, range.to, providerFilter]);

  // Live refresh on appointment.created / appointment.outcome.
  useRealtime((ev) => {
    if (ev.type === 'appointment.created' || ev.type === 'appointment.outcome') {
      void load();
    }
  });

  if (!me || items === null) {
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

  // Group by day for the agenda view.
  const days = view === 'day' ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const byDay = new Map<string, Appointment[]>();
  for (const a of items) {
    const k = startOfDay(new Date(a.scheduledAt)).toISOString();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(a);
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
          <div className="flex items-end justify-between">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Schedule</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Appointments</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Consultations, follow-ups, walk-ins. Book new appointments from a lead detail page.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
              >
                <option value="">All providers</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-border)] p-1 text-xs">
                {(['day', 'week'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={
                      'rounded-[var(--radius-pill)] px-3 py-1 ' +
                      (view === v
                        ? 'bg-[var(--color-primary)] text-white'
                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAnchor(addDays(anchor, view === 'day' ? -1 : -7))}
                >
                  <ChevronLeft size={14} />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAnchor(startOfDay(new Date()))}>
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAnchor(addDays(anchor, view === 'day' ? 1 : 7))}
                >
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <div className="space-y-4">
            {days.map((day) => {
              const k = day.toISOString();
              const list = (byDay.get(k) ?? []).sort(
                (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
              );
              return (
                <Card key={k}>
                  <div className="flex items-baseline justify-between">
                    <CardTitle>{fmtDate(day)}</CardTitle>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {list.length} appointment{list.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {list.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
                      <Calendar size={20} className="mx-auto mb-2 opacity-40" />
                      Nothing booked for this day.
                    </div>
                  ) : (
                    <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                      {list.map((a) => {
                        const subjectName = a.client
                          ? [a.client.firstName, a.client.lastName].filter(Boolean).join(' ') ||
                            a.client.phone
                          : a.lead
                            ? [a.lead.firstName, a.lead.lastName].filter(Boolean).join(' ') ||
                              a.lead.phone ||
                              'Lead'
                            : 'Appointment';
                        return (
                          <li key={a.id}>
                            <button
                              onClick={() => setSelected(a)}
                              className="flex w-full items-center gap-3 py-3 text-left hover:bg-[var(--color-surface-muted)]"
                            >
                              <div className="w-20 shrink-0 text-sm tabular-nums">
                                {new Date(a.scheduledAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                                <div className="text-[10px] text-[var(--color-text-muted)]">
                                  {a.durationMin}m
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold">{subjectName}</span>
                                  <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                                  {a.outcome ? <Badge tone="success">{a.outcome}</Badge> : null}
                                  {a.caseType ? (
                                    <Badge tone="neutral">{a.caseType.replace('_', ' ')}</Badge>
                                  ) : null}
                                </div>
                                <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                                  <span className="inline-flex items-center gap-1">
                                    <User size={10} /> {a.provider.name}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <Clock size={10} /> {a.kind}
                                  </span>
                                </div>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>

        {selected ? (
          <AppointmentDetail
            appt={selected}
            onClose={() => setSelected(null)}
            onChanged={async () => {
              await load();
              // refresh selected from new list
              const next = items.find((x) => x.id === selected.id);
              setSelected(next ?? null);
            }}
            onError={(m) => setError(m)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}
