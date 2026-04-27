'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText, Search } from 'lucide-react';
import {
  Badge,
  Card,
  CardTitle,
  Input,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';
import { useRealtime } from '../../lib/realtime';

type CaseRow = {
  id: string;
  caseType: string;
  status: CaseStatus;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  updatedAt: string;
  client: { id: string; firstName: string | null; lastName: string | null; phone: string };
  lawyer: { id: string; name: string };
  filer: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
};

type CaseStatus =
  | 'PENDING_RETAINER'
  | 'PENDING_RETAINER_SIGNATURE'
  | 'PENDING_DOCUMENTS'
  | 'PREPARING'
  | 'PENDING_LAWYER_APPROVAL'
  | 'SUBMITTED_TO_IRCC'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'WITHDRAWN'
  | 'ABANDONED';

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const STATUS_TONE: Record<CaseStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  PENDING_RETAINER: 'warning',
  PENDING_RETAINER_SIGNATURE: 'warning',
  PENDING_DOCUMENTS: 'warning',
  PREPARING: 'neutral',
  PENDING_LAWYER_APPROVAL: 'warning',
  SUBMITTED_TO_IRCC: 'success',
  IN_REVIEW: 'success',
  COMPLETED: 'success',
  WITHDRAWN: 'danger',
  ABANDONED: 'danger',
};

const STATUS_OPTIONS: Array<{ value: '' | CaseStatus; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_RETAINER', label: 'Pending retainer' },
  { value: 'PENDING_RETAINER_SIGNATURE', label: 'Pending signature' },
  { value: 'PENDING_DOCUMENTS', label: 'Pending docs' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'PENDING_LAWYER_APPROVAL', label: 'Pending lawyer approval' },
  { value: 'SUBMITTED_TO_IRCC', label: 'Submitted to IRCC' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'ABANDONED', label: 'Abandoned' },
];

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CasesListPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | CaseStatus>('');

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [m, list] = await Promise.all([
        rpcQuery<Me>('user.me', undefined, { token }),
        rpcQuery<{ items: CaseRow[]; total: number }>(
          'cases.list',
          { page: 1, q: q || undefined, status: status || undefined },
          { token },
        ),
      ]);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
      setItems(list.items);
      setTotal(list.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, status]);

  useRealtime((ev) => {
    if (ev.type === 'case.status' || ev.type === 'appointment.outcome') void load();
  });

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
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Case management</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Cases</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Retained matters from consult outcome through IRCC submission. New cases auto-create
              when an appointment outcome is recorded as RETAINER.
            </p>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void load();
              }}
              className="flex flex-wrap items-center gap-3"
            >
              <div className="flex-1 min-w-[240px]">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by client name, phone, email…"
                />
              </div>
              <select
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | CaseStatus)}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-surface-muted)]"
              >
                <Search size={14} /> Search
              </button>
            </form>
          </Card>

          <Card>
            <div className="flex items-baseline justify-between">
              <CardTitle>Cases ({total})</CardTitle>
            </div>
            {items.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <FileText size={28} className="mx-auto mb-2 opacity-40" />
                No cases match your filters.
              </div>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-border-muted)]">
                {items.map((c) => {
                  const subject =
                    [c.client.firstName, c.client.lastName].filter(Boolean).join(' ') ||
                    c.client.phone;
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/cases/${c.id}`}
                        className="flex items-center gap-4 py-3 hover:bg-[var(--color-surface-muted)]"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{subject}</span>
                            <Badge tone={STATUS_TONE[c.status]}>
                              {c.status.replaceAll('_', ' ')}
                            </Badge>
                            <Badge tone="neutral">{c.caseType.replace('_', ' ')}</Badge>
                            {c.feesCleared ? <Badge tone="success">Paid</Badge> : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                            <span>Lawyer: {c.lawyer.name}</span>
                            {c.filer ? <span>· Filer: {c.filer.name}</span> : null}
                            {c.branch ? <span>· {c.branch.name}</span> : null}
                            <span>· {fmtMoney(c.amountPaidCents)} / {fmtMoney(c.totalFeeCents ?? c.retainerFeeCents)}</span>
                            {c.irccFileNumber ? <span>· IRCC #{c.irccFileNumber}</span> : null}
                          </div>
                        </div>
                        <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}
