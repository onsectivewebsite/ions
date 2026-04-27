'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  Ban,
  Check,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserCog,
  Users as UsersIcon,
  X,
} from 'lucide-react';
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
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type UserRow = {
  id: string;
  name: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  isBillable: boolean;
  invitedAt: string | null;
  joinedAt: string | null;
  lastLoginAt: string | null;
  role: { id: string; name: string };
  branch: { id: string; name: string } | null;
};

type ListResp = {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  seats: { billable: number; limit: unknown };
};

type Branch = { id: string; name: string; isActive: boolean };
type Role = { id: string; name: string; isSystem: boolean };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const STATUS_TONE: Record<UserRow['status'], 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  DISABLED: 'neutral',
};

export default function UsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [q, setQ] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    setResp(null);
    try {
      const r = await rpcQuery<ListResp>(
        'user.list',
        {
          page,
          q: q || undefined,
          branchId: branchFilter || undefined,
          roleId: roleFilter || undefined,
          status: statusFilter || undefined,
        },
        { token },
      );
      setResp(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setResp({ items: [], total: 0, page: 1, pageSize: 50, seats: { billable: 0, limit: null } });
    }
  }

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
    // allSettled so a permission error on one side-fetch doesn't block the page.
    Promise.allSettled([
      rpcQuery<{ items: Branch[] }>('branch.list', { page: 1, includeInactive: false }, { token }),
      rpcQuery<Role[]>('role.list', undefined, { token }),
    ]).then(([bRes, rRes]) => {
      setBranches(bRes.status === 'fulfilled' ? bRes.value.items : []);
      setRoles(rRes.status === 'fulfilled' ? rRes.value : []);
    });
  }, [router]);

  useEffect(() => {
    if (!me) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, page, q, branchFilter, roleFilter, statusFilter]);

  const totalPages = useMemo(
    () => (resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1),
    [resp],
  );

  if (!me || !branches || !roles) {
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

  const seatCounter = resp?.seats
    ? typeof resp.seats.limit === 'number' && resp.seats.limit > 0
      ? `${resp.seats.billable} / ${resp.seats.limit}`
      : `${resp.seats.billable}`
    : '—';

  async function action(label: string, fn: () => Promise<unknown>): Promise<void> {
    setInfo(null);
    setError(null);
    try {
      await fn();
      setInfo(label);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Firm</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Users{' '}
                <span className="ml-2 text-sm font-normal text-[var(--color-text-muted)]">
                  ({seatCounter} seats)
                </span>
              </h1>
            </div>
            <Button onClick={() => setInviteOpen(true)}>
              <Plus size={14} />
              Invite user
            </Button>
          </div>

          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
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
                  placeholder="Search by name or email…"
                  className="pl-9"
                />
              </div>
              <select
                value={branchFilter}
                onChange={(e) => {
                  setBranchFilter(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <select
                value={roleFilter}
                onChange={(e) => {
                  setRoleFilter(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All roles</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INVITED">Invited</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Branch</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Last seen</th>
                    <th className="py-2 pr-4"></th>
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
                          <UsersIcon size={20} />
                        </div>
                        <div className="text-sm font-medium">No users yet</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Click <span className="font-medium">Invite user</span> to add staff.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-[var(--color-border-muted)] transition-colors hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4">
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            <a href={`mailto:${u.email}`} className="hover:underline">
                              {u.email}
                            </a>
                            {!u.isBillable ? <Badge tone="neutral" className="ml-2">Non-billable</Badge> : null}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone="neutral">{u.role.name}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {u.branch?.name ?? '—'}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center justify-end gap-1">
                            {u.status === 'INVITED' ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  action('Invite resent', async () => {
                                    const token = getAccessToken();
                                    return rpcMutation('user.resendInvite', { id: u.id }, { token });
                                  })
                                }
                              >
                                <Mail size={12} /> Resend
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => setEditingUser(u)}>
                              <UserCog size={12} /> Manage
                            </Button>
                          </div>
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

        {inviteOpen ? (
          <InviteDrawer
            branches={branches.filter((b) => b.isActive)}
            roles={roles}
            onClose={() => setInviteOpen(false)}
            onInvited={async (msg) => {
              setInviteOpen(false);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {editingUser ? (
          <ManageUserDialog
            user={editingUser}
            branches={branches.filter((b) => b.isActive)}
            roles={roles}
            onClose={() => setEditingUser(null)}
            onSaved={async (msg) => {
              setEditingUser(null);
              setInfo(msg);
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function InviteDrawer({
  branches,
  roles,
  onClose,
  onInvited,
  onError,
}: {
  branches: Branch[];
  roles: Role[];
  onClose: () => void;
  onInvited: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [branchId, setBranchId] = useState<string>(branches[0]?.id ?? '');
  const [roleId, setRoleId] = useState<string>(
    roles.find((r) => r.name === 'FILER')?.id ?? roles[0]?.id ?? '',
  );
  const [isBillable, setIsBillable] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{
        userId: string;
        inviteUrl: string;
        emailSent: boolean;
      }>(
        'user.invite',
        {
          email,
          name,
          phone: phone || undefined,
          roleId,
          branchId: branchId || null,
          isBillable,
        },
        { token },
      );
      if (r.emailSent) {
        await onInvited(`Invite sent to ${email}.`);
      } else {
        await onInvited(`User created — email failed. Share this link: ${r.inviteUrl}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="w-full max-w-md overflow-y-auto bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] p-4">
          <CardTitle>Invite user</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          <div>
            <Label htmlFor="iv_email">Email *</Label>
            <Input id="iv_email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="iv_name">Full name *</Label>
            <Input id="iv_name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="iv_phone">Phone</Label>
            <Input id="iv_phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 ___ ___ ____" />
          </div>
          <div>
            <Label htmlFor="iv_branch">Branch</Label>
            <select
              id="iv_branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">No branch (firm-level)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="iv_role">Role *</Label>
            <select
              id="iv_role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              required
              className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
            />
            Counts toward seat billing
          </label>
          <p className="text-xs text-[var(--color-text-muted)]">
            An email is sent with a link to set their password. The link expires in 7 days.
          </p>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-muted)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !email || !name || !roleId}>
              {busy ? <Spinner /> : <Mail size={14} />}
              Send invite
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ManageUserDialog({
  user,
  branches,
  roles,
  onClose,
  onSaved,
  onError,
}: {
  user: UserRow;
  branches: Branch[];
  roles: Role[];
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [roleId, setRoleId] = useState(user.role.id);
  const [branchId, setBranchId] = useState(user.branch?.id ?? '');
  const [isBillable, setIsBillable] = useState(user.isBillable);

  async function run(label: string, fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    try {
      await fn();
      await onSaved(label);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    const token = getAccessToken();
    const calls: Array<Promise<unknown>> = [];
    if (roleId !== user.role.id) {
      calls.push(rpcMutation('user.changeRole', { id: user.id, roleId }, { token }));
    }
    if ((branchId || null) !== (user.branch?.id ?? null)) {
      calls.push(rpcMutation('user.changeBranch', { id: user.id, branchId: branchId || null }, { token }));
    }
    if (isBillable !== user.isBillable) {
      calls.push(rpcMutation('user.update', { id: user.id, isBillable }, { token }));
    }
    if (calls.length === 0) {
      onClose();
      return;
    }
    await run('User updated.', () => Promise.all(calls));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>Manage {user.name}</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
            <div>{user.email}</div>
            <div className="mt-1">
              Status: <span className="font-medium text-[var(--color-text)]">{user.status}</span>
              {user.lastLoginAt
                ? ` · Last login ${new Date(user.lastLoginAt).toLocaleDateString()}`
                : user.invitedAt
                  ? ` · Invited ${new Date(user.invitedAt).toLocaleDateString()}`
                  : ''}
            </div>
          </div>

          <div>
            <Label>Role</Label>
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Branch</Label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="">No branch (firm-level)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
            />
            Counts toward seat billing
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-muted)] pt-4">
            {user.status !== 'DISABLED' ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run('User disabled.', async () => {
                    const token = getAccessToken();
                    return rpcMutation('user.disable', { id: user.id }, { token });
                  })
                }
              >
                <Ban size={12} /> Disable
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run('User enabled.', async () => {
                    const token = getAccessToken();
                    return rpcMutation('user.enable', { id: user.id }, { token });
                  })
                }
              >
                <Check size={12} /> Enable
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (!confirm(`Delete ${user.name}? This is reversible only by support.`)) return;
                void run('User deleted.', async () => {
                  const token = getAccessToken();
                  return rpcMutation('user.delete', { id: user.id }, { token });
                });
              }}
            >
              <Trash2 size={12} /> Delete
            </Button>
            {user.status === 'INVITED' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run('Invite resent.', async () => {
                    const token = getAccessToken();
                    return rpcMutation('user.resendInvite', { id: user.id }, { token });
                  })
                }
              >
                <RefreshCw size={12} /> Resend invite
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? <Spinner /> : null}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
