'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CreditCard, ExternalLink, RotateCcw } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type Me = { kind: 'platform' | 'firm'; name: string; email: string };

type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

type RecentInvoice = {
  id: string;
  stripeInvoiceId: string;
  tenant: { id: string; displayName: string; slug: string } | null;
  amountCents: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  seatCount: number;
  status: InvoiceStatus;
  createdAt: string;
};

type Overview = {
  recentInvoices: RecentInvoice[];
  totalsByStatus: { status: InvoiceStatus; count: number; amountCents: number }[];
};

type PlatformKpis = {
  firmsActive: number;
  seatsTotal: number;
  mrrCents: number;
  arrCents: number;
  planMix: { code: string; firms: number; seats: number; mrrCents: number }[];
};

const STATUS_TONE: Record<InvoiceStatus, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  OPEN: 'warning',
  PAID: 'success',
  VOID: 'neutral',
  UNCOLLECTIBLE: 'danger',
};

function dollar(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

export default function PlatformBillingPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [kpis, setKpis] = useState<PlatformKpis | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'platform') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  useEffect(() => {
    if (!me) return;
    const token = getAccessToken();
    if (!token) return;
    Promise.all([
      rpcQuery<Overview>('platform.billing.overview', undefined, { token }),
      rpcQuery<PlatformKpis>('platform.kpi.dashboard', undefined, { token }),
    ])
      .then(([o, k]) => {
        setOverview(o);
        setKpis(k);
      })
      .catch(() => {
        setOverview({ recentInvoices: [], totalsByStatus: [] });
      });
  }, [me]);

  if (!me) {
    return (
      <main className="grid min-h-screen md:grid-cols-[240px_1fr]">
        <div className="hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:block">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-4 sm:p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding: Branding = { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <CreditCard size={20} />
              Billing
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Cross-firm subscription invoices and recurring revenue.
            </p>
          </div>

          {kpis ? (
            <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tile label="MRR" value={dollar(kpis.mrrCents)} />
              <Tile label="ARR" value={dollar(kpis.arrCents)} />
              <Tile label="Active firms" value={kpis.firmsActive.toLocaleString()} />
              <Tile label="Seats sold" value={kpis.seatsTotal.toLocaleString()} />
            </section>
          ) : null}

          {overview && overview.totalsByStatus.length > 0 ? (
            <Card>
              <CardTitle>Invoice status breakdown</CardTitle>
              <table className="mt-4 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Count</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-muted)]">
                  {overview.totalsByStatus.map((s) => (
                    <tr key={s.status}>
                      <td className="py-2.5">
                        <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right">{s.count}</td>
                      <td className="py-2.5 text-right tabular-nums">{dollar(s.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Recent invoices</CardTitle>
              <CardBody className="text-xs text-[var(--color-text-muted)]">
                Last 20 across all firms
              </CardBody>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Firm</th>
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4">Seats</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Stripe</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {overview === null ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={7} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : overview.recentInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-xs text-[var(--color-text-muted)]">
                        No invoices recorded yet. Invoices sync from Stripe via webhook —
                        once a firm has a real subscription, rows land here.
                      </td>
                    </tr>
                  ) : (
                    overview.recentInvoices.map((inv) => (
                      <tr
                        key={inv.id}
                        className="border-b border-[var(--color-border-muted)] hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4">
                          {inv.tenant ? (
                            <Link
                              href={`/p/firms/${inv.tenant.id}`}
                              className="font-medium hover:underline"
                            >
                              {inv.tenant.displayName}
                            </Link>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(inv.periodStart).toLocaleDateString()} →{' '}
                          {new Date(inv.periodEnd).toLocaleDateString()}
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{inv.seatCount}</td>
                        <td className="py-3 pr-4 tabular-nums">
                          {dollar(inv.amountCents, inv.currency)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <a
                            href={`https://dashboard.stripe.com/invoices/${inv.stripeInvoiceId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
                          >
                            Open <ExternalLink size={10} />
                          </a>
                        </td>
                        <td className="py-3 pr-4">
                          {inv.status === 'PAID' ? (
                            <RefundButton
                              invoiceId={inv.id}
                              amountCents={inv.amountCents}
                              currency={inv.currency}
                              onDone={() => {
                                // Refresh the list.
                                const t = getAccessToken();
                                void rpcQuery<Overview>(
                                  'platform.billing.overview',
                                  undefined,
                                  { token: t },
                                ).then(setOverview);
                              }}
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function RefundButton({
  invoiceId,
  amountCents,
  currency,
  onDone,
}: {
  invoiceId: string;
  amountCents: number;
  currency: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function refund(): Promise<void> {
    if (typeof window === 'undefined') return;
    const fmt = new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(
      amountCents / 100,
    );
    const fullStr = window.prompt(
      `Full refund of ${fmt}? Type FULL for full, or a dollar amount (e.g. 25.00) for partial.`,
      'FULL',
    );
    if (!fullStr) return;
    let amount: number | undefined;
    if (fullStr.trim().toUpperCase() === 'FULL') {
      amount = undefined;
    } else {
      const n = Number(fullStr);
      if (!Number.isFinite(n) || n <= 0) {
        alert('Bad amount.');
        return;
      }
      amount = Math.round(n * 100);
    }
    const reason = window.prompt(
      'Reason (logged + sent to Stripe):',
      'Customer requested refund',
    );
    if (!reason) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'platform.billing.refundInvoice',
        {
          invoiceId,
          amountCents: amount,
          reason: 'requested_by_customer',
          note: reason,
        },
        { token },
      );
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={refund}>
      <RotateCcw size={12} />
      {busy ? 'Refunding…' : 'Refund'}
    </Button>
  );
}
