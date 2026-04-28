'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText } from 'lucide-react';
import { Badge, Card, CardTitle, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getPortalToken } from '../../../lib/portal-session';
import { PortalShell } from '../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type Invoice = {
  id: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';
  currency: string;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: string;
  dueDate: string | null;
  case: { id: string; caseType: string };
};

const STATUS_TONE: Record<Invoice['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'warning',
  PARTIAL: 'warning',
  PAID: 'success',
  VOID: 'danger',
};

function fmtMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

export default function PortalInvoicesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('portal.me', undefined, { token }),
      rpcQuery<Invoice[]>('portal.invoicesList', undefined, { token }),
    ])
      .then(([m, inv]) => {
        setMe(m);
        setInvoices(inv);
      })
      .catch(() => router.replace('/portal/sign-in'));
  }, [router]);

  if (!me || invoices === null) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;
  const totalOwing = invoices
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + i.balanceCents, 0);

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Pay your invoices securely. Total outstanding:{' '}
              <strong>{fmtMoney(totalOwing)}</strong>.
            </p>
          </div>

          {invoices.length === 0 ? (
            <Card>
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <FileText size={28} className="mx-auto mb-2 opacity-40" />
                No invoices yet.
              </div>
            </Card>
          ) : (
            <Card>
              <CardTitle>{invoices.length} invoice{invoices.length === 1 ? '' : 's'}</CardTitle>
              <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/portal/invoices/${inv.id}`}
                      className="flex items-center gap-4 py-3 hover:bg-[var(--color-surface)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{inv.number}</span>
                          <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {inv.case.caseType.replace('_', ' ')} · Issued{' '}
                          {new Date(inv.issueDate).toLocaleDateString()}
                          {inv.dueDate
                            ? ` · Due ${new Date(inv.dueDate).toLocaleDateString()}`
                            : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold">
                          {fmtMoney(inv.totalCents, inv.currency)}
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {inv.balanceCents > 0
                            ? `${fmtMoney(inv.balanceCents, inv.currency)} owing`
                            : 'Paid'}
                        </div>
                      </div>
                      <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}
