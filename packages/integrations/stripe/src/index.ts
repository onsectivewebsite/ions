/**
 * Thin Stripe wrapper. Two modes:
 *
 *  - Real: instantiates the official `stripe` SDK with the secret key.
 *  - Dry-run: short-circuits every method, logs the call, returns plausible
 *    mock data so the rest of the system can be built and exercised end-to-end
 *    before real keys are wired.
 *
 * Dry-run is auto-enabled when `STRIPE_DRY_RUN=true` OR when the secret key
 * starts with `sk_dummy` / is empty. Flip the env flag to false (and supply a
 * real `sk_test_*`) to switch over.
 */
import Stripe from 'stripe';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

export type StripeMode = 'real' | 'dry-run';

export const stripeMode: StripeMode =
  env.STRIPE_DRY_RUN ||
  !env.STRIPE_SECRET_KEY ||
  env.STRIPE_SECRET_KEY.startsWith('sk_dummy')
    ? 'dry-run'
    : 'real';

const realClient =
  stripeMode === 'real'
    ? new Stripe(env.STRIPE_SECRET_KEY!, {
        // Pin the latest API version supported by the SDK at install time.
        apiVersion: '2025-02-24.acacia',
        typescript: true,
        appInfo: { name: 'OnsecBoad', version: '0.0.0' },
      })
    : null;

function id(prefix: string): string {
  return `${prefix}_dryrun_${Math.random().toString(36).slice(2, 12)}`;
}

function log(op: string, args: Record<string, unknown> = {}): void {
  if (stripeMode === 'dry-run') {
    // eslint-disable-next-line no-console
    console.log(`[stripe:dry-run] ${op}`, args);
  }
}

// ─── Customers ────────────────────────────────────────────────────────────

export type CreateCustomerInput = {
  email: string;
  name: string;
  tenantId: string;
};

export async function createCustomer(input: CreateCustomerInput): Promise<{ id: string }> {
  if (stripeMode === 'dry-run') {
    log('customers.create', input);
    return { id: id('cus') };
  }
  const c = await realClient!.customers.create({
    email: input.email,
    name: input.name,
    metadata: { tenantId: input.tenantId },
  });
  return { id: c.id };
}

export type UpdateCustomerInput = {
  email?: string;
  name?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  };
};

export async function updateCustomer(
  customerId: string,
  patch: UpdateCustomerInput,
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('customers.update', { customerId, patch });
    return;
  }
  await realClient!.customers.update(customerId, patch);
}

export type SetTaxIdInput = { type: string; value: string };

/**
 * Replace the customer's tax ID. Stripe doesn't support updating an existing
 * tax_id row, so we delete any existing ones and create a fresh one.
 */
export async function setCustomerTaxId(
  customerId: string,
  input: SetTaxIdInput | null,
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('customers.setTaxId', { customerId, input });
    return;
  }
  const existing = await realClient!.customers.listTaxIds(customerId, { limit: 10 });
  for (const t of existing.data) {
    await realClient!.customers.deleteTaxId(customerId, t.id);
  }
  if (input) {
    await realClient!.customers.createTaxId(customerId, {
      type: input.type as never, // Stripe enum is too long to mirror locally
      value: input.value,
    });
  }
}

// ─── Subscriptions ────────────────────────────────────────────────────────

export type CreateSubscriptionInput = {
  customerId: string;
  priceId: string;
  quantity: number;
  trialDays?: number;
  tenantId: string;
};

export type SubscriptionRef = {
  id: string;
  status: string;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
};

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<SubscriptionRef> {
  if (stripeMode === 'dry-run') {
    log('subscriptions.create', input);
    const now = Date.now();
    return {
      id: id('sub'),
      status: input.trialDays && input.trialDays > 0 ? 'trialing' : 'active',
      currentPeriodEnd: new Date(now + 30 * 24 * 60 * 60 * 1000),
      trialEnd: input.trialDays
        ? new Date(now + input.trialDays * 24 * 60 * 60 * 1000)
        : null,
    };
  }
  const sub = await realClient!.subscriptions.create({
    customer: input.customerId,
    items: [{ price: input.priceId, quantity: input.quantity }],
    trial_period_days: input.trialDays,
    metadata: { tenantId: input.tenantId },
    payment_behavior: 'default_incomplete',
    expand: ['latest_invoice.payment_intent'],
  });
  return {
    id: sub.id,
    status: sub.status,
    currentPeriodEnd: new Date(sub.current_period_end * 1000),
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
  };
}

export async function updateSubscriptionQuantity(
  subscriptionId: string,
  quantity: number,
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('subscriptions.update.quantity', { subscriptionId, quantity });
    return;
  }
  const sub = await realClient!.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error('Subscription has no items');
  await realClient!.subscriptionItems.update(itemId, { quantity });
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPriceId: string,
  proration: 'create_prorations' | 'none' = 'create_prorations',
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('subscriptions.update.plan', { subscriptionId, newPriceId, proration });
    return;
  }
  const sub = await realClient!.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error('Subscription has no items');
  await realClient!.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: newPriceId }],
    proration_behavior: proration,
  });
}

export async function cancelSubscription(
  subscriptionId: string,
  immediate: boolean,
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('subscriptions.cancel', { subscriptionId, immediate });
    return;
  }
  if (immediate) {
    await realClient!.subscriptions.cancel(subscriptionId);
  } else {
    await realClient!.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }
}

// ─── SetupIntent (for card capture without charging) ──────────────────────

