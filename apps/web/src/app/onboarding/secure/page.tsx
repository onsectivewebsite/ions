'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  UserPlus,
  CreditCard,
  ArrowRight,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { Logo } from '../../../components/Logo';

type Me = {
  kind: 'firm' | 'platform';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

/**
 * Post-onboarding checklist. Auth-gated. Pushed to after invite-accept
 * and setup.complete so a fresh user sees a 3-step "next" list before
 * hitting the dashboard. Every step is skippable.
 */
export default function OnboardingNextStepsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then(setMe)
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  const branding = me?.tenant?.branding ?? { themeCode: 'maple' as const };

  return (
    <ThemeProvider branding={branding}>
      <main className="flex min-h-screen items-start justify-center bg-mesh px-4 py-16">
        <div className="w-full max-w-xl space-y-6">
          <div className="flex items-center justify-between">
            <Logo />
            <Link
              href="/dashboard"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Skip to dashboard
            </Link>
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              You&rsquo;re in. Three quick wins.
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              All of this is optional — but you&rsquo;ll get value faster.
            </p>
          </div>

          <NextStep
            icon={<ShieldCheck size={18} />}
            title="Secure your account"
            detail="Add an authenticator app so a stolen password isn't enough to get in. Required if you'll be handling client PII."
            href="/settings/security"
            cta="Set up 2FA"
            recommended
          />

          <NextStep
            icon={<UserPlus size={18} />}
            title="Invite your team"
            detail="Send an invite to your paralegal, receptionist, and other lawyers — they get their own accounts with the right permissions."
            href="/f/users"
            cta="Invite teammates"
          />

          <NextStep
            icon={<CreditCard size={18} />}
            title="Add billing details"
            detail="Free trial is on. Add a payment method now so the trial converts smoothly when it ends."
            href="/settings/billing"
            cta="Add billing"
          />

          <div className="flex justify-end pt-2">
            <Link href="/dashboard">
              <Button>
                Continue to dashboard <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </ThemeProvider>
  );
}

function NextStep({
  icon,
  title,
  detail,
  href,
  cta,
  recommended,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  href: string;
  cta: string;
  recommended?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle>{title}</CardTitle>
            {recommended ? (
              <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-success)]">
                recommended
              </span>
            ) : null}
          </div>
          <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
            {detail}
          </CardBody>
        </div>
        <Link href={href}>
          <Button variant="secondary" size="sm">
            {cta} <ArrowRight size={12} />
          </Button>
        </Link>
      </div>
    </Card>
  );
}
