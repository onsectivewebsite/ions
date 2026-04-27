'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Shield, ShieldCheck, Trash2, X } from 'lucide-react';
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

type Scope = false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
type Action = 'read' | 'write' | 'delete';
type ResourcePerms = Partial<Record<Action, Scope>>;
type Permissions = {
  _all?: ResourcePerms;
  [resource: string]: ResourcePerms | undefined;
};

type Role = {
  id: string;
  name: string;
  isSystem: boolean;
  permissions: Permissions;
  userCount: number;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

type ResourceMeta = {
  key: string;
  label: string;
  description: string;
  /** Some scopes don't make sense for some resources. e.g. "case" scope on
   *  Billing is meaningless. Pass an explicit allow-list to keep the dropdown
   *  short and grounded. */
  allowedScopes?: ReadonlyArray<Scope>;
};

const RESOURCES: ResourceMeta[] = [
  { key: 'leads', label: 'Leads', description: 'Incoming prospects from Meta, TikTok, walk-ins, referrals.' },
  { key: 'clients', label: 'Clients', description: 'Client records, contact info, history.' },
  { key: 'cases', label: 'Cases', description: 'Active immigration files (work permit, study permit, etc).' },
  { key: 'documents', label: 'Documents', description: 'Uploaded files, document requests, e-signed retainers.' },
  { key: 'calls', label: 'Calls & SMS', description: 'Twilio call recordings, text messages, call notes.' },
  { key: 'campaigns', label: 'Campaigns', description: 'Lead source campaigns and attribution.' },
  { key: 'appointments', label: 'Appointments', description: 'Calendar — consultations, intake meetings, walk-ins.' },
  {
    key: 'billing',
    label: 'Billing',
    description: 'Plan, invoices, payment method, seat usage.',
    allowedScopes: ['tenant'],
  },
  {
    key: 'settings',
    label: 'Settings & branding',
    description: 'Theme, logo, firm-wide config, integrations.',
    allowedScopes: ['tenant'],
  },
];

const ACTIONS: { key: Action; label: string; verb: string }[] = [
  { key: 'read', label: 'View', verb: 'see' },
  { key: 'write', label: 'Edit', verb: 'edit' },
  { key: 'delete', label: 'Delete', verb: 'delete' },
];

/** Plain-English label per scope, used everywhere a scope is shown. */
const SCOPE_META: Record<string, { label: string; hint: string }> = {
  // 'inherit' is the UI-only sentinel for "no explicit grant — falls back to _all"
  inherit: { label: 'Default for this role', hint: 'Falls back to the “All resources (default)” row, or denies if that’s unset.' },
  false: { label: 'No access', hint: 'This role cannot see, edit, or affect this resource.' },
  own: { label: 'Their own only', hint: 'Items the user created or owns.' },
  assigned: { label: 'Assigned to them', hint: 'Items where the user is the assigned owner / lawyer / filer.' },
  case: { label: 'Cases they’re on', hint: 'Anything attached to a case the user is part of.' },
  branch: { label: 'Their branch', hint: 'Everything in the branch the user belongs to.' },
  tenant: { label: 'The whole firm', hint: 'Everything across every branch in your firm.' },
};

const ALL_SCOPES: Scope[] = [false, 'own', 'assigned', 'case', 'branch', 'tenant'];

function scopeToValue(s: Scope | undefined): string {
  if (s === false) return 'false';
  if (s === undefined) return 'inherit';
  return s;
}
function valueToScope(v: string): Scope | undefined {
  if (v === 'inherit') return undefined;
  if (v === 'false') return false;
  return v as Scope;
}

/** Resolve the effective scope for a (resource, action) — same logic as the
 *  server-side resolveScope, used here just to render the summary banner. */
function effectiveScope(perms: Permissions, resource: string, action: Action): Scope {
  const explicit = perms[resource]?.[action];
  if (explicit !== undefined) return explicit;
  const fallback = perms._all?.[action];
  return fallback ?? false;
}

/** Auto-generated plain-English summary of what a role can do. */
function summarizeRole(perms: Permissions): string[] {
  const lines: string[] = [];
  // Detect "admin override" first
  const allRead = perms._all?.read;
  const allWrite = perms._all?.write;
  const allDelete = perms._all?.delete;
  if (allRead === 'tenant' && allWrite === 'tenant' && allDelete === 'tenant') {
    return ['Full access to everything in the firm (admin role).'];
  }
  for (const r of RESOURCES) {
    const read = effectiveScope(perms, r.key, 'read');
    const write = effectiveScope(perms, r.key, 'write');
    const del = effectiveScope(perms, r.key, 'delete');
    if (read === false && write === false && del === false) continue;
    const parts: string[] = [];
    if (read !== false) parts.push(`view (${SCOPE_META[String(read)]!.label.toLowerCase()})`);
    if (write !== false) parts.push(`edit (${SCOPE_META[String(write)]!.label.toLowerCase()})`);
    if (del !== false) parts.push(`delete (${SCOPE_META[String(del)]!.label.toLowerCase()})`);
    lines.push(`${r.label}: ${parts.join(', ')}`);
  }
  if (lines.length === 0) lines.push('No access to any resource — invite-only role.');
  return lines;
}

export default function RolesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<Role[]>('role.list', undefined, { token });
      setRoles(r);
      if (!selectedId && r.length > 0) setSelectedId(r[0]!.id);
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
  }, [router]);

  const selected = useMemo(
    () => (roles && selectedId ? roles.find((r) => r.id === selectedId) ?? null : null),
    [roles, selectedId],
  );

  if (!me || !roles) {
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
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Roles &amp; permissions</h1>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} />
              New custom role
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

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
            <Card>
              <CardTitle>Roles ({roles.length})</CardTitle>
              <ul className="mt-3 -mx-1 space-y-1">
                {roles.map((r) => {
                  const active = selectedId === r.id;
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={
                          'flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)] px-2 py-2 text-left text-sm transition-colors ' +
                          (active
                            ? 'bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)] text-[var(--color-primary)]'
                            : 'hover:bg-[var(--color-surface-muted)]')
                        }
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium">{r.name}</div>
                          <div className="text-[11px] text-[var(--color-text-muted)]">
                            {r.userCount} user{r.userCount === 1 ? '' : 's'}
                          </div>
                        </div>
                        {r.isSystem ? <Badge tone="neutral">system</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card>
              {selected ? (
                <RoleEditor
                  key={selected.id}
                  role={selected}
                  onSaved={async (msg) => {
                    setInfo(msg);
                    setError(null);
                    await refresh();
                  }}
                  onDeleted={async () => {
                    setSelectedId(null);
                    setInfo('Role deleted.');
                    setError(null);
                    await refresh();
                  }}
                  onError={(msg) => setError(msg)}
                />
              ) : (
                <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                  <Shield size={20} className="mx-auto mb-2 opacity-60" />
                  Pick a role on the left to edit its permissions.
                </div>
              )}
            </Card>
          </div>
        </div>

        {creating ? (
          <CreateRoleDialog
            onClose={() => setCreating(false)}
            onCreated={async (msg, newId) => {
              setCreating(false);
              setInfo(msg);
              setError(null);
              await refresh();
              setSelectedId(newId);
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function ScopePicker({
  value,
  onChange,
  allowed,
  includeInherit = true,
}: {
  value: Scope | undefined;
  onChange: (s: Scope | undefined) => void;
  allowed?: ReadonlyArray<Scope>;
  includeInherit?: boolean;
}) {
  const scopes = allowed ?? ALL_SCOPES;
  return (
    <select
      value={scopeToValue(value)}
      onChange={(e) => onChange(valueToScope(e.target.value))}
      className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs"
    >
      {includeInherit ? (
        <option value="inherit">{SCOPE_META.inherit!.label}</option>
      ) : null}
      {scopes.map((s) => (
        <option key={String(s)} value={scopeToValue(s)}>
          {SCOPE_META[String(s)]!.label}
        </option>
      ))}
    </select>
  );
}

function MatrixEditor({
  perms,
  onChange,
}: {
  perms: Permissions;
  onChange: (next: Permissions) => void;
}) {
  function setResourceAction(resource: string, action: Action, scope: Scope | undefined): void {
    const next: Permissions = { ...perms };
    const existing: ResourcePerms = { ...(next[resource] ?? {}) };
    if (scope === undefined) delete existing[action];
    else existing[action] = scope;
    if (Object.keys(existing).length === 0) delete next[resource];
    else next[resource] = existing;
    onChange(next);
  }

  function setAllAction(action: Action, scope: Scope | undefined): void {
    const next: Permissions = { ...perms };
    const all: ResourcePerms = { ...(next._all ?? {}) };
    if (scope === undefined) delete all[action];
    else all[action] = scope;
    if (Object.keys(all).length === 0) delete next._all;
    else next._all = all;
    onChange(next);
  }

  function setEntireResource(resource: string, scope: Scope): void {
    const next: Permissions = { ...perms };
    if (scope === false) {
      delete next[resource];
    } else {
      next[resource] = { read: scope, write: scope, delete: scope };
    }
    onChange(next);
  }

  const isAdminOverride =
    perms._all?.read === 'tenant' &&
    perms._all?.write === 'tenant' &&
    perms._all?.delete === 'tenant';

  function toggleAdminOverride(on: boolean): void {
    if (on) {
      onChange({ _all: { read: 'tenant', write: 'tenant', delete: 'tenant' } });
    } else {
      const next = { ...perms };
      delete next._all;
      onChange(next);
    }
  }

  return (
    <div className="space-y-4">
      {/* Admin shortcut */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Admin role</div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Grants full view, edit, and delete access to every resource in the firm.
              Use for owners and senior managers who shouldn&apos;t be limited.
            </p>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={isAdminOverride}
              onChange={(e) => toggleAdminOverride(e.target.checked)}
            />
            Enabled
          </label>
        </div>
      </div>

      {!isAdminOverride ? (
        <>
          {/* Per-resource cards */}
          <div className="space-y-3">
            {RESOURCES.map((r) => {
              const rp = perms[r.key] ?? {};
              const allowed: ReadonlyArray<Scope> = r.allowedScopes ?? ALL_SCOPES;
              const allBlocked =
                rp.read === undefined && rp.write === undefined && rp.delete === undefined;
              const fallbackHint = allBlocked && perms._all
                ? 'Inheriting from “Default for any other resource” below.'
                : null;
              return (
                <div key={r.key} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{r.label}</div>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{r.description}</p>
                    </div>
                    {/* Quick presets — set all three actions to the same scope */}
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="mr-1 text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                        quick set:
                      </span>
                      {allowed.includes('tenant') ? (
                        <button
                          type="button"
                          onClick={() => setEntireResource(r.key, 'tenant')}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[10px] hover:bg-[var(--color-surface-muted)]"
                        >
                          Whole firm
                        </button>
                      ) : null}
                      {allowed.includes('branch') ? (
                        <button
                          type="button"
                          onClick={() => setEntireResource(r.key, 'branch')}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[10px] hover:bg-[var(--color-surface-muted)]"
                        >
                          Branch
                        </button>
                      ) : null}
                      {allowed.includes('own') ? (
                        <button
                          type="button"
                          onClick={() => setEntireResource(r.key, 'own')}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[10px] hover:bg-[var(--color-surface-muted)]"
                        >
                          Own only
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEntireResource(r.key, false)}
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-[10px] hover:bg-[var(--color-surface-muted)]"
                      >
                        No access
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {ACTIONS.map((a) => (
                      <div key={a.key}>
                        <Label className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                          {a.label}
                        </Label>
                        <ScopePicker
                          value={rp[a.key]}
                          onChange={(s) => setResourceAction(r.key, a.key, s)}
                          allowed={allowed}
                        />
                      </div>
                    ))}
                  </div>
                  {fallbackHint ? (
                    <p className="mt-2 text-[11px] italic text-[var(--color-text-muted)]">{fallbackHint}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* _all fallback — explained in plain English */}
          <details className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Default for any other resource{' '}
              <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                — used only when a resource above is left on “Default for this role”.
              </span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ACTIONS.map((a) => (
                <div key={a.key}>
                  <Label className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                    {a.label}
                  </Label>
                  <ScopePicker
                    value={perms._all?.[a.key]}
                    onChange={(s) => setAllAction(a.key, s)}
                  />
                </div>
              ))}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}

// Sidebar items the firm sees, mirrored from AppShell's FIRM_NAV. Keep this
// list in sync with apps/web/src/components/AppShell.tsx so the preview here
// is honest. Items without a permit are always visible.
const SIDEBAR_PREVIEW: Array<{
  label: string;
  permit?: { resource: string; action: Action };
}> = [
  { label: 'Dashboard' },
  { label: 'Leads', permit: { resource: 'leads', action: 'read' } },
  { label: 'Clients', permit: { resource: 'clients', action: 'read' } },
  { label: 'Cases', permit: { resource: 'cases', action: 'read' } },
  { label: 'Branches', permit: { resource: 'branches', action: 'read' } },
  { label: 'Users', permit: { resource: 'users', action: 'read' } },
  { label: 'Roles', permit: { resource: 'roles', action: 'read' } },
  { label: 'Audit log', permit: { resource: 'audit', action: 'read' } },
  { label: 'Settings' },
];

function RoleSummary({ perms }: { perms: Permissions }) {
  const lines = useMemo(() => summarizeRole(perms), [perms]);
  const sidebar = useMemo(() => {
    return SIDEBAR_PREVIEW.map((item) => {
      if (!item.permit) return { label: item.label, visible: true };
      const scope = effectiveScope(perms, item.permit.resource, item.permit.action);
      return { label: item.label, visible: scope !== false };
    });
  }, [perms]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[color-mix(in_srgb,var(--color-info)_8%,transparent)] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-info)]">
          What this role can do
        </div>
        <ul className="mt-2 space-y-1 text-sm text-[var(--color-text)]">
          {lines.map((l) => (
            <li key={l} className="flex gap-2">
              <span className="text-[var(--color-info)]">•</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Sidebar this role sees
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {sidebar.map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              {item.visible ? (
                <span className="text-[var(--color-success)]">✓</span>
              ) : (
                <span className="text-[var(--color-text-muted)]">×</span>
              )}
              <span
                className={
                  item.visible
                    ? 'text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] line-through'
                }
              >
                {item.label}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          Updates live as you change scopes. Save to apply for everyone with this role.
        </p>
      </div>
    </div>
  );
}

function RoleEditor({
  role,
  onSaved,
  onDeleted,
  onError,
}: {
  role: Role;
  onSaved: (msg: string) => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState<Permissions>(role.permissions ?? {});
  const [busy, setBusy] = useState(false);

  const dirty =
    name !== role.name || JSON.stringify(perms) !== JSON.stringify(role.permissions ?? {});

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'role.update',
        {
          id: role.id,
          name: name === role.name ? undefined : name,
          permissions: perms,
        },
        { token },
      );
      await onSaved(role.isSystem ? 'Custom override created from system role.' : 'Role updated.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(): Promise<void> {
    if (!confirm(`Delete ${role.name}? Users holding it must be reassigned first.`)) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('role.delete', { id: role.id }, { token });
      await onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Label htmlFor="rl_name">Role name</Label>
          <Input
            id="rl_name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={role.isSystem && role.name === 'FIRM_ADMIN'}
          />
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            {role.isSystem ? <Badge tone="neutral">system</Badge> : <Badge tone="info">custom</Badge>}
            <span>{role.userCount} user{role.userCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        {!role.isSystem && role.name !== 'FIRM_ADMIN' ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={doDelete}>
            <Trash2 size={12} /> Delete
          </Button>
        ) : null}
      </div>

      {role.isSystem ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] p-3 text-xs text-[var(--color-warning)]">
          ⚠ Editing a system role creates a custom override for this firm. The default behaviour is preserved for other firms.
        </div>
      ) : null}

      <RoleSummary perms={perms} />

      <MatrixEditor perms={perms} onChange={setPerms} />

      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-muted)] pt-4">
        <Button
          variant="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setName(role.name);
            setPerms(role.permissions ?? {});
          }}
        >
          Reset
        </Button>
        <Button onClick={save} disabled={!dirty || busy}>
          {busy ? <Spinner /> : <ShieldCheck size={14} />}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function CreateRoleDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (msg: string, id: string) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [perms, setPerms] = useState<Permissions>({});
  const [busy, setBusy] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<Role>('role.create', { name, permissions: perms }, { token });
      await onCreated('Custom role created.', r.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-3xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>New custom role</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <Label htmlFor="cr_name">Role name *</Label>
            <Input
              id="cr_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="LEAD_REVIEWER"
              autoFocus
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Letters, numbers, _ and -. Must be unique within the firm.
            </p>
          </div>
          <RoleSummary perms={perms} />
          <MatrixEditor perms={perms} onChange={setPerms} />
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-muted)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy || name.length < 2}>
              {busy ? <Spinner /> : null}
              Create role
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
