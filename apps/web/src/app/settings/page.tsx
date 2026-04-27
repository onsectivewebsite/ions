'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  CreditCard,
  Facebook,
  FileCheck,
  FileSignature,
  KeyRound,
  Music2,
  Palette,
  Phone,
  Shield,
  Workflow,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { Card, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type Me =
  | { kind: 'platform'; name: string; email: string; twoFAEnrolled: boolean }
  | {
      kind: 'firm';
      name: string;
      email: string;
      twoFAEnrolled: boolean;
      tenant: { displayName: string; branding: Branding };
    };

type Tile = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  status?: string;
  statusTone?: 'good' | 'warn';
};

export default function SettingsIndexPage() {
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

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
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

  const tiles: Tile[] = [
    {
      href: '/settings/security',
      icon: Shield,
      title: 'Security',
      description: 'Microsoft Authenticator and other 2FA settings.',
      status: me.twoFAEnrolled ? 'Enabled' : 'Set up required',
      statusTone: me.twoFAEnrolled ? 'good' : 'warn',
    },
    {
      href: '/settings/passkeys',
      icon: KeyRound,
      title: 'Passkeys',
      description: 'Sign in with your fingerprint, face, or device PIN.',
    },
  ];

  if (me.kind === 'firm') {
    tiles.push({
      href: '/settings/branding',
      icon: Palette,
      title: 'Branding',
      description: 'Theme, primary color, logo, and product name.',
    });
    tiles.push({
      href: '/settings/billing',
      icon: CreditCard,
      title: 'Billing',
      description: 'Plan, payment method, invoices, and seat usage.',
    });
    tiles.push({
      href: '/settings/integrations/api-keys',
      icon: KeyRound,
      title: 'API keys',
      description: 'Bearer tokens for posting leads from external systems.',
    });
    tiles.push({
      href: '/settings/integrations/twilio',
      icon: Phone,
      title: 'Twilio',
      description: 'Voice + SMS credentials. Dry-run until configured.',
    });
    tiles.push({
      href: '/settings/integrations/meta',
      icon: Facebook,
      title: 'Meta Lead Ads',
      description: 'Ingest leads from Facebook + Instagram lead-gen forms.',
    });
    tiles.push({
      href: '/settings/integrations/tiktok',
      icon: Music2,
      title: 'TikTok Lead Gen',
      description: 'Ingest leads from TikTok lead-generation ads.',
    });
    tiles.push({
      href: '/settings/lead-rules',
      icon: Workflow,
      title: 'Lead routing rules',
      description: 'Auto-assign inbound leads by source, language, branch, or hour.',
    });
    tiles.push({
      href: '/settings/intake-forms',
      icon: ClipboardList,
      title: 'Intake forms',
      description: 'Per-case-type forms used during reception walk-ins.',
    });
    tiles.push({
      href: '/settings/retainer-templates',
      icon: FileSignature,
      title: 'Retainer templates',
      description: 'Per-case-type retainer boilerplate with merge tags.',
    });
    tiles.push({
      href: '/settings/document-checklists',
      icon: FileCheck,
      title: 'Document checklists',
      description: 'Per-case-type list of files the client must upload.',
    });
  }

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-8">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Account and workspace settings
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Manage how you sign in and how the workspace looks.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {tiles.map((t) => (
              <Link key={t.href} href={t.href} className="group">
                <Card className="h-full transition-colors hover:border-[var(--color-primary)]/40">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
                      <t.icon size={18} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">{t.title}</div>
                        {t.status ? (
                          <span
                            className={
                              'rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium ' +
                              (t.statusTone === 'good'
                                ? 'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]'
                                : 'bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]')
                            }
                          >
                            {t.status}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {t.description}
                      </p>
                    </div>
                    <ChevronRight
                      size={16}
                      className="mt-1 text-[var(--color-text-muted)] transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
