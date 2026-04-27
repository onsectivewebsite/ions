'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, Plus, Search } from 'lucide-react';
import { Badge, Button, Card, Input, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Address = {
  city?: string;
  province?: string;
  country?: string;
} | null;

type BranchRow = {
  id: string;
  name: string;
  address: Address;
  phone: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  manager: { id: string; name: string; email: string } | null;
  _count: { users: number };
};

type ListResp = { items: BranchRow[]; total: number; page: number; pageSize: number };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

function locationOf(addr: Address): string {
  if (!addr) return '—';
  const parts = [addr.city, addr.province].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export default function BranchListPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

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
  }, [router]);

  useEffect(() => {
    if (!me) return;
    const token = getAccessToken();
    if (!token) return;
    setResp(null);
    rpcQuery<ListResp>('branch.list', { page, q: q || undefined }, { token })
      .then(setResp)
      .catch(() => setResp({ items: [], total: 0, page: 1, pageSize: 20 }));
  }, [me, page, q]);

  const totalPages = useMemo(
    () => (resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1),
    [resp],
  );

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
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Firm</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Branches</h1>
            </div>
            <Link href="/f/branches/new">
              <Button>
                <Plus size={14} />
                New branch
              </Button>
            </Link>
          </div>

          <Card>
            <div className="relative max-w-md">
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
                placeholder="Search branches…"
                className="pl-9"
              />
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Location</th>
                    <th className="py-2 pr-4">Manager</th>
                    <th className="py-2 pr-4">Users</th>
                    <th className="py-2 pr-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {resp === null ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={5} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : resp.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <Building2 size={20} />
                        </div>
                        <div className="text-sm font-medium">No branches yet</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Click <span className="font-medium">New branch</span> to add your first office.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-[var(--color-border-muted)] transition-colors hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4">
                          <Link href={`/f/branches/${b.id}`} className="font-medium hover:underline">
                            {b.name}
                          </Link>
                          {!b.isActive ? (
                            <span className="ml-2"><Badge tone="neutral">Archived</Badge></span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {locationOf(b.address)}
                        </td>
                        <td className="py-3 pr-4">
                          {b.manager ? (
                            b.manager.name
                          ) : (
                            <span className="text-[var(--color-text-muted)]">Unassigned</span>
                          )}
                        </td>
                        <td className="py-3 pr-4">{b._count.users}</td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(b.createdAt).toLocaleDateString()}
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
