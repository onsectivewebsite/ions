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

function FirmDashboard({ me }: { me: Extract<Me, { kind: 'firm' }> }) {
  return (
    <div className="space-y-8">
      <HeroBanner
        eyebrow={`${me.tenant.displayName} · ${me.role.name}`}
        title={`Hi ${firstName(me.name)} 👋`}
        body="Personalize your firm's branding, then invite teammates in Phase 2 to bring the rest of the workflow online."
        cta={{ href: '/settings/branding', label: 'Open branding' }}
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open leads" value="0" icon={Users} />
        <StatCard label="Cases in flight" value="0" icon={Activity} tone="info" />
        <StatCard label="This week (calls)" value="0" icon={CreditCard} tone="accent" />
        <StatCard label="Pending invoices" value="$0" icon={CreditCard} tone="warning" />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Your workspace is ready</CardTitle>
          <CardBody className="mt-3 text-sm text-[var(--color-text-muted)]">
            Foundation phase is live. The next features will plug in as we ship them — your data
            will be there waiting.
          </CardBody>
          <div className="mt-6 flex items-center justify-center">
            <EmptyDashboard width={360} />
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
              Pick from six themes or use your brand color. Logo upload too.
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
