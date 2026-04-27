'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Inbox } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Branch = { id: string; name: string; isActive: boolean };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function NewLeadPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('manual');
  const [language, setLanguage] = useState('');
  const [caseInterest, setCaseInterest] = useState('');
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    Promise.allSettled([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<{ items: Branch[] }>('branch.list', { page: 1, includeInactive: false }, { token }),
    ]).then(([meRes, brRes]) => {
      if (meRes.status === 'fulfilled') {
        if (meRes.value.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(meRes.value);
      } else {
        router.replace('/sign-in');
        return;
      }
      setBranches(brRes.status === 'fulfilled' ? brRes.value.items : []);
    });
  }, [router]);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!firstName && !lastName && !phone && !email) {
      setError('Give at least a name, phone, or email.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const created = await rpcMutation<{ id: string }>(
        'lead.create',
        {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: email || undefined,
          phone: phone || undefined,
          source,
          language: language || undefined,
          caseInterest: caseInterest || undefined,
          notes: notes || undefined,
          branchId: branchId || undefined,
        },
        { token },
      );
      router.push(`/leads/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || !branches) {
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
            href="/leads"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to leads
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight">New lead</h1>

          <Card>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="fn">First name</Label>
                  <Input id="fn" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="ln">Last name</Label>
                  <Input id="ln" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="ph">Phone</Label>
                  <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 ___ ___ ____" />
                </div>
                <div>
                  <Label htmlFor="em">Email</Label>
                  <Input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="src">Source</Label>
                  <select
                    id="src"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="manual">Manual entry</option>
                    <option value="walkin">Walk-in</option>
                    <option value="referral">Referral</option>
                    <option value="website">Website</option>
                    <option value="meta">Meta (FB/IG)</option>
                    <option value="tiktok">TikTok</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="lang">Language</Label>
                  <select
                    id="lang"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="pa">Punjabi</option>
                    <option value="hi">Hindi</option>
                    <option value="es">Spanish</option>
                    <option value="zh">Chinese</option>
                    <option value="ar">Arabic</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="ci">Case interest</Label>
                  <select
                    id="ci"
                    value={caseInterest}
                    onChange={(e) => setCaseInterest(e.target.value)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">—</option>
                    <option value="work_permit">Work permit</option>
                    <option value="study_permit">Study permit</option>
                    <option value="pr">Permanent residence</option>
                    <option value="visitor_visa">Visitor visa</option>
                    <option value="citizenship">Citizenship</option>
                    <option value="refugee">Refugee / asylum</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="br">Branch</Label>
                  <select
                    id="br"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className="mt-1 h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">Auto (firm-level pool)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
                />
              </div>

              <p className="text-xs text-[var(--color-text-muted)]">
                The lead will be auto-assigned via round-robin to an active TELECALLER in the chosen branch.
                If no telecaller is available, you can assign manually from the lead detail page.
              </p>

              {error ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Link href="/leads">
                  <Button type="button" variant="ghost" disabled={busy}>
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" disabled={busy}>
                  {busy ? <Spinner /> : <Inbox size={14} />}
                  Create lead
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
