/**
 * Phase 7.1 — Case finances helper.
 *
 * The CasePayment table is the source of truth for money received on a
 * case. Case.amountPaidCents and Case.feesCleared are derived caches we
 * maintain from the ledger after every change (payment record, refund,
 * void, invoice mutation that changes the target).
 *
 * Why a cache: the lawyer-approval gate, list views, and reviewReadiness
 * all key off feesCleared; recomputing on every read would be wasteful.
 *
 * Hard rule (per docs/01-domain.md): "All fees must be cleared before
 * file submission to IRCC." feesCleared compares the live ledger sum to
 * totalFeeCents (or retainerFeeCents if total is null) — only fully
 * COMPLETED payment amounts net of refunds count.
 */
import type { PrismaClient, Prisma } from '@onsecboad/db';
import { invalidateInvoicePdf } from './invoice-pdf-store.js';

type Tx = PrismaClient | Prisma.TransactionClient;

export async function recomputeCaseFinances(
  tx: Tx,
  caseId: string,
): Promise<{ amountPaidCents: number; feesCleared: boolean }> {
  // Sum live (non-VOIDED) payments minus their accumulated refunds.
  const payments = await tx.casePayment.findMany({
    where: { caseId, status: { in: ['COMPLETED', 'PARTIAL_REFUND', 'REFUNDED'] } },
    select: { amountCents: true, refundedCents: true },
  });
  const amountPaidCents = payments.reduce(
    (sum, p) => sum + p.amountCents - p.refundedCents,
    0,
  );
  const c = await tx.case.findUnique({
    where: { id: caseId },
    select: { totalFeeCents: true, retainerFeeCents: true },
  });
  if (!c) return { amountPaidCents, feesCleared: false };
  const target = c.totalFeeCents ?? c.retainerFeeCents ?? null;
  const feesCleared = target != null && amountPaidCents >= target;
  await tx.case.update({
    where: { id: caseId },
    data: { amountPaidCents, feesCleared },
  });
  return { amountPaidCents, feesCleared };
}

/**
 * Allocate a free-form amount to invoices on a case. Used when a payment
 * lands on the case without a specific invoiceId — the oldest unpaid
 * invoice gets paid first (FIFO by issueDate). Updates each invoice's
 * status (DRAFT/SENT → PARTIAL → PAID) but does NOT mutate item rows.
 *
 * Returns the per-invoice allocations applied so the caller can audit-log
 * them. Invoices in VOID state are skipped.
 */
export async function allocateUnattachedPayment(
  tx: Tx,
  caseId: string,
  paymentId: string,
  remainingCents: number,
): Promise<Array<{ invoiceId: string; appliedCents: number }>> {
  const invoices = await tx.caseInvoice.findMany({
    where: { caseId, status: { in: ['DRAFT', 'SENT', 'PARTIAL'] } },
    orderBy: { issueDate: 'asc' },
    include: { payments: { select: { amountCents: true, refundedCents: true, status: true } } },
  });
  const allocations: Array<{ invoiceId: string; appliedCents: number }> = [];
  let remaining = remainingCents;
  for (const inv of invoices) {
    if (remaining <= 0) break;
    const paidOnInvoice = inv.payments
      .filter((p) => p.status !== 'VOIDED')
      .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
    const owed = inv.totalCents - paidOnInvoice;
    if (owed <= 0) continue;
    const apply = Math.min(owed, remaining);
    allocations.push({ invoiceId: inv.id, appliedCents: apply });
    remaining -= apply;
  }
  if (allocations.length === 0) return [];
  // The first allocation gets the actual FK; further allocations create
  // child rows split off the original. Simpler model: only the first
  // gets its invoiceId updated. Multi-invoice allocation is a stretch
  // feature — for now we attach to the first matched invoice and leave
  // the rest as case-level credit.
  const first = allocations[0]!;
  await tx.casePayment.update({
    where: { id: paymentId },
    data: { invoiceId: first.invoiceId },
  });
  return allocations;
}

/**
 * After any payment / refund / invoice change touched a case, refresh
 * each affected invoice's status flag. Pure derived-state computation.
 */
export async function refreshInvoiceStatuses(
  tx: Tx,
  caseId: string,
): Promise<void> {
  const invoices = await tx.caseInvoice.findMany({
    where: { caseId, status: { not: 'VOID' } },
    include: { payments: { select: { amountCents: true, refundedCents: true, status: true } } },
  });
  for (const inv of invoices) {
    const paid = inv.payments
      .filter((p) => p.status !== 'VOIDED')
      .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
    let next: 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID';
    if (inv.status === 'DRAFT' && paid === 0) next = 'DRAFT';
    else if (paid >= inv.totalCents && inv.totalCents > 0) next = 'PAID';
    else if (paid > 0) next = 'PARTIAL';
    else next = inv.status === 'DRAFT' ? 'DRAFT' : 'SENT';
    if (next !== inv.status) {
      await tx.caseInvoice.update({
        where: { id: inv.id },
        data: {
          status: next,
          paidAt: next === 'PAID' && !inv.paidAt ? new Date() : inv.paidAt,
        },
      });
      // Status change → cached PDF is stale (PAID stamp / status badge).
      await invalidateInvoicePdf(tx, inv.id);
    }
  }
}

/**
 * Compute a single invoice's totals from its items. Per-item formula:
 *   amount = round(qty * unit * (1 + taxRateBp / 10000))
 *   subtotal = sum(qty * unit)
 *   tax      = sum(amount) - subtotal
 *   total    = sum(amount)
 *
 * Caller is responsible for passing item rows in their final state.
 */
export function computeInvoiceTotals(
  items: Array<{ quantity: number; unitPriceCents: number; taxRateBp: number; amountCents: number }>,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  let subtotal = 0;
  let total = 0;
  for (const it of items) {
    subtotal += it.quantity * it.unitPriceCents;
    total += it.amountCents;
  }
  return { subtotalCents: subtotal, taxCents: total - subtotal, totalCents: total };
}

export function lineAmountCents(
  quantity: number,
  unitPriceCents: number,
  taxRateBp: number,
): number {
  const pre = quantity * unitPriceCents;
  return Math.round(pre * (1 + taxRateBp / 10_000));
}

/**
 * Allocate the next sequential invoice number for a tenant.
 * Format: INV-{YYYY}-{seq:5} where seq is per-tenant per-year.
 *
 * Race-safe-ish: relies on the tenantId+number unique constraint to
 * detect collisions; on conflict the caller retries one bump up. For
 * the tenant scale we expect (low hundreds of invoices/yr/firm), this
 * is fine. If we ever see real contention, swap for a sequence table.
 */
export async function nextInvoiceNumber(tx: Tx, tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await tx.caseInvoice.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const lastSeq = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;
}
