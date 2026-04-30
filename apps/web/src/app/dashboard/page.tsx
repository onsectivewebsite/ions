'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Building2,
  Users,
  CreditCard,
  Activity,
  Palette,
  KeyRound,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';
import { StatCard } from '../../components/StatCard';
import { EmptyDashboard } from '../../components/illustrations/EmptyDashboard';

type Me =
  | {
      kind: 'platform';
      id: string;
      email: string;
      name: string;
      isSuperadmin: boolean;
      twoFAEnrolled: boolean;
    }
  | {
      kind: 'firm';
      id: string;
      email: string;
      name: string;
      twoFAEnrolled: boolean;
      role: { id: string; name: string; permissions: unknown };
      branch: { id: string; name: string } | null;
      tenant: { id: string; slug: string; displayName: string; branding: Branding };
    };

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then(setMe)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-sm">
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
          <Button onClick={() => router.replace('/sign-in')} className="mt-4">
            Sign in again
          </Button>
        </Card>
      </main>
    );
  }
  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </main>
    );
  }

  const branding: Branding =
    me.kind === 'firm' ? me.tenant.branding ?? { themeCode: 'maple' } : { themeCode: 'maple' };

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: me.kind,
    contextLabel: me.kind === 'firm' ? me.tenant.displayName : 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        {me.kind === 'platform' ? <PlatformDashboard me={me} /> : <FirmDashboard me={me} />}
      </AppShell>
    </ThemeProvider>
  );
}

function PlatformDashboard({ me }: { me: Extract<Me, { kind: 'platform' }> }) {
  return (
    <div className="space-y-8">
      <HeroBanner
        eyebrow="Onsective Platform"
        title={`Welcome back, ${firstName(me.name)}.`}
        body="Provision new law firms, track MRR, and triage support requests from one place."
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active firms" value="0" delta={{ value: 'No firms yet', positive: false }} icon={Building2} />
        <StatCard label="Seats sold" value="0" icon={Users} tone="info" />
        <StatCard label="MRR (CAD)" value="$0" icon={CreditCard} tone="accent" />
        <StatCard label="Open tickets" value="0" icon={Activity} tone="success" />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Get started</CardTitle>
          <CardBody className="mt-4 space-y-3 text-sm text-[var(--color-text-muted)]">
            Phase 1 will surface the wizard to provision new law firms with Stripe billing
            wired in. Today, you can already query the API and audit log.
          </CardBody>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href="/firms"
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <div>
                <div className="text-sm font-medium">Law firms</div>
                <div className="text-xs text-[var(--color-text-muted)]">List, suspend, audit</div>
              </div>
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/audit"
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 transition-colors hover:bg-[var(--color-surface-muted)]"
            >
              <div>
                <div className="text-sm font-medium">Audit log</div>
                <div className="text-xs text-[var(--color-text-muted)]">Every privileged action</div>
              </div>
              <ArrowRight size={16} />
            </Link>
          </div>
        </Card>

        <SecurityCard twoFAEnrolled={me.twoFAEnrolled} />
      </section>
    </div>
  );
}

type DashboardKpis = {
  openLeads: number;
  casesInFlight: number;
  callsThisWeek: number;
  pendingInvoiceCents: number;
  intake: { sentThisWeek: number; filledThisWeek: number };
};

