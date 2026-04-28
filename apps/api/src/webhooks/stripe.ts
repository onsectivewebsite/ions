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
import {
  recomputeCaseFinances,
  refreshInvoiceStatuses,
} from '../lib/case-finances.js';

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
    case 'payment_intent.succeeded':
      await onPaymentIntentSucceeded(event);
      break;
    case 'payment_intent.payment_failed':
      await onPaymentIntentFailed(event);
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

// ─── Phase 7.2: Case-level payment intents ──────────────────────────────────

type StripePaymentIntent = {
  id: string;
  status: string;
  amount: number;
  amount_received?: number;
  currency: string;
  description?: string | null;
  metadata?: Record<string, string>;
  last_payment_error?: { message?: string; code?: string };
};

/**
 * payment_intent.succeeded — client paid an invoice in the portal.
 *
 * Idempotency: CasePayment.stripePaymentIntentId is uniquely indexed.
 * If a row already exists for this PI we no-op (handles webhook retries
 * and races with the synchronous "verify-after-confirm" path the UI may
 * also exercise).
 */
async function onPaymentIntentSucceeded(event: StripeEvent): Promise<void> {
  const pi = event.data.object as StripePaymentIntent;
  const meta = pi.metadata ?? {};
  const tenantId = meta.tenantId;
  const caseId = meta.caseId;
  if (!tenantId || !caseId) {
    logger.warn({ piId: pi.id }, 'payment_intent.succeeded missing tenantId/caseId metadata');
    return;
  }

  const existing = await prisma.casePayment.findUnique({
    where: { stripePaymentIntentId: pi.id },
  });
  if (existing) {
    logger.info({ piId: pi.id, existingId: existing.id }, 'payment intent already recorded');
    return;
  }

  // Verify case + invoice still match the metadata. A void invoice should
  // surface in logs but still record the payment as case credit (the money
  // arrived; voiding the invoice doesn't make it disappear).
  const c = await prisma.case.findFirst({
    where: { id: caseId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!c) {
    logger.warn({ piId: pi.id, tenantId, caseId }, 'payment_intent.succeeded for unknown case');
    return;
  }

  let invoiceId: string | null = null;
  if (meta.invoiceId) {
    const inv = await prisma.caseInvoice.findFirst({
      where: { id: meta.invoiceId, tenantId, caseId, status: { not: 'VOID' } },
      select: { id: true },
    });
    invoiceId = inv?.id ?? null;
    if (!inv) {
      logger.warn(
        { piId: pi.id, invoiceId: meta.invoiceId },
        'payment_intent.succeeded for missing/voided invoice — recording as case credit',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const payment = await tx.casePayment.create({
      data: {
        tenantId,
        caseId,
        invoiceId,
        amountCents: pi.amount_received ?? pi.amount,
        currency: pi.currency.toUpperCase(),
        method: 'stripe',
        status: 'COMPLETED',
        stripePaymentIntentId: pi.id,
        note: pi.description ?? null,
        // recordedById is null for webhook-driven rows: no human actor.
        // The audit row below carries the PI id for forensics.
        recordedById: null,
      },
    });
    await refreshInvoiceStatuses(tx, caseId);
    const finances = await recomputeCaseFinances(tx, caseId);
    await tx.auditLog.create({
      data: {
        tenantId,
        // SYSTEM actor — Stripe webhook, no human in the loop.
        actorId: '00000000-0000-0000-0000-000000000000',
        actorType: 'SYSTEM',
        action: 'casePayment.stripeWebhook',
        targetType: 'CasePayment',
        targetId: payment.id,
        payload: {
          piId: pi.id,
          caseId,
          invoiceId,
          amountCents: payment.amountCents,
          currency: payment.currency,
          feesCleared: finances.feesCleared,
        },
      },
    });
  });
}

/**
 * payment_intent.payment_failed — log only. The PaymentElement on the
 * portal will surface the error inline; we don't insert any row so the
 * client can retry cleanly.
 */
async function onPaymentIntentFailed(event: StripeEvent): Promise<void> {
  const pi = event.data.object as StripePaymentIntent;
  logger.warn(
    {
      piId: pi.id,
      tenantId: pi.metadata?.tenantId,
      caseId: pi.metadata?.caseId,
      invoiceId: pi.metadata?.invoiceId,
      reason: pi.last_payment_error?.message,
    },
    'payment_intent.payment_failed',
  );
}
