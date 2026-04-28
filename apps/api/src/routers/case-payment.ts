/**
 * Case payment ledger — Phase 7.1.
 *
 * Source of truth for "money received on a case." Each row is one
 * transaction: cash, cheque, etransfer, wire, manual card entry, or
 * (Phase 7.2) Stripe-driven. Refunds bump refundedCents and flip
 * status to PARTIAL_REFUND / REFUNDED.
 *
 * Mutations always run inside a transaction that also recomputes the
 * Case.amountPaidCents + feesCleared cache and the touched invoice's
 * status flag. This keeps the lawyer-approval gate in lockstep with
 * the ledger.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import {
  recomputeCaseFinances,
  refreshInvoiceStatuses,
} from '../lib/case-finances.js';

const METHOD = ['card', 'cash', 'etransfer', 'cheque', 'wire', 'stripe'] as const;

function caseScopeWhere(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
}): Prisma.CasePaymentWhereInput {
  const base: Prisma.CasePaymentWhereInput = { tenantId: ctx.tenantId };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch')
    return { ...base, case: { branchId: ctx.perms.branchId ?? '__none__' } };
  return {
    ...base,
    case: {
      OR: [{ lawyerId: ctx.perms.userId }, { filerId: ctx.perms.userId }],
    },
  };
}

export const casePaymentRouter = router({
  list: requirePermission('invoices', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.casePayment.findMany({
        where: { ...caseScopeWhere(ctx), caseId: input.caseId },
        orderBy: { receivedAt: 'desc' },
        include: {
          invoice: { select: { id: true, number: true, status: true } },
        },
      });
    }),

  record: requirePermission('invoices', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        invoiceId: z.string().uuid().nullable().optional(),
        amountCents: z.number().int().min(1).max(1_000_000_00),
        method: z.enum(METHOD),
        reference: z.string().max(120).optional(),
        note: z.string().max(500).optional(),
        receivedAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Re-verify scope through case lookup; CaseInvoice scope already
      // enforced on the invoice side by createCaseScopeWhere upstream,
      // but list() goes through its own filter so the case-side check
      // covers payments that aren't tied to an invoice.
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, branchId: true, lawyerId: true, filerId: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      if (
        ctx.scope !== 'tenant' &&
        ctx.scope !== 'branch' &&
        c.lawyerId !== ctx.perms.userId &&
        c.filerId !== ctx.perms.userId
      ) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      if (ctx.scope === 'branch' && c.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // If invoiceId provided, ensure it belongs to this case + tenant
      // and isn't VOID. Prevents posting against a voided invoice.
      if (input.invoiceId) {
        const inv = await ctx.prisma.caseInvoice.findFirst({
          where: {
            id: input.invoiceId,
            tenantId: ctx.tenantId,
            caseId: input.caseId,
          },
          select: { status: true },
        });
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found.' });
        if (inv.status === 'VOID') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot post payment against a voided invoice.',
          });
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        const payment = await tx.casePayment.create({
          data: {
            tenantId: ctx.tenantId,
            caseId: input.caseId,
            invoiceId: input.invoiceId ?? null,
            amountCents: input.amountCents,
            method: input.method,
            status: 'COMPLETED',
            reference: input.reference,
            note: input.note,
            receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
            recordedById: ctx.session.sub,
          },
        });
        await refreshInvoiceStatuses(tx, input.caseId);
        const finances = await recomputeCaseFinances(tx, input.caseId);
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'casePayment.record',
            targetType: 'CasePayment',
            targetId: payment.id,
            payload: {
              caseId: input.caseId,
              invoiceId: input.invoiceId ?? null,
              amountCents: input.amountCents,
              method: input.method,
              feesCleared: finances.feesCleared,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return { payment, ...finances };
      });
    }),

  refund: requirePermission('invoices', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        amountCents: z.number().int().min(1).max(1_000_000_00),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.casePayment.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
      });
      if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
      if (p.status === 'VOIDED' || p.status === 'REFUNDED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot refund a payment in ${p.status} state.`,
        });
      }
      const newRefunded = p.refundedCents + input.amountCents;
      if (newRefunded > p.amountCents) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Refund would exceed payment amount.',
        });
      }
      const status = newRefunded === p.amountCents ? 'REFUNDED' : 'PARTIAL_REFUND';

      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.casePayment.update({
          where: { id: p.id },
          data: { refundedCents: newRefunded, status },
        });
        await refreshInvoiceStatuses(tx, p.caseId);
        const finances = await recomputeCaseFinances(tx, p.caseId);
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'casePayment.refund',
            targetType: 'CasePayment',
            targetId: p.id,
            payload: {
              amountCents: input.amountCents,
              totalRefunded: newRefunded,
              reason: input.reason ?? null,
              feesCleared: finances.feesCleared,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return { payment: updated, ...finances };
      });
    }),

  // Mark a recorded payment as VOIDED — used when a cheque bounces,
  // an etransfer is reversed, etc. Does NOT touch refundedCents; voided
  // payments are simply excluded from the live ledger sum.
  void: requirePermission('invoices', 'write')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(2).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const p = await ctx.prisma.casePayment.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
      });
      if (!p) throw new TRPCError({ code: 'NOT_FOUND' });
      if (p.status === 'VOIDED') return { payment: p };

      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.casePayment.update({
          where: { id: p.id },
          data: { status: 'VOIDED', note: `${p.note ?? ''}\nVoided: ${input.reason}`.trim() },
        });
        await refreshInvoiceStatuses(tx, p.caseId);
        const finances = await recomputeCaseFinances(tx, p.caseId);
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'casePayment.void',
            targetType: 'CasePayment',
            targetId: p.id,
            payload: { reason: input.reason, feesCleared: finances.feesCleared },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return { payment: updated, ...finances };
      });
    }),
});
