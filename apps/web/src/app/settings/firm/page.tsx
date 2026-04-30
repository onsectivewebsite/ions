'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check } from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardTitle,
  Input,
  Label,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type FirmDetails = {
  id: string;
  slug: string;
  displayName: string;
  legalName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  emailFrom: string | null;
  locale: string;
  timezone: string;
  address: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  packageTier: string;
  seatCount: number;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const TIMEZONES = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Winnipeg',
  'America/Halifax',
  'America/St_Johns',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

const LOCALES = [
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'es', label: 'Español' },
  { value: 'hi', label: 'हिंदी' },
];

export default function FirmSettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [firm, setFirm] = useState<FirmDetails | null>(null);
  const [edits, setEdits] = useState<Partial<FirmDetails>>({});
  const [addr, setAddr] = useState<NonNullable<FirmDetails['address']>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<FirmDetails | null>('tenant.firmDetailsGet', undefined, { token }),
    ])
      .then(([m, f]) => {
        setMe(m);
        setFirm(f);
        setAddr(f?.address ?? {});
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  async function save(): Promise<void> {
    if (!firm) return;
    setBusy(true);
    setErr(null);
    try {
      const token = getAccessToken();
      const addressDirty = JSON.stringify(addr) !== JSON.stringify(firm.address ?? {});
      const payload: Record<string, unknown> = { ...edits };
      if (addressDirty) {
        payload.address = Object.values(addr).some((v) => v) ? addr : null;
      }
      if (Object.keys(payload).length === 0) {
        setBusy(false);
        return;
      }
      await rpcMutation('tenant.firmDetailsUpdate', payload, { token });
      const fresh = await rpcQuery<FirmDetails>('tenant.firmDetailsGet', undefined, { token });
      setFirm(fresh);
      setEdits({});
      setAddr(fresh.address ?? {});
      setSavedAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !firm) {
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

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  const v = <K extends keyof FirmDetails>(k: K): FirmDetails[K] =>
    (edits[k] !== undefined ? edits[k] : firm[k]) as FirmDetails[K];

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Firm details</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Public + legal info for your firm. Slug is fixed at{' '}
              <span className="font-mono">{firm.slug}</span>.
            </p>
          </div>

          <Card>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                <Building2 size={16} />
              </div>
              <div>
                <CardTitle>Identity</CardTitle>
                <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Display name appears in the dashboard, emails, and the client portal. Legal
                  name appears on invoices.
                </CardBody>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs">
                <Label className="mb-1 block">Display name</Label>
                <Input
                  value={(v('displayName') as string) ?? ''}
                  onChange={(e) => setEdits({ ...edits, displayName: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Legal name</Label>
                <Input
                  value={(v('legalName') as string) ?? ''}
                  onChange={(e) => setEdits({ ...edits, legalName: e.target.value })}
                />
              </label>
            </div>
          </Card>

          <Card>
            <CardTitle>Primary contact</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              Used by Onsective billing + support. Not visible to your clients.
            </CardBody>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs">
                <Label className="mb-1 block">Contact name</Label>
                <Input
                  value={(v('contactName') as string) ?? ''}
                  onChange={(e) =>
                    setEdits({ ...edits, contactName: e.target.value || null })
                  }
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Contact email</Label>
                <Input
                  type="email"
                  value={(v('contactEmail') as string) ?? ''}
                  onChange={(e) =>
                    setEdits({ ...edits, contactEmail: e.target.value || null })
                  }
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Contact phone</Label>
                <Input
                  value={(v('contactPhone') as string) ?? ''}
                  onChange={(e) =>
                    setEdits({ ...edits, contactPhone: e.target.value || null })
                  }
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Outbound email From</Label>
                <Input
                  type="email"
                  value={(v('emailFrom') as string) ?? ''}
                  onChange={(e) =>
                    setEdits({ ...edits, emailFrom: e.target.value || null })
                  }
                  placeholder={`noreply@${firm.slug}.com`}
                />
              </label>
            </div>
          </Card>

          <Card>
            <CardTitle>Office address</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              Appears on invoices and in IRCC correspondence.
            </CardBody>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs">
                <Label className="mb-1 block">Address line 1</Label>
                <Input
                  value={addr.line1 ?? ''}
                  onChange={(e) => setAddr({ ...addr, line1: e.target.value || null })}
                />
              </label>
              <label className="col-span-2 text-xs">
                <Label className="mb-1 block">Address line 2</Label>
                <Input
                  value={addr.line2 ?? ''}
                  onChange={(e) => setAddr({ ...addr, line2: e.target.value || null })}
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">City</Label>
                <Input
                  value={addr.city ?? ''}
                  onChange={(e) => setAddr({ ...addr, city: e.target.value || null })}
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Province / State</Label>
                <Input
                  value={addr.province ?? ''}
                  onChange={(e) => setAddr({ ...addr, province: e.target.value || null })}
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Postal code</Label>
                <Input
                  value={addr.postalCode ?? ''}
                  onChange={(e) => setAddr({ ...addr, postalCode: e.target.value || null })}
                />
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Country</Label>
                <Input
                  value={addr.country ?? ''}
                  onChange={(e) => setAddr({ ...addr, country: e.target.value || null })}
                  placeholder="Canada"
                />
              </label>
            </div>
          </Card>

          <Card>
            <CardTitle>Localization</CardTitle>
            <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
              Drives date formats and timezone-aware UI.
            </CardBody>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs">
                <Label className="mb-1 block">Locale</Label>
                <select
                  value={(v('locale') as string) ?? 'en-CA'}
                  onChange={(e) => setEdits({ ...edits, locale: e.target.value })}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  {LOCALES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <Label className="mb-1 block">Timezone</Label>
                <select
                  value={(v('timezone') as string) ?? 'America/Toronto'}
                  onChange={(e) => setEdits({ ...edits, timezone: e.target.value })}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          {err ? <div className="text-sm text-[var(--color-danger)]">{err}</div> : null}

          <div className="flex items-center justify-end gap-3">
            {savedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
                <Check size={12} />
                Saved {savedAt.toLocaleTimeString()}
              </span>
            ) : null}
            <Button onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
