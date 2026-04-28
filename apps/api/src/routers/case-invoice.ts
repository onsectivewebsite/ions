/**
 * Case invoicing — Phase 7.1.
 *
 * One CaseInvoice belongs to one Case; line items are tax-aware. Status
 * machine: DRAFT (mutable) → SENT (frozen lines, payable) → PARTIAL →
 * PAID. Any non-PAID can become VOID. Money totals are recomputed on
 * the server from the persisted item rows — clients can't push their
 * own subtotals.
 *
 * Scope: invoices inherit the case's RBAC. We re-use the same scope
 * filter the case router uses so a branch manager only sees their own
 * branch's invoices, an assigned lawyer/filer only sees invoices on
 * cases assigned to them.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import {
  computeInvoiceTotals,
  lineAmountCents,
  nextInvoiceNumber,
  recomputeCaseFinances,
  refreshInvoiceStatuses,
} from '../lib/case-finances.js';
import {
  getInvoicePdfSignedUrl,
  invalidateInvoicePdf,
} from '../lib/invoice-pdf-store.js';

function caseScopeWhere(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
}): Prisma.CaseInvoiceWhereInput {
  const base: Prisma.CaseInvoiceWhereInput = { tenantId: ctx.tenantId };
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

const itemInput = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).max(10_000).default(1),
  unitPriceCents: z.number().int().min(0).max(100_000_00),
  taxRateBp: z.number().int().min(0).max(10_000).default(0),
});

export const caseInvoiceRouter = router({
  list: requirePermission('invoices', 'read')
    .input(
      z
        .object({
          caseId: z.string().uuid().optional(),
          status: z.enum(['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'VOID']).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.CaseInvoiceWhereInput = {
        ...caseScopeWhere(ctx),
        ...(input.caseId ? { caseId: input.caseId } : {}),
        ...(input.status ? { status: input.status } : {}),
      };
      return ctx.prisma.caseInvoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { number: 'desc' }],
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          payments: { orderBy: { receivedAt: 'desc' } },
          case: {
            select: {
              id: true,
              caseType: true,
              status: true,
              client: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
          },
        },
      });
    }),

  get: requirePermission('invoices', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        include: {
          items: { orderBy: { sortOrder: 'asc' } },
          payments: { orderBy: { receivedAt: 'desc' } },
          case: {
            select: {
              id: true,
              caseType: true,
              status: true,
              client: { select: { id: true, firstName: true, lastName: true, phone: true } },
            },
          },
        },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      return inv;
    }),

  create: requirePermission('invoices', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        currency: z.string().length(3).default('CAD'),
        issueDate: z.string().datetime().optional(),
        dueDate: z.string().datetime().optional(),
        notes: z.string().max(2000).optional(),
        items: z.array(itemInput).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve case + verify scope
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

      const itemRows = input.items.map((it, idx) => ({
        ...it,
        amountCents: lineAmountCents(it.quantity, it.unitPriceCents, it.taxRateBp),
        sortOrder: idx,
      }));
      const totals = computeInvoiceTotals(itemRows);

      const invoice = await ctx.prisma.$transaction(async (tx) => {
        // Allocate next number; retry once on collision in the rare race.
        let number = await nextInvoiceNumber(tx, ctx.tenantId);
        let inv;
        try {
          inv = await tx.caseInvoice.create({
            data: {
              tenantId: ctx.tenantId,
              caseId: c.id,
              branchId: c.branchId,
              number,
              status: 'DRAFT',
              currency: input.currency,
              issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              notes: input.notes ?? null,
              subtotalCents: totals.subtotalCents,
              taxCents: totals.taxCents,
              totalCents: totals.totalCents,
              createdById: ctx.session.sub,
              items: {
                create: itemRows.map((r) => ({
                  tenantId: ctx.tenantId,
                  description: r.description,
                  quantity: r.quantity,
                  unitPriceCents: r.unitPriceCents,
                  taxRateBp: r.taxRateBp,
                  amountCents: r.amountCents,
                  sortOrder: r.sortOrder,
                })),
              },
            },
            include: { items: true },
          });
        } catch (e) {
          if (e && typeof e === 'object' && 'code' in e && (e as { code: unknown }).code === 'P2002') {
            number = await nextInvoiceNumber(tx, ctx.tenantId);
            inv = await tx.caseInvoice.create({
              data: {
                tenantId: ctx.tenantId,
                caseId: c.id,
                branchId: c.branchId,
                number,
                status: 'DRAFT',
                currency: input.currency,
                issueDate: input.issueDate ? new Date(input.issueDate) : new Date(),
                dueDate: input.dueDate ? new Date(input.dueDate) : null,
                notes: input.notes ?? null,
                subtotalCents: totals.subtotalCents,
                taxCents: totals.taxCents,
                totalCents: totals.totalCents,
                createdById: ctx.session.sub,
                items: {
                  create: itemRows.map((r) => ({
                    tenantId: ctx.tenantId,
                    description: r.description,
                    quantity: r.quantity,
                    unitPriceCents: r.unitPriceCents,
                    taxRateBp: r.taxRateBp,
                    amountCents: r.amountCents,
                    sortOrder: r.sortOrder,
                  })),
                },
              },
              include: { items: true },
            });
          } else throw e;
        }
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'caseInvoice.create',
            targetType: 'CaseInvoice',
            targetId: inv.id,
            payload: { number: inv.number, totalCents: totals.totalCents, lineCount: itemRows.length },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return inv;
      });
      return invoice;
    }),

  // Replace the whole item list on a DRAFT invoice. Rejected when the
  // invoice has been SENT — at that point the lines are frozen.
  update: requirePermission('invoices', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        items: z.array(itemInput).min(1).max(50).optional(),
        notes: z.string().max(2000).nullable().optional(),
        dueDate: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        select: { id: true, status: true },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.items && inv.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit line items after the invoice is sent. Void and re-issue instead.',
        });
      }

      const itemRows = input.items?.map((it, idx) => ({
        ...it,
        amountCents: lineAmountCents(it.quantity, it.unitPriceCents, it.taxRateBp),
        sortOrder: idx,
      }));

      return ctx.prisma.$transaction(async (tx) => {
        if (itemRows) {
          await tx.caseInvoiceItem.deleteMany({ where: { invoiceId: inv.id } });
          await tx.caseInvoiceItem.createMany({
            data: itemRows.map((r) => ({
              tenantId: ctx.tenantId,
              invoiceId: inv.id,
              description: r.description,
              quantity: r.quantity,
              unitPriceCents: r.unitPriceCents,
              taxRateBp: r.taxRateBp,
              amountCents: r.amountCents,
              sortOrder: r.sortOrder,
            })),
          });
        }
        const totals = itemRows ? computeInvoiceTotals(itemRows) : null;
        const updated = await tx.caseInvoice.update({
          where: { id: inv.id },
          data: {
            ...(totals
              ? {
                  subtotalCents: totals.subtotalCents,
                  taxCents: totals.taxCents,
                  totalCents: totals.totalCents,
                }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.dueDate !== undefined
              ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
              : {}),
          },
          include: { items: { orderBy: { sortOrder: 'asc' } }, payments: true },
        });
        // Stash + R2-cached PDF is stale.
        await invalidateInvoicePdf(tx, inv.id);
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'caseInvoice.update',
            targetType: 'CaseInvoice',
            targetId: inv.id,
            payload: { changedItems: !!itemRows },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return updated;
      });
    }),

  send: requirePermission('invoices', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        select: { id: true, status: true, totalCents: true },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Only DRAFT invoices can be sent (currently ${inv.status}).`,
        });
      }
      if (inv.totalCents <= 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invoice total must be > 0.' });
      }
      const updated = await ctx.prisma.caseInvoice.update({
        where: { id: inv.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'caseInvoice.send',
          targetType: 'CaseInvoice',
          targetId: inv.id,
          payload: {},
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  void: requirePermission('invoices', 'write')
    .input(z.object({ id: z.string().uuid(), reason: z.string().min(2).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        select: { id: true, status: true, caseId: true, payments: { select: { id: true } } },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv.status === 'VOID') return inv;
      if (inv.payments.length > 0 && inv.status === 'PAID') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Refund all payments before voiding a paid invoice.',
        });
      }
      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.caseInvoice.update({
          where: { id: inv.id },
          data: { status: 'VOID', voidedAt: new Date(), voidReason: input.reason },
        });
        // Detach any payments referencing this invoice — credit stays on
        // the case, no longer tied to this voided invoice.
        await tx.casePayment.updateMany({
          where: { invoiceId: inv.id },
          data: { invoiceId: null },
        });
        await invalidateInvoicePdf(tx, inv.id);
        await refreshInvoiceStatuses(tx, inv.caseId);
        await recomputeCaseFinances(tx, inv.caseId);
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'caseInvoice.void',
            targetType: 'CaseInvoice',
            targetId: inv.id,
            payload: { reason: input.reason },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return updated;
      });
    }),

  // Permanently drop a DRAFT invoice that hasn't been sent. Sent / paid
  // invoices must be voided (audit-preserving) instead.
  delete: requirePermission('invoices', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        select: { id: true, status: true, caseId: true },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only DRAFT invoices can be deleted. Use Void for sent invoices.',
        });
      }
      await ctx.prisma.$transaction(async (tx) => {
        // CaseInvoiceItem cascade-deletes via the FK
        await tx.caseInvoice.delete({ where: { id: inv.id } });
        await tx.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'caseInvoice.delete',
            targetType: 'CaseInvoice',
            targetId: inv.id,
            payload: {},
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
      });
      return { ok: true };
    }),

  // 1-hour signed URL for the rendered PDF. Lazy-renders on first
  // request, then re-uses the R2 object until something invalidates
  // the cache.
  pdfUrl: requirePermission('invoices', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inv = await ctx.prisma.caseInvoice.findFirst({
        where: { id: input.id, ...caseScopeWhere(ctx) },
        select: { id: true, status: true },
      });
      if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
      if (inv.status === 'VOID') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot download a voided invoice.' });
      }
      const url = await getInvoicePdfSignedUrl(ctx.prisma, inv.id);
      return { url };
    }),
});
