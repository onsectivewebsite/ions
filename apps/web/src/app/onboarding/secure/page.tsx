'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Smartphone, ArrowRight } from 'lucide-react';
import { Button, Card, CardBody, CardTitle, ThemeProvider, type Branding } from '@onsecboad/ui';
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
 * Post-onboarding intermezzo. Auth-gated. Pushed to after invite-accept
 * and setup.complete so a fresh user sees one screen prompting them to
 * add 2FA before they're dropped into the dashboard. Skippable.
 */
export default function SecureAccountPage() {
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
      <main className="flex min-h-screen items-center justify-center bg-mesh p-6">
        <div className="w-full max-w-lg space-y-6">
          <div className="flex items-center justify-between">
            <Logo />
            <Link
              href="/dashboard"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Skip for now
            </Link>
          </div>

          <Card>
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
                <ShieldCheck size={22} />
              </div>
              <div>
                <CardTitle>Secure your account</CardTitle>
                <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Add a second factor so a stolen password isn&rsquo;t enough to get in.
                  Your firm handles client PII — this is required for everyone with
                  access.
                </CardBody>
              </div>
            </div>

            <div className="mt-6 space-y-2 text-sm">
              <Option
                icon={<Smartphone size={16} />}
                title="Authenticator app"
                detail="Google Authenticator, 1Password, Authy. Free, 10-second setup."
                recommended
              />
              <Option
                icon={<ShieldCheck size={16} />}
                title="Email one-time codes"
                detail="A backup if you don't have an authenticator app handy."
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <Link
                href="/dashboard"
                className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                Maybe later
              </Link>
              <Link href="/settings/security">
                <Button>
                  Set up 2FA
                  <ArrowRight size={14} />
                </Button>
              </Link>
            </div>
          </Card>

          <p className="text-center text-[11px] text-[var(--color-text-muted)]">
            You can change this anytime in{' '}
            <span className="font-mono">Settings → Security</span>.
          </p>
        </div>
      </main>
    </ThemeProvider>
  );
}

function Option({
  icon,
  title,
  detail,
  recommended,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  recommended?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3">
      <div className="text-[var(--color-text-muted)]">{icon}</div>
      <div className="flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          {recommended ? (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-success)]">
              recommended
            </span>
          ) : null}
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">{detail}</div>
      </div>
    </div>
  );
}
