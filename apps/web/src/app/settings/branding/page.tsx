'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Users,
  CreditCard,
  Activity,
  Palette,
  Check,
  Sparkles,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Input,
  Label,
  Skeleton,
  ThemeProvider,
  ThemeSwatchGrid,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery, rpcMutation } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';
import { Logo } from '../../../components/Logo';
import { StatCard } from '../../../components/StatCard';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function BrandingPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [branding, setBranding] = useState<Branding>({ themeCode: 'maple' });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<Branding | null>('tenant.brandingGet', undefined, { token }),
    ])
      .then(([m, b]) => {
        setMe(m);
        if (b) setBranding(b);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
  }, [router]);

  const previewBranding = useMemo<Branding>(() => branding, [branding]);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('tenant.brandingUpdate', branding, { token });
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-8">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Branding</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Personalize the look of your firm. Themes apply across the staff dashboard, the
              client portal, and every email we send on your behalf.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
            {/* ── Controls ──────────────────────────────────────────────── */}
            <div className="space-y-6">
              <Card>
                <div className="flex items-center justify-between">
                  <CardTitle>Theme preset</CardTitle>
                  <Palette size={16} className="text-[var(--color-text-muted)]" />
                </div>
                <CardBody className="mt-4">
                  <ThemeSwatchGrid
                    selected={branding.themeCode}
                    onSelect={(code) => setBranding({ ...branding, themeCode: code })}
                  />
                </CardBody>
                {branding.themeCode === 'custom' ? (
                  <div className="mt-6 space-y-2">
                    <Label htmlFor="primary">Custom primary color</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        id="primary"
                        value={branding.customPrimary ?? '#B5132B'}
                        onChange={(e) =>
                          setBranding({ ...branding, customPrimary: e.target.value.trim() })
                        }
                      />
                      <input
                        type="color"
                        value={branding.customPrimary ?? '#B5132B'}
                        onChange={(e) =>
                          setBranding({ ...branding, customPrimary: e.target.value })
                        }
                        className="h-10 w-12 cursor-pointer rounded-[var(--radius-md)] border border-[var(--color-border)]"
                      />
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Hover, active, accent, and on-primary text are derived automatically.
                    </p>
                  </div>
                ) : null}
              </Card>

              <Card>
                <CardTitle>Logo</CardTitle>
                <CardBody className="mt-3 text-sm text-[var(--color-text-muted)]">
                  Paste a hosted URL. Direct upload to R2 ships in Phase 6.
                </CardBody>
                <Input
                  className="mt-3"
                  placeholder="https://your-cdn/logo.svg"
                  value={branding.logoUrl ?? ''}
                  onChange={(e) =>
                    setBranding({
                      ...branding,
                      logoUrl: e.target.value.trim() || null,
                    })
                  }
                />
              </Card>

              {error ? (
                <p className="text-sm text-[var(--color-danger)]">{error}</p>
              ) : null}
              <div className="flex items-center justify-end gap-3">
                {savedAt ? (
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                    <Check size={12} />
                    Saved {savedAt.toLocaleTimeString()}
                  </span>
                ) : null}
                <Button variant="secondary" onClick={() => router.push('/dashboard')}>
                  Cancel
                </Button>
                <Button disabled={saving} onClick={save}>
                  Save changes
                </Button>
              </div>
            </div>

            {/* ── Live preview ─────────────────────────────────────────── */}
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
                Live preview
              </div>
              <ThemeProvider branding={previewBranding}>
                <PreviewMockup />
              </ThemeProvider>
            </div>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

/** A miniature dashboard mock that re-renders inline with the chosen theme. */
function PreviewMockup() {
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] shadow-[var(--shadow-md)]"
      style={{ background: 'var(--color-bg)' }}
    >
      {/* Top bar */}
      <div className="flex h-11 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Logo size={22} />
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5">
            ⌘K
          </span>
          <div
            className="h-7 w-7 rounded-full"
            style={{
              background:
                'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
            }}
          />
        </div>
      </div>
      {/* Body */}
      <div className="grid grid-cols-[180px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs">
          {['Dashboard', 'Leads', 'Clients', 'Cases', 'Settings'].map((label, i) => (
            <div
              key={label}
              className={
                'mb-1 flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 ' +
                (i === 0
                  ? 'bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]'
                  : 'text-[var(--color-text)]')
              }
            >
              <div className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
              {label}
            </div>
          ))}
        </div>
        <div className="space-y-3 p-4">
          <div
            className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4"
            style={{
              background:
                'radial-gradient(120% 100% at 0% 0%, color-mix(in srgb, var(--color-primary) 14%, transparent), transparent 60%), radial-gradient(120% 100% at 100% 100%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 60%), var(--color-surface)',
            }}
          >
            <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--color-text-muted)]">
              <Sparkles size={10} />
              YOUR FIRM
            </div>
            <div className="mt-1 text-base font-semibold tracking-tight">
              Welcome back, Sara.
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              3 cases need lawyer review · 12 calls scheduled today
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Open leads" value="24" icon={Users} />
            <MiniStat label="Cases" value="42" icon={Activity} />
            <MiniStat label="MRR" value="$8.4k" icon={CreditCard} />
          </div>
          <div
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="text-xs font-medium">Recent activity</div>
            {[
              ['John D.', 'Filed work permit'],
              ['Priya S.', 'Signed retainer'],
              ['Eric P.', 'New lead from Meta'],
            ].map(([name, action]) => (
              <div key={name} className="mt-2 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <Building2 size={10} className="text-[var(--color-text-muted)]" />
                  <span className="text-[var(--color-text)]">{name}</span>
                </div>
                <span className="text-[var(--color-text-muted)]">{action}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium"
              style={{
                background: 'var(--color-primary)',
                color: 'var(--color-text-on-primary)',
              }}
            >
              Save changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Users;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </span>
        <Icon size={11} className="text-[var(--color-text-muted)]" />
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
