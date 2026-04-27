'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2 } from 'lucide-react';
import { Button, Card, Input, Label, Skeleton, Spinner, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function NewBranchPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('CA');

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
  }, [router]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!name) {
      setError('Branch name is required.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const address =
        line1 || line2 || city || province || postalCode
          ? {
              line1: line1 || undefined,
              line2: line2 || undefined,
              city: city || undefined,
              province: province || undefined,
              postalCode: postalCode || undefined,
              country,
            }
          : undefined;
      const created = await rpcMutation<{ id: string }>(
        'branch.create',
        {
          name,
          phone: phone || undefined,
          email: email || undefined,
          address,
        },
        { token },
      );
      router.push(`/f/branches/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
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
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Link
            href="/f/branches"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to branches
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight">New branch</h1>

          <Card>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Toronto Main"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="bemail">Email</Label>
                  <Input
                    id="bemail"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="border-t border-[var(--color-border-muted)] pt-4">
                <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Address
                </div>
                <div className="mt-3 space-y-3">
                  <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street" />
                  <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Suite / unit" />
                  <div className="grid grid-cols-3 gap-3">
                    <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
                    <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province" />
                    <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal" />
                  </div>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="CA">Canada</option>
                    <option value="US">United States</option>
                  </select>
                </div>
              </div>

              {error ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Link href="/f/branches">
                  <Button variant="ghost" type="button" disabled={busy}>
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" disabled={busy}>
                  {busy ? <Spinner /> : <Building2 size={14} />}
                  Create branch
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
