'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CircleDollarSign } from 'lucide-react';
import { Badge, Card, CardTitle, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getPortalToken } from '../../../lib/portal-session';
import { PortalShell } from '../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type Payment = {
  id: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  method: string;
  status: 'COMPLETED' | 'PARTIAL_REFUND' | 'REFUNDED';
  receivedAt: string;
  invoice: { id: string; number: string } | null;
};

const STATUS_TONE: Record<Payment['status'], 'success' | 'warning' | 'danger'> = {
  COMPLETED: 'success',
  PARTIAL_REFUND: 'warning',
  REFUNDED: 'danger',
};

function fmtMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

export default function PortalPaymentsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('portal.me', undefined, { token }),
      rpcQuery<Payment[]>('portal.paymentsHistory', undefined, { token }),
    ])
      .then(([m, p]) => {
        setMe(m);
        setPayments(p);
      })
      .catch(() => router.replace('/portal/sign-in'));
  }, [router]);

  if (!me || payments === null) {
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
  const totalPaid = payments
    .filter((p) => p.status !== 'REFUNDED')
    .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Payment history</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Total paid to date: <strong>{fmtMoney(totalPaid)}</strong>.
            </p>
          </div>

          {payments.length === 0 ? (
            <Card>
              <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                <CircleDollarSign size={28} className="mx-auto mb-2 opacity-40" />
                No payments yet.
              </div>
            </Card>
          ) : (
            <Card>
              <CardTitle>{payments.length} payment{payments.length === 1 ? '' : 's'}</CardTitle>
              <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{fmtMoney(p.amountCents, p.currency)}</span>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status.replace('_', ' ')}</Badge>
                        {p.refundedCents > 0 ? (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            (refunded {fmtMoney(p.refundedCents, p.currency)})
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {new Date(p.receivedAt).toLocaleString()} ·{' '}
                        <span className="uppercase">{p.method}</span>
                        {p.invoice ? (
                          <>
                            {' · '}
                            <Link
                              href={`/portal/invoices/${p.invoice.id}`}
                              className="hover:text-[var(--color-text)]"
                            >
                              {p.invoice.number}
                            </Link>
                          </>
                        ) : null}
                      </div>
                    </div>
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
