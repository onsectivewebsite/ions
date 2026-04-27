'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Phone, Search, UserPlus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type FoundClient = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string;
  language: string | null;
  branchId: string | null;
  createdAt: string;
};

type FoundLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  status: string;
  caseInterest: string | null;
  createdAt: string;
  assignedTo: { id: string; name: string } | null;
};

type FoundIntake = {
  id: string;
  caseType: string;
  submittedAt: string;
  template: { id: string; name: string; caseType: string };
};

type LookupResp = {
  client: FoundClient | null;
  leads: FoundLead[];
  intake: FoundIntake[];
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function WalkinPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<LookupResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function lookup(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const token = getAccessToken();
      const r = await rpcQuery<LookupResp>('client.findByPhone', { phone }, { token });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
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
          <Skeleton className="h-32" />
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
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Reception</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Walk-in lookup</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Type the visitor&apos;s phone number. If they&apos;ve been here before, you&apos;ll see
              their full history. If not, start a new lead.
            </p>
          </div>

          <Card>
            <form onSubmit={lookup} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 416 555 0100"
                  required
                />
              </div>
              <Button type="submit" disabled={busy || !phone}>
                {busy ? <Spinner /> : <Search size={14} />} Look up
              </Button>
            </form>
          </Card>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="space-y-4">
              {result.client ? (
                <Card>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>Existing client</CardTitle>
                      <div className="mt-3 text-lg font-semibold">
                        {[result.client.firstName, result.client.lastName].filter(Boolean).join(' ') ||
                          'Client'}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Phone size={12} /> {result.client.phone}
                        </span>
                        {result.client.email ? <span>· {result.client.email}</span> : null}
                        {result.client.language ? (
                          <Badge tone="neutral">{result.client.language}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <Link href={`/leads/new?phone=${encodeURIComponent(result.client.phone)}`}>
                      <Button variant="primary">
                        Start new visit <ArrowRight size={14} />
                      </Button>
                    </Link>
                  </div>
                </Card>
              ) : (
                <Card>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle>No prior record</CardTitle>
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        This phone number doesn&apos;t match any client. Start a new lead.
                      </p>
                    </div>
                    <Link href={`/leads/new?phone=${encodeURIComponent(phone)}`}>
                      <Button>
                        <UserPlus size={14} /> New lead
                      </Button>
                    </Link>
                  </div>
                </Card>
              )}

              {result.leads.length > 0 ? (
                <Card>
                  <CardTitle>Past leads ({result.leads.length})</CardTitle>
                  <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                    {result.leads.map((l) => (
                      <li key={l.id}>
                        <Link
                          href={`/leads/${l.id}`}
                          className="flex items-center justify-between py-3 hover:bg-[var(--color-surface-muted)]"
                        >
                          <div>
                            <div className="text-sm font-medium">
                              {[l.firstName, l.lastName].filter(Boolean).join(' ') || l.phone}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                              <Badge tone="neutral">{l.status}</Badge>
                              <Badge tone="neutral">{l.source}</Badge>
                              {l.caseInterest ? <span>· {l.caseInterest}</span> : null}
                              {l.assignedTo ? <span>· {l.assignedTo.name}</span> : null}
                              <span>· {new Date(l.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}

              {result.intake.length > 0 ? (
                <Card>
                  <CardTitle>Past intake submissions</CardTitle>
                  <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                    {result.intake.map((s) => (
                      <li key={s.id} className="py-2 text-sm">
                        <span className="font-medium">{s.template.name}</span>{' '}
                        <span className="text-xs text-[var(--color-text-muted)]">
                          ({s.template.caseType}) · {new Date(s.submittedAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
