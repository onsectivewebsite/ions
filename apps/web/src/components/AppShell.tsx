'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Building,
  Building2,
  Calendar,
  ChevronDown,
  ClipboardList,
  CreditCard,
  HelpCircle,
  History,
  Home,
  Inbox,
  KeyRound,
  LogOut,
  Megaphone,
  Menu,
  Phone,
  Search,
  Settings,
  Shield,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, cn } from '@onsecboad/ui';
import { Logo } from './Logo';
import { Toaster } from './Toaster';
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
  /** Optional firm-wide announcement banner from platform admin. */
  announcement?: {
    message: string;
    level: 'info' | 'warning' | 'urgent';
    expiresAt?: string | null;
  } | null;
  /** Firm logo URL — when present, the sidebar Logo renders this instead of
   *  the default OnsecBoad mark. Pulled from tenant.branding.logoUrl. */
  logoUrl?: string | null;
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
  { href: '/admin/email', label: 'Email', icon: Megaphone },
  { href: '/admin/abuse', label: 'Abuse', icon: Shield },
  { href: '/audit', label: 'Audit log', icon: History },
  { href: '/admin/backups', label: 'Backups', icon: Building },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const FIRM_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  { href: '/walkin', label: 'Walk-in', icon: ClipboardList, permit: { resource: 'clients', action: 'read' } },
  { href: '/queue', label: 'My queue', icon: Inbox, permit: { resource: 'leads', action: 'read' } },
  { href: '/leads', label: 'Leads', icon: Users, permit: { resource: 'leads', action: 'read' } },
  { href: '/calls', label: 'Calls', icon: Phone, permit: { resource: 'calls', action: 'read' } },
  { href: '/appointments', label: 'Appointments', icon: Calendar, permit: { resource: 'appointments', action: 'read' } },
  { href: '/marketing/campaigns', label: 'Campaigns', icon: Megaphone, permit: { resource: 'campaigns', action: 'read' } },
  { href: '/reports', label: 'Reports', icon: BarChart3, permit: { resource: 'reports', action: 'read' } },
  { href: '/clients', label: 'Clients', icon: Users, permit: { resource: 'clients', action: 'read' } },
  { href: '/cases', label: 'Cases', icon: Briefcase, permit: { resource: 'cases', action: 'read' } },
  { href: '/f/branches', label: 'Branches', icon: Building, permit: { resource: 'branches', action: 'read' } },
  { href: '/f/users', label: 'Users', icon: Users, permit: { resource: 'users', action: 'read' } },
  { href: '/f/roles', label: 'Roles', icon: KeyRound, permit: { resource: 'roles', action: 'read' } },
  { href: '/f/audit', label: 'Audit log', icon: History, permit: { resource: 'audit', action: 'read' } },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Self-fetch permissions + announcement for firm users when the host
  // page didn't pass them. Platform users have no permission gate.
  const [fetchedPerms, setFetchedPerms] = useState<Permissions | null>(null);
  const [fetchedAnnouncement, setFetchedAnnouncement] = useState<
    ShellUser['announcement'] | null
  >(null);
  // Logo: when the host page didn't pass user.logoUrl, peel it out of the
  // tenant.branding blob from user.me so the firm logo still appears in
  // the sidebar across pages we haven't manually plumbed it through.
  const [fetchedLogoUrl, setFetchedLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (user.scope !== 'firm') return;
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<{
      role?: { permissions: Permissions };
      tenant?: {
        announcement?: ShellUser['announcement'] | null;
        branding?: { logoUrl?: string | null } | null;
      };
    }>('user.me', undefined, { token })
      .then((m) => {
        if (user.permissions === undefined || user.permissions === null) {
          setFetchedPerms(m.role?.permissions ?? null);
        }
        if (user.announcement === undefined) {
          setFetchedAnnouncement(m.tenant?.announcement ?? null);
        }
        if (user.logoUrl === undefined) {
          setFetchedLogoUrl(m.tenant?.branding?.logoUrl ?? null);
        }
      })
      .catch(() => {
        setFetchedPerms(null);
        setFetchedAnnouncement(null);
        setFetchedLogoUrl(null);
      });
  }, [user.scope, user.permissions, user.announcement, user.logoUrl]);
  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
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

  const sidebarContent = (
    <>
      <div className="flex h-14 items-center justify-between px-5">
        <Logo
          logoUrl={user.logoUrl ?? fetchedLogoUrl}
          brandName={user.scope === 'firm' ? user.contextLabel : null}
        />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="-mr-2 rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] md:hidden"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
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
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--color-bg)] md:grid md:grid-cols-[240px_1fr]">
      {/* ── Desktop sidebar ─────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        {sidebarContent}
      </aside>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[280px] max-w-[85vw] flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-h-screen flex-col">
        <ImpersonationBanner />
        <AnnouncementBanner ann={user.announcement ?? fetchedAnnouncement ?? null} />
        <TopBar user={user} onSignOut={signOut} onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1 px-4 py-6 sm:px-6 md:px-8 md:py-8">{children}</main>
      </div>
      {user.scope === 'firm' ? <Toaster /> : null}
    </div>
  );
}

function AnnouncementBanner({ ann }: { ann: ShellUser['announcement'] }) {
  if (!ann) return null;
  if (ann.expiresAt && new Date(ann.expiresAt) < new Date()) return null;
  const tone = {
    info: 'bg-[var(--color-info)] text-white',
    warning: 'bg-[var(--color-warning)] text-white',
    urgent: 'bg-[var(--color-danger)] text-white',
  }[ann.level];
  return (
    <div className={`${tone} px-4 py-2 text-center text-xs font-medium`}>
      {ann.message}
    </div>
  );
}

/**
 * Red banner shown when the current session was minted via the platform-
 * admin impersonate flow. Reads the sessionStorage flag set by
 * /p/firms/[id] when an admin clicks Impersonate. Clicking "End" wipes
 * the access token + flag and bounces back to /sign-in so the platform
 * admin re-authenticates as themselves.
 */
function ImpersonationBanner() {
  const [info, setInfo] = useState<{ tenantName: string; name: string; email: string } | null>(
    null,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = sessionStorage.getItem('onsec.impersonating');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { target: typeof info };
      setInfo(parsed.target);
    } catch {
      /* ignore */
    }
  }, []);
  if (!info) return null;
  function endSession(): void {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem('onsec.impersonating');
    setAccessToken(null);
    window.location.href = '/sign-in';
  }
  return (
    <div className="bg-[var(--color-danger)] px-4 py-2 text-center text-xs text-white">
      <span className="font-semibold">Impersonating</span> {info.name} ({info.email}) at{' '}
      {info.tenantName}. Every action is logged.{' '}
      <button onClick={endSession} className="ml-2 font-semibold underline">
        End session
      </button>
    </div>
  );
}

function TopBar({
  user,
  onSignOut,
  onOpenMenu,
}: {
  user: ShellUser;
  onSignOut: () => void;
  onOpenMenu: () => void;
}) {
  function openSupport(): void {
    if (typeof window === 'undefined') return;
    const subject = encodeURIComponent(`Support — ${window.location.pathname}`);
    const body = encodeURIComponent(
      `\n\n---\nPage: ${window.location.href}\nUser: ${user.email}`,
    );
    window.location.href = `mailto:support@onsective.com?subject=${subject}&body=${body}`;
  }
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_85%,transparent)] px-3 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)] md:hidden"
      >
        <Menu size={18} />
      </button>
      <div className="relative w-full max-w-md">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
        <input
          type="search"
          placeholder="Search clients, cases, leads…"
          className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 text-sm placeholder:text-[var(--color-text-muted)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)] sm:pr-12"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)] sm:inline-block">
          ⌘K
        </kbd>
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={openSupport}
          aria-label="Help"
          title="Email support"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
        >
          <HelpCircle size={16} />
        </button>
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
