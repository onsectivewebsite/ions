'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Search } from 'lucide-react';
import { Badge, Button, Card, Input, Skeleton, ThemeProvider } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type TenantStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';

type TenantRow = {
  id: string;
  legalName: string;
  displayName: string;
  slug: string;
  status: TenantStatus;
  packageTier: 'STARTER' | 'GROWTH' | 'SCALE';
  seatCount: number;
  createdAt: string;
  trialEndsAt: string | null;
  setupCompletedAt: string | null;
  plan: { code: string; name: string; pricePerSeatCents: number } | null;
};

type ListResp = { items: TenantRow[]; total: number; page: number; pageSize: number };

type Me = { kind: 'platform'; name: string; email: string };

const STATUS_TONE: Record<TenantStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  PROVISIONING: 'neutral',
  SUSPENDED: 'warning',
  CANCELED: 'danger',
};

function formatMRR(seats: number, perSeatCents?: number): string {
  if (!perSeatCents) return '—';
  return `$${((seats * perSeatCents) / 100).toLocaleString('en-CA', { maximumFractionDigits: 0 })}`;
}

export default function FirmsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TenantStatus | ''>('');
  const [page, setPage] = useState(1);

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
    setResp(null);
    rpcQuery<ListResp>(
      'platform.tenant.list',
      { page, q: q || undefined, status: status || undefined },
      { token },
    )
      .then(setResp)
      .catch(() => setResp({ items: [], total: 0, page: 1, pageSize: 20 }));
  }, [me, page, q, status]);

  const totalPages = useMemo(() => (resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1), [resp]);

  if (!me) {
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

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={{ themeCode: 'maple' }}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Law firms</h1>
            </div>
            <Link href="/p/firms/new">
              <Button>
                <Plus size={14} />
                New firm
              </Button>
            </Link>
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[260px] flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <Input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search firms by name or slug…"
                  className="pl-9"
                />
              </div>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as TenantStatus | '');
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
              >
                <option value="">All statuses</option>
                <option value="PROVISIONING">Provisioning</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="CANCELED">Canceled</option>
              </select>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Seats</th>
                    <th className="py-2 pr-4">MRR (CAD)</th>
                    <th className="py-2 pr-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {resp === null ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={6} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : resp.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <Building2 size={20} />
                        </div>
                        <div className="text-sm font-medium">No firms yet</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Click <span className="font-medium">New firm</span> to provision your first one.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-[var(--color-border-muted)] transition-colors hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4">
                          <Link href={`/p/firms/${t.id}`} className="font-medium hover:underline">
                            {t.displayName}
                          </Link>
                          <div className="text-xs text-[var(--color-text-muted)]">{t.slug}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone="neutral">{t.packageTier}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={STATUS_TONE[t.status]}>● {t.status}</Badge>
                        </td>
                        <td className="py-3 pr-4">{t.seatCount}</td>
                        <td className="py-3 pr-4">{formatMRR(t.seatCount, t.plan?.pricePerSeatCents)}</td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {resp && resp.total > resp.pageSize ? (
              <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                <div>
                  {resp.total} total · page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
