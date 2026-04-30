'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Briefcase } from 'lucide-react';
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

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

type Client = { id: string; firstName: string | null; lastName: string | null; phone: string };
type UserOpt = { id: string; name: string; role: { name: string } };

const CASE_TYPES = [
  'work_permit',
  'study_permit',
  'visitor_visa',
  'pr_economic',
  'pr_family',
  'pr_humanitarian',
  'citizenship',
  'lmia',
  'spousal_sponsorship',
  'refugee_claim',
  'appeal',
  'other',
];

export default function NewCasePage() {
  return (
    <Suspense fallback={null}>
      <NewCaseInner />
    </Suspense>
  );
}

function NewCaseInner() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params.get('clientId');

  const [me, setMe] = useState<Me | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [users, setUsers] = useState<UserOpt[]>([]);

  const [caseType, setCaseType] = useState('work_permit');
  const [lawyerId, setLawyerId] = useState('');
  const [filerId, setFilerId] = useState('');
  const [retainerFee, setRetainerFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    if (!clientId) {
      setErr('Missing client. Open a case from a client detail page.');
      return;
    }
    Promise.all([
      rpcQuery<Me>('user.me', undefined, { token }),
      rpcQuery<{ client: Client }>('client.get', { id: clientId }, { token }),
      rpcQuery<{ items: UserOpt[] }>('user.list', { page: 1, status: 'ACTIVE' }, { token }),
    ])
      .then(([m, c, u]) => {
        setMe(m);
        setClient(c.client);
        const items = u.items.filter((x) => /lawyer|admin|paralegal/i.test(x.role.name));
        setUsers(items);
        const firstLawyer = items.find((x) => /lawyer/i.test(x.role.name));
        if (firstLawyer) setLawyerId(firstLawyer.id);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, [clientId, router]);

  async function submit(): Promise<void> {
    if (!clientId || !lawyerId) return;
    setBusy(true);
    setErr(null);
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ id: string }>(
        'case.create',
        {
          clientId,
          caseType,
          lawyerId,
          filerId: filerId || undefined,
          retainerFeeCents: retainerFee ? Math.round(Number(retainerFee) * 100) : undefined,
        },
        { token },
      );
      router.push(`/cases/${r.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  if (!me || (!client && !err)) {
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

  const branding = me?.tenant?.branding ?? { themeCode: 'maple' as const };
  const shellUser: ShellUser = {
    name: me!.name,
    email: me!.email,
    scope: 'firm',
    contextLabel: me!.tenant.displayName,
  };
  const clientName = client
    ? [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Unnamed client'
    : '';
  const lawyers = users.filter((u) => /lawyer|admin/i.test(u.role.name));
  const filers = users.filter((u) => /paralegal|filer|admin/i.test(u.role.name));

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          {clientId ? (
            <Link
              href={`/clients/${clientId}`}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <ArrowLeft size={12} />
              Back to client
            </Link>
          ) : null}

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">New case</h1>
            {client ? (
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                For{' '}
                <span className="font-medium text-[var(--color-text)]">{clientName}</span>{' '}
                · {client.phone}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-danger)]">{err}</p>
            )}
          </div>

          {client ? (
            <Card>
              <CardTitle>Case details</CardTitle>
              <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
                You can change the lawyer, filer, and retainer fee later.
              </CardBody>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs">
                  <Label className="mb-1 block">Case type</Label>
                  <select
                    value={caseType}
                    onChange={(e) => setCaseType(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    {CASE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <Label className="mb-1 block">Retainer fee (CAD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={retainerFee}
                    onChange={(e) => setRetainerFee(e.target.value)}
                    placeholder="2500.00"
                  />
                </label>
                <label className="text-xs">
                  <Label className="mb-1 block">Lawyer of record</Label>
                  <select
                    value={lawyerId}
                    onChange={(e) => setLawyerId(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">— pick a lawyer —</option>
                    {lawyers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role.name})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <Label className="mb-1 block">Paralegal / filer (optional)</Label>
                  <select
                    value={filerId}
                    onChange={(e) => setFilerId(e.target.value)}
                    className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  >
                    <option value="">— none —</option>
                    {filers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {err ? (
                <div className="mt-3 text-sm text-[var(--color-danger)]">{err}</div>
              ) : null}

              <div className="mt-4 flex justify-end gap-2">
                <Link href={`/clients/${clientId}`}>
                  <Button variant="ghost">Cancel</Button>
                </Link>
                <Button onClick={submit} disabled={busy || !lawyerId || !caseType}>
                  <Briefcase size={14} />
                  {busy ? 'Creating…' : 'Create case'}
                </Button>
              </div>
            </Card>
          ) : null}
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
