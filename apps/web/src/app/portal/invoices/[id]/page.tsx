'use client';
import { use, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, CreditCard, Lock } from 'lucide-react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
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
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getPortalToken } from '../../../../lib/portal-session';
import { PortalShell } from '../../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type InvoiceDetail = {
  id: string;
  number: string;
  status: 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: string;
  dueDate: string | null;
  notes: string | null;
  case: { id: string; caseType: string; status: string };
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    taxRateBp: number;
    amountCents: number;
  }>;
  payments: Array<{
    id: string;
    amountCents: number;
    refundedCents: number;
    method: string;
    status: string;
    receivedAt: string;
  }>;
};

type IntentResponse = {
  clientSecret: string;
  paymentIntentId: string;
  publishableKey: string;
  dryRun: boolean;
  amountCents: number;
  currency: string;
};

const STATUS_TONE: Record<InvoiceDetail['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'warning',
  PARTIAL: 'warning',
  PAID: 'success',
  VOID: 'danger',
};

function fmtMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

export default function PortalInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [paying, setPaying] = useState<IntentResponse | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    try {
      const [m, i] = await Promise.all([
        rpcQuery<Me>('portal.me', undefined, { token }),
        rpcQuery<InvoiceDetail>('portal.invoiceGet', { id }, { token }),
      ]);
      setMe(m);
      setInv(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function startPayment(): Promise<void> {
    setError(null);
    try {
      const token = getPortalToken();
      const r = await rpcMutation<IntentResponse>(
        'portal.paymentsIntent',
        { invoiceId: id },
        { token },
      );
      setPaying(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start payment');
    }
  }

  if (!me || !inv) {
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
  const canPay =
    inv.status !== 'VOID' && inv.status !== 'DRAFT' && inv.balanceCents > 0;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-4">
          <Link
            href="/portal/invoices"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} /> All invoices
          </Link>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-mono text-2xl font-semibold tracking-tight">{inv.number}</h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
                <span>{inv.case.caseType.replace('_', ' ')}</span>
                <span>· Issued {new Date(inv.issueDate).toLocaleDateString()}</span>
                {inv.dueDate ? (
                  <span>· Due {new Date(inv.dueDate).toLocaleDateString()}</span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold">
                {fmtMoney(inv.totalCents, inv.currency)}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">
                {inv.balanceCents > 0
                  ? `${fmtMoney(inv.balanceCents, inv.currency)} owing`
                  : 'Paid in full'}
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)] p-3 text-sm text-[var(--color-success)]">
              <CheckCircle2 size={14} className="mr-1 inline" /> Payment received. Your firm will see
              this immediately. The invoice will mark as paid as soon as the payment processor confirms
              (usually a few seconds).
            </div>
          ) : null}

          <Card>
            <CardTitle>Line items</CardTitle>
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <tr>
                  <th className="py-2">Description</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Tax</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t border-[var(--color-border-muted)] align-top"
                  >
                    <td className="py-2">{it.description}</td>
                    <td className="py-2 text-right">{it.quantity}</td>
                    <td className="py-2 text-right">{fmtMoney(it.unitPriceCents, inv.currency)}</td>
                    <td className="py-2 text-right">{(it.taxRateBp / 100).toFixed(2)}%</td>
                    <td className="py-2 text-right font-medium">
                      {fmtMoney(it.amountCents, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t border-[var(--color-border)]">
                  <td colSpan={4} className="py-2 text-right text-[var(--color-text-muted)]">
                    Subtotal
                  </td>
                  <td className="py-2 text-right">{fmtMoney(inv.subtotalCents, inv.currency)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="py-1 text-right text-[var(--color-text-muted)]">
                    Tax
                  </td>
                  <td className="py-1 text-right">{fmtMoney(inv.taxCents, inv.currency)}</td>
                </tr>
                <tr className="border-t border-[var(--color-border)]">
                  <td colSpan={4} className="py-2 text-right text-sm font-semibold">
                    Total
                  </td>
                  <td className="py-2 text-right text-base font-semibold">
                    {fmtMoney(inv.totalCents, inv.currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
            {inv.notes ? (
              <p className="mt-3 whitespace-pre-line border-t border-[var(--color-border-muted)] pt-3 text-sm text-[var(--color-text-muted)]">
                {inv.notes}
              </p>
            ) : null}
          </Card>

          {canPay && !paying ? (
            <Card>
              <CardTitle>Pay this invoice</CardTitle>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Pay <strong>{fmtMoney(inv.balanceCents, inv.currency)}</strong> securely with your
                debit or credit card. Your firm will be notified the moment the payment clears.
              </p>
              <Button className="mt-3" onClick={() => void startPayment()}>
                <Lock size={12} /> Pay {fmtMoney(inv.balanceCents, inv.currency)}
              </Button>
            </Card>
          ) : null}

          {paying ? (
            <Card>
              <CardTitle>Secure payment</CardTitle>
              <p className="mb-3 mt-2 text-sm text-[var(--color-text-muted)]">
                Paying <strong>{fmtMoney(paying.amountCents, paying.currency)}</strong>
              </p>
              <PaymentBlock
                config={paying}
                onCompleted={async () => {
                  setSuccess(true);
                  setPaying(null);
                  // Reload — the webhook may already have flipped the invoice to PAID.
                  await load();
                }}
                onError={(m) => setError(m)}
              />
            </Card>
          ) : null}

          <Card>
            <CardTitle>Payments on this invoice</CardTitle>
            {inv.payments.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">No payments yet.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {inv.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border-muted)] px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{fmtMoney(p.amountCents, inv.currency)}</span>
                      {p.refundedCents > 0 ? (
                        <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                          (refunded {fmtMoney(p.refundedCents, inv.currency)})
                        </span>
                      ) : null}
                      <span className="ml-2 text-xs uppercase text-[var(--color-text-muted)]">
                        {p.method}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {new Date(p.receivedAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}

function PaymentBlock({
  config,
  onCompleted,
  onError,
}: {
  config: IntentResponse;
  onCompleted: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [stripe, setStripe] = useState<Stripe | null>(null);

  useEffect(() => {
    if (config.dryRun) return;
    void loadStripe(config.publishableKey).then((s) => {
      if (s) setStripe(s);
      else onError('Stripe.js failed to load');
    });
  }, [config.publishableKey, config.dryRun, onError]);

  if (config.dryRun) {
    return <DryRunPayForm config={config} onCompleted={onCompleted} />;
  }
  if (!stripe) {
    return (
      <div className="text-xs text-[var(--color-text-muted)]">
        <Spinner /> Loading secure payment…
      </div>
    );
  }
  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: config.clientSecret,
        appearance: { theme: 'stripe' },
      }}
    >
      <RealPaymentForm onCompleted={onCompleted} onError={onError} />
    </Elements>
  );
}

function RealPaymentForm({
  onCompleted,
  onError,
}: {
  onCompleted: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function pay(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // Stripe redirects to this URL on completion. The portal page picks up
        // the success state by reloading the invoice.
        return_url: `${window.location.origin}${window.location.pathname}?paid=1`,
      },
      redirect: 'if_required',
    });
    setBusy(false);
    if (result.error) {
      onError(result.error.message ?? 'Payment failed');
      return;
    }
    if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
      await onCompleted();
    }
  }

  return (
    <form onSubmit={pay} className="space-y-3">
      <PaymentElement />
      <Button type="submit" disabled={busy || !stripe}>
        {busy ? <Spinner /> : <CreditCard size={12} />} Pay now
      </Button>
    </form>
  );
}

// Dry-run replica of the Stripe Elements form. Lets the full pay flow be
// exercised end-to-end without real keys: any "valid-looking" 16-digit card
// triggers `onCompleted`, which reloads the invoice from the server.
function DryRunPayForm({
  config,
  onCompleted,
}: {
  config: IntentResponse;
  onCompleted: () => void | Promise<void>;
}) {
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [busy, setBusy] = useState(false);

  async function fakePay(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    // The real webhook would normally fire here. In dry-run we have no
    // Stripe to send the event, so the staff side won't see a CasePayment
    // until someone replays the webhook payload manually. The success
    // screen + log explain this clearly.
    // eslint-disable-next-line no-console
    console.log('[stripe:dry-run] confirm', { paymentIntentId: config.paymentIntentId, card });
    await new Promise((r) => setTimeout(r, 600));
    setBusy(false);
    await onCompleted();
  }

  return (
    <form onSubmit={fakePay} className="space-y-3">
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
        <Lock size={11} className="mr-1 inline" />
        Dry-run mode — no real charge. Use 4242 4242 4242 4242 / any CVV / any future expiry.
      </div>
      <div>
        <Label>Card number</Label>
        <Input value={card} onChange={(e) => setCard(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy || card.replace(/\s/g, '').length < 12}>
        {busy ? <Spinner /> : <CreditCard size={12} />} Pay
      </Button>
    </form>
  );
}

