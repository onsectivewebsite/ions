'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Building,
  Building2,
  ChevronDown,
  CreditCard,
  History,
  Home,
  KeyRound,
  LogOut,
  Search,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, cn } from '@onsecboad/ui';
import { Logo } from './Logo';
import { rpcMutation, rpcQuery } from '../lib/api';
import { getAccessToken, setAccessToken } from '../lib/session';

export type ShellUser = {
  name: string;
  email: string;
  scope: 'platform' | 'firm';
  contextLabel: string;
  avatarUrl?: string | null;
  /** Firm role permissions JSON. When provided, sidebar items with a `permit`
   *  gate are filtered. Platform users pass null (no gate). */
  permissions?: Permissions | null;
};

type Scope = false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
type ResourcePerms = Partial<Record<'read' | 'write' | 'delete', Scope>>;
type Permissions = { _all?: ResourcePerms; [k: string]: ResourcePerms | undefined };

type NavItem = {
  href: `/${string}`;
  label: string;
  icon: LucideIcon;
  /** Optional permission gate (resource × action). Items without `permit` are
   *  always shown. */
  permit?: { resource: string; action: 'read' | 'write' | 'delete' };
};

function canAccess(perms: Permissions | null | undefined, item: NavItem): boolean {
  if (!item.permit) return true;
  if (!perms) return true; // platform users skip the gate
  const explicit = perms[item.permit.resource]?.[item.permit.action];
  const fallback = perms._all?.[item.permit.action];
  const scope = explicit !== undefined ? explicit : fallback !== undefined ? fallback : false;
  return scope !== false;
}

const PLATFORM_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/p/firms', label: 'Law firms', icon: Building2 },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/audit', label: 'Audit log', icon: Shield },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const FIRM_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/leads', label: 'Leads', icon: Users, permit: { resource: 'leads', action: 'read' } },
  { href: '/clients', label: 'Clients', icon: Users, permit: { resource: 'clients', action: 'read' } },
  { href: '/cases', label: 'Cases', icon: Shield, permit: { resource: 'cases', action: 'read' } },
  { href: '/f/branches', label: 'Branches', icon: Building, permit: { resource: 'branches', action: 'read' } },
  { href: '/f/users', label: 'Users', icon: Users, permit: { resource: 'users', action: 'read' } },
  { href: '/f/roles', label: 'Roles', icon: KeyRound, permit: { resource: 'roles', action: 'read' } },
  { href: '/f/audit', label: 'Audit log', icon: History, permit: { resource: 'audit', action: 'read' } },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Self-fetch permissions for firm users when the host page didn't pass them.
  // Platform users have no gate, so no fetch.
  const [fetchedPerms, setFetchedPerms] = useState<Permissions | null>(null);
  useEffect(() => {
    if (user.scope !== 'firm') return;
    if (user.permissions !== undefined && user.permissions !== null) {
      setFetchedPerms(user.permissions);
      return;
    }
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<{ role?: { permissions: Permissions } }>('user.me', undefined, { token })
      .then((m) => setFetchedPerms(m.role?.permissions ?? null))
      .catch(() => setFetchedPerms(null));
  }, [user.scope, user.permissions]);
  const effectivePerms = user.permissions ?? fetchedPerms;
  const allItems = user.scope === 'platform' ? PLATFORM_NAV : FIRM_NAV;
  const items = useMemo(
    () => allItems.filter((item) => canAccess(effectivePerms ?? null, item)),
    [allItems, effectivePerms],
  );

  async function signOut(): Promise<void> {
    const token = getAccessToken();
    try {
      await rpcMutation('auth.signOut', undefined, { token });
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    router.replace('/sign-in');
  }

  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-[var(--color-bg)]">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sticky top-0 flex h-screen flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <div className="px-3 pb-2 pt-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs">
            <div className="font-medium text-[var(--color-text)]">{user.contextLabel}</div>
            <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-muted)]">
              {user.scope === 'platform' ? 'Onsective Platform' : 'Workspace'}
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]',
                )}
              >
                <Icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-[var(--color-border)] p-3">
          <Link
            href="/settings/profile"
            className="flex items-center gap-3 rounded-[var(--radius-md)] p-2 text-sm hover:bg-[var(--color-surface-muted)]"
          >
            <Avatar name={user.name} src={user.avatarUrl ?? null} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium leading-tight">{user.name}</div>
              <div className="truncate text-[11px] text-[var(--color-text-muted)]">
                {user.email}
              </div>
            </div>
          </Link>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-col">
        <TopBar user={user} onSignOut={signOut} />
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

function TopBar({ user, onSignOut }: { user: ShellUser; onSignOut: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] px-6 backdrop-blur">
      <div className="relative w-full max-w-md">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
        <input
          type="search"
          placeholder="Search clients, cases, leads…"
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-12 text-sm placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          ⌘K
        </kbd>
      </div>

      <div className="flex items-center gap-2">
        <button
          aria-label="Notifications"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
        >
          <Bell size={16} />
        </button>
        <UserMenu user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

function UserMenu({ user, onSignOut }: { user: ShellUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 rounded-[var(--radius-md)] px-1.5 py-1 hover:bg-[var(--color-surface-muted)]"
      >
        <Avatar name={user.name} src={user.avatarUrl ?? null} size={28} />
        <ChevronDown size={14} className="text-[var(--color-text-muted)]" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-lg)]">
          <div className="border-b border-[var(--color-border-muted)] px-3 py-2">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-[var(--color-text-muted)]">{user.email}</div>
          </div>
          <Link
            href="/settings"
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm hover:bg-[var(--color-surface-muted)]"
            onClick={() => setOpen(false)}
          >
            <Settings size={14} />
            Settings
          </Link>
          <button
            onClick={onSignOut}
            className="mt-1 flex w-full items-center gap-2 rounded-[var(--radius-md)] border-t border-[var(--color-border-muted)] px-3 py-2 pt-3 text-left text-sm text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)]"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
