'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox, Plus, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type LeadStatus = 'NEW' | 'CONTACTED' | 'FOLLOWUP' | 'INTERESTED' | 'BOOKED' | 'CONVERTED' | 'LOST' | 'DNC';

type LeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: LeadStatus;
  language: string | null;
  caseInterest: string | null;
  createdAt: string;
  lastContactedAt: string | null;
  assignedTo: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
};

type ListResp = { items: LeadRow[]; total: number; page: number; pageSize: number };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const STATUS_TONE: Record<LeadStatus, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  NEW: 'info',
  CONTACTED: 'neutral',
  FOLLOWUP: 'warning',
  INTERESTED: 'success',
  BOOKED: 'success',
  CONVERTED: 'success',
  LOST: 'neutral',
  DNC: 'danger',
};

function fullName(l: LeadRow): string {
  return [l.firstName, l.lastName].filter(Boolean).join(' ') || '—';
}

export default function LeadsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<string>('');
  const [assignedToMe, setAssignedToMe] = useState(false);
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
    rpcQuery<ListResp>(
      'lead.list',
      {
        page,
        q: q || undefined,
        status: status || undefined,
        source: source || undefined,
        assignedToMe: assignedToMe || undefined,
      },
      { token },
    )
      .then(setResp)
      .catch(() => setResp({ items: [], total: 0, page: 1, pageSize: 50 }));
  }, [me, page, q, status, source, assignedToMe]);

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
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Leads</h1>
            </div>
            <Link href="/leads/new">
              <Button>
                <Plus size={14} />
                New lead
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
                  placeholder="Search by name, email, phone…"
                  className="pl-9"
                />
              </div>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as LeadStatus | '');
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All statuses</option>
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="FOLLOWUP">Followup</option>
                <option value="INTERESTED">Interested</option>
                <option value="BOOKED">Booked</option>
                <option value="CONVERTED">Converted</option>
                <option value="LOST">Lost</option>
                <option value="DNC">Do not call</option>
              </select>
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All sources</option>
                <option value="meta">Meta</option>
                <option value="tiktok">TikTok</option>
                <option value="website">Website</option>
                <option value="walkin">Walk-in</option>
                <option value="referral">Referral</option>
                <option value="manual">Manual</option>
                <option value="import">Import</option>
              </select>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assignedToMe}
                  onChange={(e) => {
                    setAssignedToMe(e.target.checked);
                    setPage(1);
                  }}
                />
                Mine only
              </label>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Phone / Email</th>
                    <th className="py-2 pr-4">Source</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Assigned to</th>
                    <th className="py-2 pr-4">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {resp === null ? (
                    Array.from({ length: 5 }).map((_, i) => (
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
                          <Inbox size={20} />
                        </div>
                        <div className="text-sm font-medium">No leads match these filters</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Click <span className="font-medium">New lead</span> to add one manually, or wait for ingestion.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((l) => (
                      <tr
                        key={l.id}
                        className="border-b border-[var(--color-border-muted)] transition-colors hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4">
                          <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                            {fullName(l)}
                          </Link>
                          {l.language ? (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                              {l.language}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          <div>{l.phone ?? '—'}</div>
                          <div className="truncate">{l.email ?? '—'}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone="neutral">{l.source}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={STATUS_TONE[l.status]}>{l.status}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {l.assignedTo?.name ?? <span className="text-[var(--color-warning)]">Unassigned</span>}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(l.createdAt).toLocaleDateString()}
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