function FirmDashboard({ me }: { me: Extract<Me, { kind: 'firm' }> }) {
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  useEffect(() => {
    const token = getAccessToken();
    rpcQuery<DashboardKpis>('kpi.dashboard', undefined, { token })
      .then(setKpis)
      .catch(() => setKpis(null));
  }, []);
  const fmt = (n: number | undefined): string =>
    n === undefined ? '—' : n.toLocaleString();
  const fmtCents = (c: number | undefined): string => {
    if (c === undefined) return '—';
    const dollars = (c / 100).toFixed(2);
    return `$${Number(dollars).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  };
  const intakeRate =
    kpis && kpis.intake.sentThisWeek > 0
      ? Math.round((kpis.intake.filledThisWeek / kpis.intake.sentThisWeek) * 100)
      : null;

  return (
    <div className="space-y-8">
      <HeroBanner
        eyebrow={`${me.tenant.displayName} · ${me.role.name}`}
        title={`Hi ${firstName(me.name)} 👋`}
        body="A walk-in client just arrived? Type their phone, send them an intake form, then book the consultation once they fill it."
        cta={{ href: '/walkin', label: 'Start a walk-in' }}
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open leads" value={fmt(kpis?.openLeads)} icon={Users} />
        <StatCard
          label="Cases in flight"
          value={fmt(kpis?.casesInFlight)}
          icon={Activity}
          tone="info"
        />
        <StatCard
          label="Calls this week"
          value={fmt(kpis?.callsThisWeek)}
          icon={CreditCard}
          tone="accent"
        />
        <StatCard
          label="Pending invoices"
          value={fmtCents(kpis?.pendingInvoiceCents)}
          icon={CreditCard}
          tone="warning"
        />
      </section>

      {kpis && (kpis.intake.sentThisWeek > 0 || kpis.intake.filledThisWeek > 0) ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Intake forms sent (7d)"
            value={fmt(kpis.intake.sentThisWeek)}
            icon={Users}
          />
          <StatCard
            label="Intake forms filled (7d)"
            value={fmt(kpis.intake.filledThisWeek)}
            icon={Activity}
            tone="success"
          />
          <StatCard
            label="Fill rate"
            value={intakeRate === null ? '—' : `${intakeRate}%`}
            icon={CreditCard}
            tone="accent"
          />
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Quick actions</CardTitle>
          <CardBody className="mt-2 text-sm text-[var(--color-text-muted)]">
            The fastest paths from inbox to consultation.
          </CardBody>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <QuickAction
              href="/walkin"
              title="Walk-in lookup"
              detail="Phone-first arrival flow — finds the client or starts a new one."
            />
            <QuickAction
              href="/leads"
              title="Browse leads"
              detail="Triage your queue, send intakes, book consultations."
            />
            <QuickAction
              href="/settings/intake-forms/new"
              title="Build an intake form"
              detail="Per-firm, per-case-type fields. Sent by email or QR."
            />
            <QuickAction
              href="/f/users"
              title="Invite a teammate"
              detail="Lawyers, paralegals, receptionists — pick a role."
            />
          </div>
        </Card>

        <div className="space-y-6">
          <SecurityCard twoFAEnrolled={me.twoFAEnrolled} />
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Branding</CardTitle>
              <Palette size={16} className="text-[var(--color-text-muted)]" />
            </div>
            <CardBody className="mt-3 text-sm text-[var(--color-text-muted)]">
              Pick from six themes, paste your color, upload your logo.
            </CardBody>
            <Link href="/settings/branding" className="mt-4 inline-block">
              <Button variant="secondary" size="sm">
                Customize
                <ArrowRight size={14} />
              </Button>
            </Link>
          </Card>
        </div>
      </section>
    </div>
  );
}

function QuickAction({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm hover:bg-[var(--color-surface-muted)]"
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</div>
      </div>
      <ArrowRight
        size={14}
        className="mt-1 shrink-0 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

function HeroBanner({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] p-8"
      style={{
        background:
          'radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--color-primary) 12%, transparent) 0%, transparent 60%), radial-gradient(120% 100% at 100% 100%, color-mix(in srgb, var(--color-accent) 10%, transparent) 0%, transparent 60%), var(--color-surface)',
      }}
    >
      <div className="relative z-10 max-w-2xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)]">
          {eyebrow}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)]">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">{body}</p>
        {cta ? (
          <Link href={cta.href} className="mt-5 inline-block">
            <Button size="sm">
              {cta.label}
              <ArrowRight size={14} />
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SecurityCard({ twoFAEnrolled }: { twoFAEnrolled: boolean }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Security</CardTitle>
        <ShieldCheck size={16} className="text-[var(--color-text-muted)]" />
      </div>
      <ul className="mt-4 space-y-3 text-sm">
        <li className="flex items-center justify-between">
          <span className="text-[var(--color-text)]">Two-factor authentication</span>
          {twoFAEnrolled ? (
            <Badge tone="success">Enrolled</Badge>
          ) : (
            <Badge tone="warning">Not set up</Badge>
          )}
        </li>
        <li className="flex items-center justify-between">
          <span className="text-[var(--color-text)]">Passkeys</span>
          <Link href="/settings/passkeys" className="text-xs text-[var(--color-primary)] hover:underline">
            Manage
          </Link>
        </li>
      </ul>
      <div className="mt-5 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
        <KeyRound size={12} className="mr-1.5 inline" />
        Add a passkey for one-tap, phishing-resistant sign-in.
      </div>
    </Card>
  );
}

function firstName(s: string): string {
  return s.split(/\s+/)[0] ?? s;
}
