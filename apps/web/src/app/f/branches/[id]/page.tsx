'use client';
import { useEffect, useState, use, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, ArrowLeft, Building2, Mail, Pencil, Phone, ShieldCheck, X } from 'lucide-react';
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
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
} | null;

type BranchUser = {
  id: string;
  name: string;
  email: string;
  status: string;
  role: { id: string; name: string };
  lastLoginAt: string | null;
};

type Branch = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: Address;
  isActive: boolean;
  createdAt: string;
  manager: { id: string; name: string; email: string } | null;
  users: BranchUser[];
  _count: { users: number };
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

function formatAddress(a: Address): string {
  if (!a) return '—';
  const parts = [a.line1, a.line2, [a.city, a.province, a.postalCode].filter(Boolean).join(', '), a.country].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

export default function BranchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    try {
      const data = await rpcQuery<Branch>('branch.get', { id }, { token });
      setBranch(data);
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
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function archive(): Promise<void> {
    if (!branch) return;
    if (!confirm(`Archive ${branch.name}? Active users must be moved or disabled first.`)) return;
    setBusy(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('branch.archive', { id }, { token });
      router.push('/f/branches');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !branch) {
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
          <Link
            href="/f/branches"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to branches
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{branch.name}</h1>
              <div className="mt-1 text-xs text-[var(--color-text-muted)]">
                Created {new Date(branch.createdAt).toLocaleDateString()}
              </div>
            </div>
            {!branch.isActive ? <Badge tone="neutral">Archived</Badge> : null}
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <Card>
                <div className="flex items-center justify-between">
                  <CardTitle>Branch info</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                    <Pencil size={12} /> Edit
                  </Button>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <Row label="Phone">
                    {branch.phone ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone size={12} className="text-[var(--color-text-muted)]" />
                        {branch.phone}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label="Email">
                    {branch.email ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail size={12} className="text-[var(--color-text-muted)]" />
                        {branch.email}
                      </span>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <div className="col-span-2">
                    <Row label="Address">{formatAddress(branch.address)}</Row>
                  </div>
                </dl>
              </Card>

              <Card>
                <div className="flex items-center justify-between">
                  <CardTitle>Branch manager</CardTitle>
                  <ShieldCheck size={16} className="text-[var(--color-text-muted)]" />
                </div>
                {branch.manager ? (
                  <div className="mt-4 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{branch.manager.name}</div>
                      <a
                        href={`mailto:${branch.manager.email}`}
                        className="text-xs text-[var(--color-text-muted)] hover:underline"
                      >
                        {branch.manager.email}
                      </a>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setAssignOpen(true)}>
                        Change
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            const token = getAccessToken();
                            await rpcMutation(
                              'branch.assignManager',
                              { id, userId: null },
                              { token },
                            );
                            setInfo('Manager unassigned.');
                            await refresh();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Failed');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Unassign
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-[var(--color-text-muted)]">No manager assigned.</p>
                    <Button size="sm" onClick={() => setAssignOpen(true)}>
                      Assign manager
                    </Button>
                  </div>
                )}
              </Card>

              <Card>
                <CardTitle>Users in this branch ({branch._count.users})</CardTitle>
                <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
                  {branch.users.length === 0 ? (
                    <p className="py-6 text-sm text-[var(--color-text-muted)]">
                      No users yet. Invite people from the Users page.
                    </p>
                  ) : (
                    branch.users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">{u.email}</div>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <Badge tone="neutral">{u.role.name}</Badge>
                          <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>{u.status}</Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <Card>
              <CardTitle>Actions</CardTitle>
              <div className="mt-4 grid gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => setEditOpen(true)}>
                  <Pencil size={14} /> Edit branch
                </Button>
                {branch.isActive ? (
                  <Button variant="danger" disabled={busy} onClick={archive}>
                    <Archive size={14} /> Archive branch
                  </Button>
                ) : null}
              </div>
            </Card>
          </div>
        </div>

        {editOpen ? (
          <EditBranchDialog
            branch={branch}
            onClose={() => setEditOpen(false)}
            onSaved={async () => {
              setEditOpen(false);
              setInfo('Branch updated.');
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {assignOpen ? (
          <AssignManagerDialog
            branchId={id}
            currentManagerId={branch.manager?.id ?? null}
            onClose={() => setAssignOpen(false)}
            onSaved={async () => {
              setAssignOpen(false);
              setInfo('Manager updated.');
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-lg">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>{title}</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </Card>
    </div>
  );
}

function EditBranchDialog({
  branch,
  onClose,
  onSaved,
  onError,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(branch.name);
  const [phone, setPhone] = useState(branch.phone);
  const [email, setEmail] = useState(branch.email ?? '');
  const [line1, setLine1] = useState(branch.address?.line1 ?? '');
  const [line2, setLine2] = useState(branch.address?.line2 ?? '');
  const [city, setCity] = useState(branch.address?.city ?? '');
  const [province, setProvince] = useState(branch.address?.province ?? '');
  const [postalCode, setPostalCode] = useState(branch.address?.postalCode ?? '');
  const [country, setCountry] = useState(branch.address?.country ?? 'CA');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      const address =
        line1 || line2 || city || province || postalCode
          ? { line1, line2, city, province, postalCode, country }
          : undefined;
      await rpcMutation(
        'branch.update',
        { id: branch.id, name, phone, email: email || null, address },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Edit branch" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <Label htmlFor="eb_name">Name</Label>
          <Input id="eb_name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="eb_phone">Phone</Label>
            <Input id="eb_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="eb_email">Email</Label>
            <Input
              id="eb_email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </div>
        <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street" />
        <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Suite / unit" />
        <div className="grid grid-cols-3 gap-3">
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province" />
          <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal" />
        </div>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
        >
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function AssignManagerDialog({
  branchId,
  currentManagerId,
  onClose,
  onSaved,
  onError,
}: {
  branchId: string;
  currentManagerId: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  type Candidate = { id: string; name: string; email: string; role: { name: string } };
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(currentManagerId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<{ items: Candidate[] }>('user.list', { page: 1, q: q || undefined }, { token })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [q]);

  async function save(): Promise<void> {
    if (!pickedId) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('branch.assignManager', { id: branchId, userId: pickedId }, { token });
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Assign branch manager" onClose={onClose}>
      <div className="space-y-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search users by name or email…"
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-muted)]">
          {items === null ? (
            <Skeleton className="m-3 h-32" />
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-[var(--color-text-muted)]">
              No users yet. Invite users on the Users page first.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border-muted)]">
              {items.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => setPickedId(u.id)}
                    className={
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ' +
                      (pickedId === u.id
                        ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]'
                        : 'hover:bg-[var(--color-surface-muted)]')
                    }
                  >
                    <div>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{u.email}</div>
                    </div>
                    <Badge tone="neutral">{u.role.name}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !pickedId || pickedId === currentManagerId}>
            {busy ? <Spinner /> : null}
            Assign
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
