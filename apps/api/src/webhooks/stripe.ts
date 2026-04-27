/**
 * Stripe webhook endpoint. Mounted at POST /api/v1/webhooks/stripe.
 *
 * - Body must arrive as raw bytes (not JSON) so the signature can be verified.
 * - Idempotency: every event.id is recorded in WebhookEvent on first receipt.
 *   A duplicate delivery short-circuits with 200 so Stripe stops retrying.
 * - Failures during processing leave processedAt null and store the error;
 *   Stripe will retry per its schedule.
 *
 * In dry-run, the verifier is permissive (parses raw JSON) so curl-based local
 * replay works without a real signature.
 */
import type { Request, Response } from 'express';
import { verifyWebhookSignature } from '@onsecboad/stripe';
import { uploadRemoteUrl, isDryRun as r2DryRun } from '@onsecboad/r2';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';

type StripeEvent = { id: string; type: string; data: { object: unknown } };

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const sig = req.header('stripe-signature') ?? undefined;
  const result = verifyWebhookSignature(req.body as Buffer, sig);
  if (!result.ok) {
    logger.warn({ err: result.error }, 'stripe webhook signature failed');
    res.status(400).json({ ok: false, error: result.error ?? 'invalid signature' });
    return;
  }
  const event = result.event as StripeEvent;
  if (!event.id) {
    res.status(400).json({ ok: false, error: 'event missing id' });
    return;
  }

  // Idempotency: insert-once on event.id. Duplicates are silently ack'd.
  const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (existing?.processedAt) {
    logger.info({ id: event.id, type: event.type }, 'stripe webhook duplicate, ack');
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }
  if (!existing) {
    try {
      await prisma.webhookEvent.create({
        data: {
          id: event.id,
          source: 'stripe',
          type: event.type,
          payload: event as unknown as object,
        },
      });
    } catch (e) {
      // Race: another worker took the same event. Treat as duplicate.
      logger.info({ id: event.id, err: e }, 'stripe webhook race insert');
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  }

  try {
    await dispatch(event);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date(), error: null },
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ id: event.id, type: event.type, err: msg }, 'stripe webhook handler error');
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { error: msg },
    });
    // 500 → Stripe retries. We've recorded the error for inspection.
    res.status(500).json({ ok: false, error: msg });
  }
}

async function dispatch(event: StripeEvent): Promise<void> {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionChange(event);
      break;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event);
      break;
    case 'invoice.finalized':
    case 'invoice.paid':
    case 'invoice.payment_failed':
      await onInvoice(event);
      break;
    default:
      logger.info({ type: event.type, id: event.id }, 'stripe webhook ignored');
  }
}

type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  current_period_end?: number;
  trial_end?: number | null;
  metadata?: Record<string, string>;
};

async function onSubscriptionChange(event: StripeEvent): Promise<void> {
  const sub = event.data.object as StripeSubscription;
  const tenant = await prisma.tenant.findFirst({
    where: { stripeSubscriptionId: sub.id },
  });
  if (!tenant) {
    logger.warn({ subId: sub.id }, 'stripe subscription event for unknown tenant');
    return;
  }
  const trialEndsAt = sub.trial_end ? new Date(sub.trial_end * 1000) : null;
  const newStatus =
    sub.status === 'active' || sub.status === 'trialing'
      ? 'ACTIVE'
      : sub.status === 'past_due' || sub.status === 'unpaid'
        ? 'SUSPENDED'
        : sub.status === 'canceled'
          ? 'CANCELED'
          : tenant.status;
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      status: newStatus,
      trialEndsAt: trialEndsAt ?? tenant.trialEndsAt,
    },
  });
}

async function onSubscriptionDeleted(event: StripeEvent): Promise<void> {
  const sub = event.data.object as StripeSubscription;
  const tenant = await prisma.tenant.findFirst({
    where: { stripeSubscriptionId: sub.id },
  });
  if (!tenant) return;
  await prisma.tenant.update({ where: { id: tenant.id }, data: { status: 'CANCELED' } });
}

type StripeInvoice = {
  id: string;
  customer: string;
  amount_paid: number;
  amount_due: number;
  currency: string;
  status: string;
  period_start: number;
  period_end: number;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  lines?: { data: Array<{ quantity: number }> };
};

async function onInvoice(event: StripeEvent): Promise<void> {
  const inv = event.data.object as StripeInvoice;
  const tenant = await prisma.tenant.findFirst({ where: { stripeCustomerId: inv.customer } });
  if (!tenant) return;
  const seatCount = inv.lines?.data[0]?.quantity ?? tenant.seatCount;

  // Cache the invoice PDF to R2 (private bucket; UI serves a 1h signed URL via
  // billing.invoiceUrl). In dry-run, uploadRemoteUrl no-ops and returns the
  // source URL, so the UI still works.
  let cachedPdfUrl = inv.invoice_pdf ?? null;
  if (inv.invoice_pdf) {
    try {
      const r2Key = `tenants/${tenant.id}/invoices/${inv.id}.pdf`;
      const result = await uploadRemoteUrl(r2Key, inv.invoice_pdf, 'application/pdf');
      cachedPdfUrl = result.url;
      if (!r2DryRun()) {
        logger.info({ stripeInvoiceId: inv.id, bytes: result.bytes }, 'invoice PDF cached to R2');
      }
    } catch (e) {
      logger.error({ err: e, stripeInvoiceId: inv.id }, 'invoice PDF cache failed; falling back to Stripe-hosted URL');
    }
  }

  await prisma.subscriptionInvoice.upsert({
    where: { stripeInvoiceId: inv.id },
    update: {
      amountCents: BigInt(inv.amount_due),
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      periodStart: new Date(inv.period_start * 1000),
      periodEnd: new Date(inv.period_end * 1000),
      seatCount,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: cachedPdfUrl,
    },
    create: {
      tenantId: tenant.id,
      stripeInvoiceId: inv.id,
      amountCents: BigInt(inv.amount_due),
      currency: inv.currency.toUpperCase(),
      status: inv.status,
      periodStart: new Date(inv.period_start * 1000),
      periodEnd: new Date(inv.period_end * 1000),
      seatCount,
      hostedUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: cachedPdfUrl,
    },
  });
}
