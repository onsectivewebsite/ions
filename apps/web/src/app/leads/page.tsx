'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Inbox, Plus, Search, UserCheck, Users, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
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

type FirmUser = { id: string; name: string; status: string };

export default function LeadsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<string>('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [users, setUsers] = useState<FirmUser[]>([]);
  const [showDupes, setShowDupes] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

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
    // Load assignable users for the bulk-assign dropdown.
    rpcQuery<{ items: FirmUser[]; total: number }>('user.list', { page: 1 }, { token })
      .then((r) => setUsers(r.items.filter((u) => u.status === 'ACTIVE')))
      .catch(() => setUsers([]));
  }, [router]);

  async function reload(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<ListResp>(
        'lead.list',
        {
          page,
          q: q || undefined,
          status: status || undefined,
          source: source || undefined,
          assignedToMe: assignedToMe || undefined,
        },
        { token },
      );
      setResp(r);
    } catch {
      setResp({ items: [], total: 0, page: 1, pageSize: 50 });
    }
  }

  useEffect(() => {
    if (!me) return;
    setResp(null);
    setSelected(new Set());
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, page, q, status, source, assignedToMe]);

  function toggleOne(id: string): void {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    if (!resp) return;
    setSelected((s) => {
      const allIds = resp.items.map((l) => l.id);
      const allSelected = allIds.every((id) => s.has(id));
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  }

  async function bulkAssign(userId: string): Promise<void> {
    const ids = Array.from(selected);
    if (ids.length === 0 || !userId) return;
    setActionMsg(null);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ count: number }>(
        'lead.bulkAssign',
        { ids, userId },
        { token },
      );
      setActionMsg(`Assigned ${r.count} lead${r.count === 1 ? '' : 's'}.`);
      setSelected(new Set());
      await reload();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Bulk assign failed');
    }
  }

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
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setShowDupes(true)}>
                <Copy size={14} /> Find duplicates
              </Button>
              <Link href="/leads/new">
                <Button>
                  <Plus size={14} />
                  New lead
                </Button>
              </Link>
            </div>
          </div>

          {actionMsg ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {actionMsg}
            </div>
          ) : null}

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

            {selected.size > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-primary)]/30 bg-[color-mix(in_srgb,var(--color-primary)_6%,transparent)] p-3 text-sm">
                <span className="font-medium">
                  {selected.size} selected
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Label className="text-xs text-[var(--color-text-muted)]" htmlFor="bulk-assign">
                    Assign to
                  </Label>
                  <select
                    id="bulk-assign"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        void bulkAssign(e.target.value);
                        e.target.value = '';
                      }
                    }}
                    className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
                  >
                    <option value="">Pick a user…</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected(new Set())}
                  >
                    <X size={12} /> Clear
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={
                          (resp?.items.length ?? 0) > 0 &&
                          (resp?.items ?? []).every((l) => selected.has(l.id))
                        }
                        onChange={toggleAll}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      />
                    </th>
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
                        <td colSpan={7} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : resp.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
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
                        <td className="py-3 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${fullName(l)}`}
                            checked={selected.has(l.id)}
                            onChange={() => toggleOne(l.id)}
                            className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                          />
                        </td>
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

        {showDupes ? (
          <DuplicatesDialog
            onClose={() => setShowDupes(false)}
            onMerged={async (count) => {
              setActionMsg(`Merged ${count} lead${count === 1 ? '' : 's'}.`);
              setShowDupes(false);
              await reload();
            }}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

type DupeLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  source: string;
  createdAt: string;
  assignedTo: { id: string; name: string } | null;
};

type DupeGroup = {
  key: string;
  kind: 'phone' | 'email';
  value: string;
  leads: DupeLead[];
};

function DuplicatesDialog({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: (count: number) => Promise<void>;
}) {
  const [groups, setGroups] = useState<DupeGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Per-group, which lead id is the survivor (default = newest = first
  // returned by the API since it orders by createdAt desc).
  const [survivors, setSurvivors] = useState<Record<string, string>>({});

  useEffect(() => {
    const token = getAccessToken();
    rpcQuery<{ groups: DupeGroup[] }>('lead.findDuplicates', undefined, { token })
      .then((r) => {
        setGroups(r.groups);
        const init: Record<string, string> = {};
        for (const g of r.groups) {
          if (g.leads[0]) init[g.key] = g.leads[0].id;
        }
        setSurvivors(init);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, []);

  async function mergeGroup(g: DupeGroup): Promise<void> {
    const survivorId = survivors[g.key];
    if (!survivorId) return;
    if (
      !confirm(
        `Merge ${g.leads.length - 1} duplicate${g.leads.length - 1 === 1 ? '' : 's'} into the chosen lead? This is permanent.`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    let merged = 0;
    try {
      const token = getAccessToken();
      for (const l of g.leads) {
        if (l.id === survivorId) continue;
        await rpcMutation('lead.merge', { fromId: l.id, toId: survivorId }, { token });
        merged += 1;
      }
      await onMerged(merged);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-2xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Duplicate leads</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Leads grouped by matching phone or email. Pick the lead to keep — the rest get
          merged into it (calls, SMS, and emails follow). Source leads are soft-deleted.
        </p>

        {err ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {err}
          </div>
        ) : null}

        {groups === null ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-6 text-center">
            <Users size={20} className="mx-auto mb-2 opacity-40" />
            <div className="text-sm font-medium">No duplicates found</div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Your lead list is clean.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {groups.map((g) => (
              <li
                key={g.key}
                className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                      Match by {g.kind}
                    </div>
                    <div className="mt-0.5 font-mono text-sm">{g.value}</div>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => mergeGroup(g)}>
                    {busy ? <Spinner /> : <UserCheck size={12} />} Merge {g.leads.length - 1}
                  </Button>
                </div>
                <div className="mt-3 space-y-1">
                  {g.leads.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 hover:bg-[var(--color-surface-muted)]"
                    >
                      <input
                        type="radio"
                        name={`survivor-${g.key}`}
                        checked={survivors[g.key] === l.id}
                        onChange={() => setSurvivors((s) => ({ ...s, [g.key]: l.id }))}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                      />
                      <span className="flex-1 text-sm">
                        <span className="font-medium">
                          {[l.firstName, l.lastName].filter(Boolean).join(' ') || '—'}
                        </span>
                        <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                          {l.phone ?? '—'} · {l.email ?? '—'} · {l.source}
                        </span>
                      </span>
                      <Badge tone="neutral">{l.status}</Badge>
                      <span className="text-[11px] text-[var(--color-text-muted)]">
                        {new Date(l.createdAt).toLocaleDateString()}
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end border-t border-[var(--color-border-muted)] pt-3">
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </Card>
    </div>
  );
}
