/**
 * Appointment router. Phase 4.2.
 *
 * State machine (enforced server-side):
 *   SCHEDULED → CONFIRMED → ARRIVED → IN_PROGRESS → COMPLETED
 *                                              ↘ NO_SHOW
 *   any → CANCELLED (with reason)
 *
 * Outcome is recorded once we hit COMPLETED. The outcome drives the lead
 * status transition that closes the consult-to-case loop:
 *   RETAINER  → lead BOOKED  (case management kicks off in Phase 5)
 *   FOLLOWUP  → lead FOLLOWUP
 *   DONE      → lead CONVERTED (consult fulfilled, no retainer needed)
 *   NO_SHOW   → lead LOST
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { publishEvent } from '../lib/realtime.js';
import { autoCreateCaseFromRetainer } from './case.js';
import { logger } from '../logger.js';

const KIND = ['consultation', 'followup', 'document_review', 'walkin'] as const;
const STATUS = [
  'SCHEDULED',
  'CONFIRMED',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;
const OUTCOME = ['RETAINER', 'FOLLOWUP', 'DONE', 'NO_SHOW'] as const;

// Allowed forward transitions. Any → CANCELLED is allowed separately.
const NEXT: Record<(typeof STATUS)[number], (typeof STATUS)[number][]> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['ARRIVED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

function ensureCanTransition(
  from: (typeof STATUS)[number],
  to: (typeof STATUS)[number],
): void {
  if (!NEXT[from].includes(to)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Cannot move from ${from} to ${to}.`,
    });
  }
}

// Build the where-fragment that respects this user's scope on appointments.
// 'tenant' (Firm Admin _all) → no extra filter.
// 'branch' → only their branch's appointments.
// 'own' → only appointments where they are the provider.
function appointmentReadWhere(ctx: {
  tenantId: string;
  scope: false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
  perms: { userId: string; branchId: string | null };
}): Prisma.AppointmentWhereInput {
  const base: Prisma.AppointmentWhereInput = { tenantId: ctx.tenantId };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch')
    return { ...base, branchId: ctx.perms.branchId ?? '__none__' };
  // 'own' / 'assigned' / 'case' all collapse to "I'm the provider" for now.
  return { ...base, providerId: ctx.perms.userId };
}

export const appointmentRouter = router({
  list: requirePermission('appointments', 'read')
    .input(
      z
        .object({
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
          providerId: z.string().uuid().optional(),
          status: z.enum(STATUS).optional(),
          branchId: z.string().uuid().optional(),
          clientId: z.string().uuid().optional(),
          leadId: z.string().uuid().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.AppointmentWhereInput = {
        ...appointmentReadWhere(ctx),
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.clientId ? { clientId: input.clientId } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
        ...(input.from || input.to
          ? {
              scheduledAt: {
                ...(input.from ? { gte: new Date(input.from) } : {}),
                ...(input.to ? { lte: new Date(input.to) } : {}),
              },
            }
          : {}),
      };
      return ctx.prisma.appointment.findMany({
        where,
        orderBy: { scheduledAt: 'asc' },
        take: 500,
        include: {
          provider: { select: { id: true, name: true, email: true } },
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
        },
      });
    }),

  get: requirePermission('appointments', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const a = await ctx.prisma.appointment.findFirst({
        where: { id: input.id, ...appointmentReadWhere(ctx) },
        include: {
          provider: { select: { id: true, name: true, email: true } },
          client: { select: { id: true, firstName: true, lastName: true, phone: true } },
          lead: { select: { id: true, firstName: true, lastName: true, phone: true, status: true } },
          branch: { select: { id: true, name: true } },
        },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });
      return a;
    }),

  create: requirePermission('appointments', 'write')
    .input(
      z.object({
        providerId: z.string().uuid(),
        scheduledAt: z.string().datetime(),
        durationMin: z.number().int().min(5).max(8 * 60).default(30),
        kind: z.enum(KIND).default('consultation'),
        caseType: z.string().max(60).optional(),
        clientId: z.string().uuid().optional(),
        leadId: z.string().uuid().optional(),
        branchId: z.string().uuid().nullable().optional(),
        feeCents: z.number().int().min(0).max(10_000_00).optional(),
        notes: z.string().max(2000).optional(),
        // Bypass intake-completion gate (firm admin / branch manager only).
        skipIntakeCheck: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Provider must belong to the firm + be active.
      const provider = await ctx.prisma.user.findFirst({
        where: {
          id: input.providerId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        include: { role: { select: { name: true } } },
      });
      if (!provider) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Provider not found in this firm.',
        });
      }
      // The booking must reference *something* — lead, client, or both.
      if (!input.leadId && !input.clientId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Pick a lead or a client to book this appointment for.',
        });
      }
      // Soft-validate the references belong to this firm.
      if (input.leadId) {
        const ok = await ctx.prisma.lead.findFirst({
          where: { id: input.leadId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true, branchId: true },
        });
        if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }
      if (input.clientId) {
        const ok = await ctx.prisma.client.findFirst({
          where: { id: input.clientId, tenantId: ctx.tenantId, deletedAt: null },
          select: { id: true, branchId: true },
        });
        if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      }
      // Default branch = provider's branch.
      const branchId =
        input.branchId === undefined ? provider.branchId : input.branchId;

      // Gate: at least one filled IntakeSubmission must exist for the
      // lead/client BEFORE the appointment can be booked. Firm admins +
      // branch managers can override with skipIntakeCheck=true. Walk-in
      // appointments (kind=walkin) are allowed without intake — that's
      // typically the receptionist booking on the spot.
      if (!input.skipIntakeCheck && input.kind !== 'walkin') {
        const intakeFilter = {
          tenantId: ctx.tenantId,
          ...(input.leadId ? { leadId: input.leadId } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
        };
        const filledCount = await ctx.prisma.intakeSubmission.count({
          where: intakeFilter,
        });
        if (filledCount === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Send an intake form first — appointments can only be booked after the client fills theirs. Firm admins can override.',
          });
        }
      } else if (input.skipIntakeCheck) {
        // Permission gate on the override.
        const role = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.sub },
          include: { role: true },
        });
        const roleName = role?.role.name ?? '';
        const allowed =
          /firm.?admin/i.test(roleName) ||
          /branch.?manager/i.test(roleName) ||
          ctx.scope === 'tenant';
        if (!allowed) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only firm admin or branch manager can skip the intake gate.',
          });
        }
      }

      const appt = await ctx.prisma.appointment.create({
        data: {
          tenantId: ctx.tenantId,
          providerId: input.providerId,
          scheduledAt: new Date(input.scheduledAt),
          durationMin: input.durationMin,
          kind: input.kind,
          caseType: input.caseType,
          clientId: input.clientId,
          leadId: input.leadId,
          branchId,
          feeCents: input.feeCents,
          notes: input.notes,
          createdBy: ctx.session.sub,
          status: 'SCHEDULED',
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'appointment.create',
          targetType: 'Appointment',
          targetId: appt.id,
          payload: {
            providerId: input.providerId,
            scheduledAt: input.scheduledAt,
            kind: input.kind,
            leadId: input.leadId ?? null,
            clientId: input.clientId ?? null,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      // Realtime: notify the provider so their agenda updates without refresh.
      void publishEvent(
        { kind: 'user', tenantId: ctx.tenantId, userId: input.providerId },
        {
          type: 'appointment.created',
          appointmentId: appt.id,
          scheduledAt: appt.scheduledAt.toISOString(),
          providerId: input.providerId,
        },
      );

      // Phase 9.5 — push to the provider's mobile devices.
      void (async () => {
        const { pushToUsers } = await import('../lib/push.js');
        const when = appt.scheduledAt.toLocaleString('en-CA', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        await pushToUsers([input.providerId], {
          title: 'New appointment',
          body: `${when} · ${appt.kind}${appt.caseType ? ` · ${appt.caseType.replace('_', ' ')}` : ''}`,
          data: { kind: 'appointment', id: appt.id },
        });
      })();

      return appt;
    }),

  update: requirePermission('appointments', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        scheduledAt: z.string().datetime().optional(),
        durationMin: z.number().int().min(5).max(8 * 60).optional(),
        providerId: z.string().uuid().optional(),
        kind: z.enum(KIND).optional(),
        caseType: z.string().max(60).nullable().optional(),
        feeCents: z.number().int().min(0).max(10_000_00).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.appointment.findFirst({
        where: { id: input.id, ...appointmentReadWhere(ctx) },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED' || existing.status === 'NO_SHOW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot edit an appointment in ${existing.status} state.`,
        });
      }
      const data: Prisma.AppointmentUpdateInput = {};
      if (input.scheduledAt) data.scheduledAt = new Date(input.scheduledAt);
      if (input.durationMin) data.durationMin = input.durationMin;
      if (input.kind) data.kind = input.kind;
      if (input.caseType !== undefined) data.caseType = input.caseType;
      if (input.feeCents !== undefined) data.feeCents = input.feeCents;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.providerId) {
        const provider = await ctx.prisma.user.findFirst({
          where: { id: input.providerId, tenantId: ctx.tenantId, deletedAt: null, status: 'ACTIVE' },
        });
        if (!provider) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provider not in firm' });
        data.provider = { connect: { id: input.providerId } };
      }
      const a = await ctx.prisma.appointment.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'appointment.update',
          targetType: 'Appointment',
          targetId: a.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return a;
    }),

  // Status transitions — separate endpoints so each is auditable + the
  // payload schema is precise per action.
  transition: requirePermission('appointments', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.enum(STATUS),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.appointment.findFirst({
        where: { id: input.id, ...appointmentReadWhere(ctx) },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });

      if (input.to === 'CANCELLED') {
        if (a.status === 'COMPLETED' || a.status === 'CANCELLED') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Already ${a.status}.`,
          });
        }
      } else {
        ensureCanTransition(a.status, input.to);
      }

      const now = new Date();
      const data: Prisma.AppointmentUpdateInput = { status: input.to };
      if (input.to === 'ARRIVED') data.arrivedAt = now;
      if (input.to === 'IN_PROGRESS') data.startedAt = now;
      if (input.to === 'COMPLETED') data.completedAt = now;
      if (input.to === 'CANCELLED') {
        data.cancelledAt = now;
        data.cancelReason = input.reason ?? null;
      }
      const updated = await ctx.prisma.appointment.update({
        where: { id: a.id },
        data,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'appointment.transition',
          targetType: 'Appointment',
          targetId: a.id,
          payload: { from: a.status, to: input.to, reason: input.reason ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  /**
   * recordOutcome — once an appointment has been completed (or via
   * a one-shot transition from IN_PROGRESS), capture what happened.
   * Auto-bridges to the lead's status so the CRM funnel keeps moving.
   */
  recordOutcome: requirePermission('appointments', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        outcome: z.enum(OUTCOME),
        outcomeNotes: z.string().max(4000).optional(),
        retainerFeeCents: z.number().int().min(0).max(10_000_00).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.appointment.findFirst({
        where: { id: input.id, ...appointmentReadWhere(ctx) },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });
      if (a.status !== 'COMPLETED' && a.status !== 'IN_PROGRESS' && a.status !== 'NO_SHOW') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Outcome can only be recorded on an in-progress, completed, or no-show appointment.',
        });
      }

      const now = new Date();
      const data: Prisma.AppointmentUpdateInput = {
        outcome: input.outcome,
        outcomeNotes: input.outcomeNotes ?? null,
        retainerFeeCents:
          input.outcome === 'RETAINER' ? input.retainerFeeCents ?? null : null,
      };
      // Auto-complete if recording outcome from IN_PROGRESS.
      if (a.status === 'IN_PROGRESS') {
        data.status = 'COMPLETED';
        data.completedAt = now;
      }
      // NO_SHOW outcome is only meaningful when the status is also NO_SHOW.
      if (input.outcome === 'NO_SHOW' && a.status !== 'NO_SHOW') {
        data.status = 'NO_SHOW';
      }

      const updated = await ctx.prisma.appointment.update({
        where: { id: a.id },
        data,
      });

      // Bridge to lead status (the CRM-to-case bridge). Skip if no lead linked.
      if (a.leadId) {
        const leadStatus =
          input.outcome === 'RETAINER'
            ? 'BOOKED'
            : input.outcome === 'FOLLOWUP'
              ? 'FOLLOWUP'
              : input.outcome === 'DONE'
                ? 'CONVERTED'
                : 'LOST';
        await ctx.prisma.lead.update({
          where: { id: a.leadId },
          data: { status: leadStatus },
        });
      }

      // Auto-create a Case when the consult retained. Stash the new case id
      // on the appointment update so the UI can deep-link.
      let caseId: string | null = null;
      if (input.outcome === 'RETAINER') {
        try {
          const r = await autoCreateCaseFromRetainer(ctx.prisma, {
            tenantId: ctx.tenantId,
            appointmentId: a.id,
            actorId: ctx.session.sub,
          });
          caseId = r.caseId;
        } catch (e) {
          // Don't fail outcome capture if case-create breaks (e.g. no phone
          // on lead). The lawyer/admin can create the case manually.
          logger.warn(
            { err: e, appointmentId: a.id },
            'auto case-create on RETAINER failed',
          );
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'appointment.recordOutcome',
          targetType: 'Appointment',
          targetId: a.id,
          payload: {
            outcome: input.outcome,
            retainerFeeCents: input.retainerFeeCents ?? null,
            leadId: a.leadId ?? null,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.info(
        { appointmentId: a.id, outcome: input.outcome, leadId: a.leadId },
        'appointment outcome recorded',
      );

      // Notify the firm so the agenda + lead views refresh.
      void publishEvent(
        { kind: 'tenant', tenantId: ctx.tenantId },
        {
          type: 'appointment.outcome',
          appointmentId: a.id,
          outcome: input.outcome,
          leadId: a.leadId,
        },
      );

      // Phase 8.4 — fire AI consultation summary asynchronously when there
      // are notes worth summarizing. Worker handles AiSettings + budget
      // gating + logging; failure is best-effort and never blocks outcome.
      const noteLen = (input.outcomeNotes?.length ?? 0) + (a.notes?.length ?? 0);
      if (noteLen >= 20) {
        const { summarizeConsultationAsync } = await import('../lib/ai-summarize.js');
        void summarizeConsultationAsync(ctx.prisma, a.id);
      }

      return { ...updated, caseId };
    }),

  // Phase 8.4 — manual re-summarize a consultation.
  summarize: requirePermission('ai', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.appointment.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });
      const { summarizeConsultationAsync } = await import('../lib/ai-summarize.js');
      await summarizeConsultationAsync(ctx.prisma, a.id);
      const refreshed = await ctx.prisma.appointment.findUnique({
        where: { id: a.id },
        select: {
          aiSummary: true,
          aiSummarizedAt: true,
          aiSummaryMode: true,
        },
      });
      return refreshed;
    }),
});