export async function createSetupIntent(
  customerId: string,
): Promise<{ clientSecret: string }> {
  if (stripeMode === 'dry-run') {
    log('setupIntents.create', { customerId });
    return { clientSecret: `seti_${id('').slice(4)}_secret_${id('').slice(4)}` };
  }
  const si = await realClient!.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
  });
  if (!si.client_secret) throw new Error('Stripe did not return a client_secret');
  return { clientSecret: si.client_secret };
}

export async function attachPaymentMethod(
  customerId: string,
  paymentMethodId: string,
  setAsDefault = true,
): Promise<void> {
  if (stripeMode === 'dry-run') {
    log('paymentMethods.attach', { customerId, paymentMethodId, setAsDefault });
    return;
  }
  await realClient!.paymentMethods.attach(paymentMethodId, { customer: customerId });
  if (setAsDefault) {
    await realClient!.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }
}

// ─── Case-level payment intents (Phase 7.2) ───────────────────────────────

export type CreatePaymentIntentInput = {
  amountCents: number;
  currency: string;            // 'CAD' / 'USD' — Stripe lower-cases internally
  description?: string;
  customerId?: string;         // optional — client portal payments don't need one
  receiptEmail?: string;
  metadata: Record<string, string>;  // tenantId / caseId / invoiceId / clientId
};

export async function createPaymentIntent(
  input: CreatePaymentIntentInput,
): Promise<{ id: string; clientSecret: string }> {
  if (stripeMode === 'dry-run') {
    log('paymentIntents.create', input);
    const piId = id('pi');
    return { id: piId, clientSecret: `${piId}_secret_${id('').slice(4)}` };
  }
  const pi = await realClient!.paymentIntents.create({
    amount: input.amountCents,
    currency: input.currency.toLowerCase(),
    description: input.description,
    customer: input.customerId,
    receipt_email: input.receiptEmail,
    metadata: input.metadata,
    automatic_payment_methods: { enabled: true },
  });
  if (!pi.client_secret) throw new Error('Stripe did not return a client_secret');
  return { id: pi.id, clientSecret: pi.client_secret };
}

export type PaymentIntentSnapshot = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
};

export async function retrievePaymentIntent(piId: string): Promise<PaymentIntentSnapshot> {
  if (stripeMode === 'dry-run') {
    log('paymentIntents.retrieve', { piId });
    return { id: piId, status: 'succeeded', amount: 0, currency: 'cad', metadata: {} };
  }
  const pi = await realClient!.paymentIntents.retrieve(piId);
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    currency: pi.currency,
    metadata: (pi.metadata ?? {}) as Record<string, string>,
  };
}

/**
 * Refund a paid subscription invoice. Looks up the invoice's
 * payment_intent / charge and creates a refund against it. Amount is
 * optional — omit for a full refund.
 *
 * Returns the refund id + status. In dry-run we pretend it succeeded.
 */
export type RefundInvoiceInput = {
  invoiceId: string;
  amountCents?: number;
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
};

export type RefundInvoiceResult = {
  refundId: string;
  status: string;
  amountCents: number;
  mode: StripeMode;
};

export async function refundInvoice(
  input: RefundInvoiceInput,
): Promise<RefundInvoiceResult> {
  if (stripeMode === 'dry-run') {
    log('invoice.refund', input);
    return {
      refundId: 're_dryrun_' + Math.random().toString(36).slice(2, 10),
      status: 'succeeded',
      amountCents: input.amountCents ?? 0,
      mode: 'dry-run',
    };
  }
  const inv = await realClient!.invoices.retrieve(input.invoiceId, {
    expand: ['payment_intent'],
  });
  const pi = inv.payment_intent as { id?: string } | string | null | undefined;
  const piId = typeof pi === 'string' ? pi : (pi?.id ?? null);
  if (!piId) {
    throw new Error('Invoice has no payment_intent — only paid invoices can be refunded.');
  }
  const refund = await realClient!.refunds.create({
    payment_intent: piId,
    amount: input.amountCents,
    reason: input.reason,
    metadata: { invoiceId: inv.id },
  });
  return {
    refundId: refund.id,
    status: refund.status ?? 'pending',
    amountCents: refund.amount,
    mode: 'real',
  };
}

// ─── Webhook signature verification ───────────────────────────────────────

export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
): { event: { id: string; type: string; data: { object: unknown } }; ok: boolean; error?: string } {
  if (stripeMode === 'dry-run') {
    // In dry-run we accept the body verbatim — useful for local replay.
    try {
      const event = JSON.parse(typeof payload === 'string' ? payload : payload.toString('utf8'));
      log('webhook.verify (skipped — dry-run)', { type: event?.type, id: event?.id });
      return { event, ok: true };
    } catch (e) {
      return {
        event: { id: '', type: '', data: { object: {} } },
        ok: false,
        error: e instanceof Error ? e.message : 'invalid JSON',
      };
    }
  }
  if (!signature) return { event: { id: '', type: '', data: { object: {} } }, ok: false, error: 'missing signature' };
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return { event: { id: '', type: '', data: { object: {} } }, ok: false, error: 'STRIPE_WEBHOOK_SECRET unset' };
  }
  try {
    const event = realClient!.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET);
    return { event, ok: true };
  } catch (e) {
    return {
      event: { id: '', type: '', data: { object: {} } },
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Misc ─────────────────────────────────────────────────────────────────

export function publishableKey(): string {
  return env.STRIPE_PUBLISHABLE_KEY ?? 'pk_dummy_publishable';
}

export function isDryRun(): boolean {
  return stripeMode === 'dry-run';
}
