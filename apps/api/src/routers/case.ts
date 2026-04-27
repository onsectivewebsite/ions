/**
 * Case router. Phase 5.1.
 *
 * Workflow (state machine):
 *   PENDING_RETAINER → PENDING_RETAINER_SIGNATURE → PENDING_DOCUMENTS →
 *   PREPARING → PENDING_LAWYER_APPROVAL → SUBMITTED_TO_IRCC → IN_REVIEW →
 *   COMPLETED.    Terminal exits: WITHDRAWN, ABANDONED.
 *
 * Hard rules (server-enforced, see invariants in CLAUDE.md):
 *   - feesCleared must be true before SUBMITTED_TO_IRCC.
 *   - Only the assigned lawyer or a firm admin can transition past
 *     PENDING_LAWYER_APPROVAL.
 *   - Soft-delete only — Cases are never hard-deleted; closeReason is
 *     captured on WITHDRAWN/ABANDONED.
 *
 * RBAC: gated on `cases.*`. branch scope filters by branchId; assigned
 * scope (LAWYER/CONSULTANT/FILER/CASE_MANAGER default) filters to cases
 * where the user is lawyerId or filerId.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { logger } from '../logger.js';
import { publishEvent } from '../lib/realtime.js';
import { ensureRetainerAgreement } from './retainer.js';

const STATUS = [
  'PENDING_RETAINER',
  'PENDING_RETAINER_SIGNATURE',
  'PENDING_DOCUMENTS',
  'PREPARING',
  'PENDING_LAWYER_APPROVAL',
  'SUBMITTED_TO_IRCC',
  'IN_REVIEW',
  'COMPLETED',
  'WITHDRAWN',
  'ABANDONED',
] as const;
type CaseStatus = (typeof STATUS)[number];

// Allowed forward transitions. Any non-terminal can move to WITHDRAWN/
// ABANDONED with a reason.
const NEXT: Record<CaseStatus, CaseStatus[]> = {
  PENDING_RETAINER: ['PENDING_RETAINER_SIGNATURE', 'PENDING_DOCUMENTS'],
  PENDING_RETAINER_SIGNATURE: ['PENDING_DOCUMENTS'],
  PENDING_DOCUMENTS: ['PREPARING', 'PENDING_LAWYER_APPROVAL'],
  PREPARING: ['PENDING_LAWYER_APPROVAL'],
  PENDING_LAWYER_APPROVAL: ['PREPARING', 'SUBMITTED_TO_IRCC'],
  SUBMITTED_TO_IRCC: ['IN_REVIEW', 'COMPLETED'],
  IN_REVIEW: ['COMPLETED'],
  COMPLETED: [],
  WITHDRAWN: [],
  ABANDONED: [],
};

const TERMINAL: CaseStatus[] = ['COMPLETED', 'WITHDRAWN', 'ABANDONED'];

function ensureCanTransition(from: CaseStatus, to: CaseStatus): void {
  if (to === 'WITHDRAWN' || to === 'ABANDONED') {
    if (TERMINAL.includes(from)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Already ${from}.` });
    }
    return;
  }
  if (!NEXT[from].includes(to)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Cannot move case from ${from} to ${to}.`,
    });
  }
}

// where-fragment honouring user's cases.read scope.
function caseReadWhere(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
}): Prisma.CaseWhereInput {
  const base: Prisma.CaseWhereInput = { tenantId: ctx.tenantId, deletedAt: null };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch')
    return { ...base, branchId: ctx.perms.branchId ?? '__none__' };
  // 'assigned' / 'case' / 'own' — case is mine if I'm lawyer or filer.
  return {
    ...base,
    OR: [{ lawyerId: ctx.perms.userId }, { filerId: ctx.perms.userId }],
  };
}

export const caseRouter = router({
  list: requirePermission('cases', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          status: z.enum(STATUS).optional(),
          caseType: z.string().optional(),
          q: z.string().optional(),
          branchId: z.string().uuid().optional(),
          lawyerId: z.string().uuid().optional(),
          filerId: z.string().uuid().optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.CaseWhereInput = {
        ...caseReadWhere(ctx),
        ...(input.status ? { status: input.status } : {}),
        ...(input.caseType ? { caseType: input.caseType } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.lawyerId ? { lawyerId: input.lawyerId } : {}),
        ...(input.filerId ? { filerId: input.filerId } : {}),
        ...(input.q
          ? {
              client: {
                is: {
                  OR: [
                    { firstName: { contains: input.q, mode: 'insensitive' as const } },
                    { lastName: { contains: input.q, mode: 'insensitive' as const } },
                    { phone: { contains: input.q } },
                    { email: { contains: input.q, mode: 'insensitive' as const } },
                  ],
                },
              },
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.case.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          take: 20,
          skip: (input.page - 1) * 20,
          include: {
            client: { select: { id: true, firstName: true, lastName: true, phone: true } },
            lawyer: { select: { id: true, name: true } },
            filer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        ctx.prisma.case.count({ where }),
      ]);
      return { items, total };
    }),

  get: requirePermission('cases', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
        include: {
          client: true,
          lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
          lawyer: { select: { id: true, name: true, email: true } },
          filer: { select: { id: true, name: true, email: true } },
          branch: { select: { id: true, name: true } },
        },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return c;
    }),

  // Manual create — most cases come from the appointment.recordOutcome
  // RETAINER auto-bridge below; this lets admins backfill or create cases
  // outside the consult flow (referred client, walk-in retainer, etc).
  create: requirePermission('cases', 'write')
    .input(
      z.object({
        clientId: z.string().uuid(),
        leadId: z.string().uuid().optional(),
        appointmentId: z.string().uuid().optional(),
        caseType: z.string().min(1).max(60),
        lawyerId: z.string().uuid(),
        filerId: z.string().uuid().nullable().optional(),
        branchId: z.string().uuid().nullable().optional(),
        retainerFeeCents: z.number().int().min(0).max(100_000_00).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      const lawyer = await ctx.prisma.user.findFirst({
        where: { id: input.lawyerId, tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
      });
      if (!lawyer)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lawyer not in firm or not active' });
      if (input.filerId) {
        const filer = await ctx.prisma.user.findFirst({
          where: { id: input.filerId, tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
        });
        if (!filer)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Filer not in firm or not active' });
      }
      const c = await ctx.prisma.case.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: input.branchId ?? client.branchId,
          clientId: input.clientId,
          leadId: input.leadId,
          appointmentId: input.appointmentId,
          caseType: input.caseType,
          lawyerId: input.lawyerId,
          filerId: input.filerId,
          retainerFeeCents: input.retainerFeeCents,
          status: 'PENDING_RETAINER',
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.create',
          targetType: 'Case',
          targetId: c.id,
          payload: {
            clientId: input.clientId,
            caseType: input.caseType,
            lawyerId: input.lawyerId,
            origin: 'manual',
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return c;
    }),

  transition: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.enum(STATUS),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      ensureCanTransition(c.status as CaseStatus, input.to);

      // Hard rule: feesCleared required before SUBMITTED_TO_IRCC.
      if (input.to === 'SUBMITTED_TO_IRCC' && !c.feesCleared) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'All fees must be cleared before submitting to IRCC.',
        });
      }
      // Only the lawyer (or firm admin via tenant scope) can move past
      // PENDING_LAWYER_APPROVAL — they're attesting the file is correct.
      if (
        (input.to === 'SUBMITTED_TO_IRCC' || input.to === 'PREPARING') &&
        c.status === 'PENDING_LAWYER_APPROVAL' &&
        ctx.scope !== 'tenant' &&
        c.lawyerId !== ctx.perms.userId
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned lawyer can move past lawyer approval.',
        });
      }
      if ((input.to === 'WITHDRAWN' || input.to === 'ABANDONED') && !input.reason) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reason required.' });
      }

      const now = new Date();
      const data: Prisma.CaseUpdateInput = { status: input.to };
      if (input.to === 'PENDING_RETAINER_SIGNATURE') data.retainerApprovedAt = now;
      if (input.to === 'PENDING_DOCUMENTS') data.retainerSignedAt = now;
      if (input.to === 'PENDING_LAWYER_APPROVAL') data.documentsLockedAt = now;
      if (input.to === 'SUBMITTED_TO_IRCC') {
        data.lawyerApprovedAt = now;
        data.submittedToIrccAt = now;
      }
      if (input.to === 'COMPLETED') data.completedAt = now;
      if (input.to === 'WITHDRAWN' || input.to === 'ABANDONED') {
        data.completedAt = now;
        data.closedReason = input.reason;
      }

      const updated = await ctx.prisma.case.update({
        where: { id: c.id },
        data,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.transition',
          targetType: 'Case',
          targetId: c.id,
          payload: { from: c.status, to: input.to, reason: input.reason ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      // Tenant-wide so the lawyer, filer, and admin views all refresh.
      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: input.to },
      );
      return updated;
    }),

  assign: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        lawyerId: z.string().uuid().optional(),
        filerId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.CaseUpdateInput = {};
      if (input.lawyerId) {
        const u = await ctx.prisma.user.findFirst({
          where: { id: input.lawyerId, tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
        });
        if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lawyer not in firm' });
        data.lawyer = { connect: { id: input.lawyerId } };
      }
      if (input.filerId !== undefined) {
        if (input.filerId === null) {
          data.filer = { disconnect: true };
        } else {
          const u = await ctx.prisma.user.findFirst({
            where: {
              id: input.filerId,
              tenantId: ctx.tenantId,
              deletedAt: null,
              status: 'ACTIVE',
            },
          });
          if (!u) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Filer not in firm' });
          data.filer = { connect: { id: input.filerId } };
        }
      }
      const updated = await ctx.prisma.case.update({ where: { id: c.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.assign',
          targetType: 'Case',
          targetId: c.id,
          payload: {
            from: { lawyerId: c.lawyerId, filerId: c.filerId },
            to: { lawyerId: input.lawyerId, filerId: input.filerId },
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  update: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        retainerFeeCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
        totalFeeCents: z.number().int().min(0).max(1_000_000_00).nullable().optional(),
        usiNumber: z.string().max(80).nullable().optional(),
        irccFileNumber: z.string().max(80).nullable().optional(),
        irccPortalDate: z.string().datetime().nullable().optional(),
        irccDecision: z.string().max(40).nullable().optional(),
        notes: z.string().max(8000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.CaseUpdateInput = {};
      if (input.retainerFeeCents !== undefined) data.retainerFeeCents = input.retainerFeeCents;
      if (input.totalFeeCents !== undefined) data.totalFeeCents = input.totalFeeCents;
      if (input.usiNumber !== undefined) data.usiNumber = input.usiNumber;
      if (input.irccFileNumber !== undefined) data.irccFileNumber = input.irccFileNumber;
      if (input.irccPortalDate !== undefined)
        data.irccPortalDate = input.irccPortalDate ? new Date(input.irccPortalDate) : null;
      if (input.irccDecision !== undefined) data.irccDecision = input.irccDecision;
      if (input.notes !== undefined) data.notes = input.notes;
      // Recalculate feesCleared if the targets changed.
      if (input.retainerFeeCents !== undefined || input.totalFeeCents !== undefined) {
        const target = input.totalFeeCents ?? c.totalFeeCents ?? input.retainerFeeCents ?? c.retainerFeeCents;
        if (target != null) data.feesCleared = c.amountPaidCents >= target;
      }
      const updated = await ctx.prisma.case.update({ where: { id: c.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.update',
          targetType: 'Case',
          targetId: c.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  recordPayment: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        amountCents: z.number().int().min(1).max(1_000_000_00),
        method: z.enum(['card', 'cash', 'etransfer', 'cheque', 'invoice']),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const newPaid = c.amountPaidCents + input.amountCents;
      const target = c.totalFeeCents ?? c.retainerFeeCents ?? null;
      const cleared = target != null && newPaid >= target;
      const updated = await ctx.prisma.case.update({
        where: { id: c.id },
        data: {
          amountPaidCents: newPaid,
          feesCleared: cleared,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.payment',
          targetType: 'Case',
          targetId: c.id,
          payload: {
            amountCents: input.amountCents,
            method: input.method,
            note: input.note ?? null,
            newTotalPaid: newPaid,
            cleared,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  // Pre-flight checks the lawyer sees before the Approve button. Returns
  // a structured readiness payload so the UI can show ✓ / ✗ per gate
  // without re-querying scattered procedures.
  reviewReadiness: requirePermission('cases', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const retainer = await ctx.prisma.retainerAgreement.findUnique({
        where: { caseId: c.id },
      });
      const collection = await ctx.prisma.documentCollection.findUnique({
        where: { caseId: c.id },
      });
      const uploads = collection
        ? await ctx.prisma.documentUpload.findMany({
            where: { collectionId: collection.id, supersededAt: null },
            select: { itemKey: true },
          })
        : [];
      const items = (collection?.itemsJson ?? []) as unknown as Array<{
        key: string;
        label: string;
        required?: boolean;
      }>;
      const uploadedKeys = new Set(uploads.map((u) => u.itemKey));
      const missingRequired = items
        .filter((it) => it.required && !uploadedKeys.has(it.key))
        .map((it) => ({ key: it.key, label: it.label }));
      const target = c.totalFeeCents ?? c.retainerFeeCents ?? null;

      return {
        retainerSigned: retainer?.status === 'SIGNED',
        feesCleared: c.feesCleared,
        feesTarget: target,
        feesPaid: c.amountPaidCents,
        documentsLocked: collection?.status === 'LOCKED',
        documentsCollectionExists: !!collection,
        missingRequired,
        readyForApproval:
          retainer?.status === 'SIGNED' &&
          c.feesCleared &&
          collection?.status === 'LOCKED' &&
          missingRequired.length === 0,
        // Surface caller-relative permission so the UI can hide the form
        // for non-lawyer roles without a separate roundtrip.
        viewerIsAssignedLawyer: ctx.perms.userId === c.lawyerId,
      };
    }),

  /**
   * Lawyer-approves the file at PENDING_LAWYER_APPROVAL → SUBMITTED_TO_IRCC.
   * Mirrors the retainer approval pattern: typed name must match the
   * lawyer of record exactly, attestation captured (typed name + IP + UA),
   * pre-flight checks re-verified server-side (UI may be stale).
   *
   * The accompanying timestamps + a SUBMISSION IrccCorrespondence row are
   * created atomically.
   */
  lawyerApprove: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        typedName: z.string().min(2).max(200),
        attestation: z.literal(true),
        irccPortalDate: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
        include: { lawyer: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      if (c.status !== 'PENDING_LAWYER_APPROVAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Case must be PENDING_LAWYER_APPROVAL (currently ${c.status}).`,
        });
      }
      if (ctx.scope !== 'tenant' && c.lawyerId !== ctx.perms.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned lawyer can approve this file.',
        });
      }
      if (!c.feesCleared) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'All fees must be cleared before lawyer approval.',
        });
      }
      const expected = c.lawyer.name.trim().toLowerCase();
      if (input.typedName.trim().toLowerCase() !== expected) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Typed name must match the lawyer of record exactly: "${c.lawyer.name}".`,
        });
      }

      const now = new Date();
      const portalDate = input.irccPortalDate ? new Date(input.irccPortalDate) : now;
      const [updated] = await ctx.prisma.$transaction([
        ctx.prisma.case.update({
          where: { id: c.id },
          data: {
            status: 'SUBMITTED_TO_IRCC',
            lawyerApprovedAt: now,
            submittedToIrccAt: now,
            irccPortalDate: portalDate,
          },
        }),
        ctx.prisma.irccCorrespondence.create({
          data: {
            tenantId: ctx.tenantId,
            caseId: c.id,
            type: 'submission',
            occurredAt: portalDate,
            notes: `File submitted by ${c.lawyer.name}.`,
            recordedById: ctx.session.sub,
          },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'case.lawyerApprove',
            targetType: 'Case',
            targetId: c.id,
            payload: { typedName: input.typedName, irccPortalDate: portalDate.toISOString() },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);

      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: 'SUBMITTED_TO_IRCC' },
      );
      return updated;
    }),

  /**
   * Lawyer rejects the file at PENDING_LAWYER_APPROVAL, bouncing it back
   * to PREPARING with a note for the filer. The note lands in IRCC
   * correspondence as type='other' so it shows up on the case timeline.
   */
  requestRevision: requirePermission('cases', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z.string().min(2).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      if (c.status !== 'PENDING_LAWYER_APPROVAL') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Case must be PENDING_LAWYER_APPROVAL to request revisions.`,
        });
      }
      if (ctx.scope !== 'tenant' && c.lawyerId !== ctx.perms.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned lawyer can request revisions.',
        });
      }
      const [updated] = await ctx.prisma.$transaction([
        ctx.prisma.case.update({
          where: { id: c.id },
          data: { status: 'PREPARING' },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'case.requestRevision',
            targetType: 'Case',
            targetId: c.id,
            payload: { notes: input.notes },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);
      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        { type: 'case.status', caseId: c.id, status: 'PREPARING' },
      );
      return updated;
    }),

  // ─── IRCC correspondence log ───────────────────────────────────────────
  irccList: requirePermission('cases', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, ...caseReadWhere(ctx) },
        select: { id: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.prisma.irccCorrespondence.findMany({
        where: { tenantId: ctx.tenantId, caseId: c.id },
        orderBy: { occurredAt: 'desc' },
        take: 200,
      });
    }),

  irccRecord: requirePermission('cases', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        type: z.enum([
          'submission',
          'rfe_received',
          'rfe_responded',
          'biometrics_requested',
          'biometrics_completed',
          'interview_scheduled',
          'interview_completed',
          'medical_requested',
          'medical_completed',
          'decision',
          'other',
        ]),
        occurredAt: z.string().datetime(),
        notes: z.string().max(4000).optional(),
        attachmentUploadId: z.string().uuid().optional(),
        // For type='decision', also patch case.irccDecision in one shot.
        decision: z.enum(['approved', 'refused', 'withdrawn', 'returned']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, ...caseReadWhere(ctx) },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });

      const occurredAt = new Date(input.occurredAt);
      const created = await ctx.prisma.irccCorrespondence.create({
        data: {
          tenantId: ctx.tenantId,
          caseId: c.id,
          type: input.type,
          occurredAt,
          notes: input.notes,
          attachmentUploadId: input.attachmentUploadId,
          recordedById: ctx.session.sub,
        },
      });

      // type='decision' optionally patches case.irccDecision and bumps the
      // case to COMPLETED if approved/refused/withdrawn/returned.
      if (input.type === 'decision' && input.decision) {
        await ctx.prisma.case.update({
          where: { id: c.id },
          data: {
            irccDecision: input.decision,
            ...(c.status === 'IN_REVIEW' || c.status === 'SUBMITTED_TO_IRCC'
              ? { status: 'COMPLETED', completedAt: new Date() }
              : {}),
          },
        });
        void publishEvent(
          { kind: 'tenant', tenantId: ctx.tenantId },
          { type: 'case.status', caseId: c.id, status: 'COMPLETED' },
        );
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.irccRecord',
          targetType: 'IrccCorrespondence',
          targetId: created.id,
          payload: {
            caseId: c.id,
            type: input.type,
            decision: input.decision ?? null,
            attachmentUploadId: input.attachmentUploadId ?? null,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return created;
    }),

  irccDelete: requirePermission('cases', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const e = await ctx.prisma.irccCorrespondence.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!e) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.irccCorrespondence.delete({ where: { id: e.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'case.irccDelete',
          targetType: 'IrccCorrespondence',
          targetId: e.id,
          payload: { caseId: e.caseId, type: e.type },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});

/**
 * Helper used by appointment.recordOutcome when outcome=RETAINER.
 *
 * Resolves the client (from appointment.clientId or upserts from the
 * appointment's lead), then creates the Case row in PENDING_RETAINER.
 * Idempotent: if a case already exists for this appointment, returns it.
 */
export async function autoCreateCaseFromRetainer(
  prisma: typeof import('@onsecboad/db').prisma,
  args: {
    tenantId: string;
    appointmentId: string;
    actorId: string;
  },
): Promise<{ caseId: string; created: boolean }> {
  const appt = await prisma.appointment.findFirst({
    where: { id: args.appointmentId, tenantId: args.tenantId },
  });
  if (!appt) throw new Error('Appointment missing');

  // Idempotency: one case per appointment.
  const already = await prisma.case.findFirst({
    where: { tenantId: args.tenantId, appointmentId: appt.id, deletedAt: null },
  });
  if (already) return { caseId: already.id, created: false };

  // Resolve client: from appointment.clientId, OR upsert from the lead's
  // phone (mirrors clientRouter.upsertFromLead, kept inline to avoid the
  // tRPC ctx wrapper for system-driven flow).
  let clientId: string | null = appt.clientId ?? null;
  if (!clientId && appt.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: appt.leadId, tenantId: args.tenantId, deletedAt: null },
    });
    if (!lead?.phone) {
      throw new Error('Cannot create case: lead has no phone, no client linked.');
    }
    const existing = await prisma.client.findFirst({
      where: { tenantId: args.tenantId, phone: lead.phone, deletedAt: null },
    });
    if (existing) {
      clientId = existing.id;
    } else {
      const created = await prisma.client.create({
        data: {
          tenantId: args.tenantId,
          branchId: lead.branchId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          language: lead.language,
          primaryLeadId: lead.id,
        },
      });
      clientId = created.id;
    }
  }
  if (!clientId) throw new Error('Cannot create case without a client');

  const created = await prisma.case.create({
    data: {
      tenantId: args.tenantId,
      branchId: appt.branchId,
      clientId,
      leadId: appt.leadId,
      appointmentId: appt.id,
      caseType: appt.caseType ?? 'other',
      lawyerId: appt.providerId, // provider becomes the file's lawyer
      retainerFeeCents: appt.retainerFeeCents ?? null,
      status: 'PENDING_RETAINER',
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorType: 'USER',
      action: 'case.create',
      targetType: 'Case',
      targetId: created.id,
      payload: {
        origin: 'appointment.outcome.RETAINER',
        appointmentId: appt.id,
        clientId,
      },
    },
  });

  logger.info(
    { caseId: created.id, appointmentId: appt.id, tenantId: args.tenantId },
    'case auto-created from retainer outcome',
  );

  // Auto-instantiate the retainer agreement so the lawyer always sees a
  // ready-to-review draft on the case detail page.
  try {
    await ensureRetainerAgreement(prisma, {
      tenantId: args.tenantId,
      caseId: created.id,
      actorId: args.actorId,
    });
  } catch (e) {
    logger.warn({ err: e, caseId: created.id }, 'retainer auto-instantiate failed');
  }

  return { caseId: created.id, created: true };
}
