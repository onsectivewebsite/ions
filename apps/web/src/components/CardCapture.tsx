'use client';
/**
 * Stripe Elements card form with a dry-run fallback.
 *
 * Real mode: loads Stripe.js with the publishable key, renders <PaymentElement>,
 * captures a payment method via stripe.createPaymentMethod (no customer required).
 * The resulting pm_xxx is handed back to the caller, which passes it to either
 * platform.tenant.create (paymentMethodId) or billing.attachPaymentMethod.
 *
 * Dry-run mode: renders a fake form that asks for the magic test card number
 * 4242 4242 4242 4242 and returns pm_dryrun_xxxxxxxxxx. The backend's stripe
 * stub accepts any pm_dryrun_* string.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { CreditCard, Lock } from 'lucide-react';
import { Button, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcQuery } from '../lib/api';

type StripeConfig = { publishableKey: string; dryRun: boolean };

type Props = {
  /** Optional client_secret from a SetupIntent. When provided, we use confirmSetup
   *  to attach the card to an existing customer. Otherwise we createPaymentMethod
   *  (used by the new-firm wizard before the customer exists). */
  clientSecret?: string;
  onSuccess: (paymentMethodId: string) => void;
  buttonLabel?: string;
};

export function CardCapture({ clientSecret, onSuccess, buttonLabel = 'Save card' }: Props) {
  const [config, setConfig] = useState<StripeConfig | null>(null);
  const [stripeLoaded, setStripeLoaded] = useState<Stripe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    rpcQuery<StripeConfig>('billing.config', undefined)
      .then(setConfig)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load Stripe config'));
  }, []);

  useEffect(() => {
    if (!config || config.dryRun) return;
    void loadStripe(config.publishableKey).then((s) => {
      if (s) setStripeLoaded(s);
      else setLoadError('Stripe.js failed to load');
    });
  }, [config]);

  if (loadError) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
        {loadError}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Spinner /> Loading payment form…
      </div>
    );
  }

  if (config.dryRun) {
    return <DryRunCard onSuccess={onSuccess} buttonLabel={buttonLabel} />;
  }

  if (!stripeLoaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Spinner /> Loading Stripe…
      </div>
    );
  }

  return (
    <Elements
      stripe={stripeLoaded}
      options={
        clientSecret
          ? { clientSecret, appearance: { theme: 'stripe' } }
          : { mode: 'setup', currency: 'cad', appearance: { theme: 'stripe' } }
      }
    >
      <RealCard clientSecret={clientSecret} onSuccess={onSuccess} buttonLabel={buttonLabel} />
    </Elements>
  );
}

function RealCard({
  clientSecret,
  onSuccess,
  buttonLabel,
}: {
  clientSecret?: string;
  onSuccess: (pm: string) => void;
  buttonLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? 'Card validation failed');
        return;
      }
      if (clientSecret) {
        // SetupIntent flow — attaches PM to the existing customer.
        const result = await stripe.confirmSetup({
          elements,
          clientSecret,
          confirmParams: { return_url: window.location.href },
          redirect: 'if_required',
        });
        if (result.error) {
          setError(result.error.message ?? 'Card setup failed');
          return;
        }
        const pm = (result.setupIntent?.payment_method as string | undefined) ?? '';
        if (!pm) {
          setError('Stripe did not return a payment method id');
          return;
        }
        onSuccess(pm);
      } else {
        // Pre-customer flow — createPaymentMethod gives us a pm_xxx the backend
        // can attach during platform.tenant.create.
        const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
          elements,
        });
        if (pmError || !paymentMethod) {
          setError(pmError?.message ?? 'Card capture failed');
          return;
        }
        onSuccess(paymentMethod.id);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy || !stripe || !elements}>
        {busy ? <Spinner /> : <Lock size={14} />}
        {buttonLabel}
      </Button>
    </form>
  );
}

function DryRunCard({
  onSuccess,
  buttonLabel,
}: {
  onSuccess: (pm: string) => void;
  buttonLabel: string;
}) {
  const [number, setNumber] = useState('4242 4242 4242 4242');
  const [exp, setExp] = useState('12/34');
  const [cvc, setCvc] = useState('123');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fakePm = useMemo(() => `pm_dryrun_${Math.random().toString(36).slice(2, 14)}`, []);

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setError(null);
    if (number.replace(/\s/g, '').length < 13) {
      setError('Enter a card number (test mode accepts 4242 4242 4242 4242).');
      return;
    }
    setBusy(true);
    // Tiny artificial delay so the loading state is visible (and so the UI flow
    // mirrors the real Stripe path).
    setTimeout(() => {
      setBusy(false);
      onSuccess(fakePm);
    }, 350);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-info)]/30 bg-[color-mix(in_srgb,var(--color-info)_8%,transparent)] p-3 text-xs text-[var(--color-info)]">
        Stripe is in dry-run. This form simulates card capture and produces a
        <span className="ml-1 font-mono">pm_dryrun_*</span> id the backend stub accepts.
        Drop in real keys + flip <span className="font-mono">STRIPE_DRY_RUN=false</span> for real Elements.
      </div>
      <div>
        <Label htmlFor="cn">Card number</Label>
        <div className="relative mt-1">
          <CreditCard
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
          />
          <Input
            id="cn"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="4242 4242 4242 4242"
            className="pl-9 font-mono"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="exp">Expiry</Label>
          <Input
            id="exp"
            value={exp}
            onChange={(e) => setExp(e.target.value)}
            placeholder="MM/YY"
            className="font-mono"
          />
        </div>
        <div>
          <Label htmlFor="cvc">CVC</Label>
          <Input
            id="cvc"
            value={cvc}
            onChange={(e) => setCvc(e.target.value)}
            placeholder="123"
            className="font-mono"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="name">Cardholder name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? <Spinner /> : <Lock size={14} />}
        {buttonLabel}
      </Button>
    </form>
  );
}
