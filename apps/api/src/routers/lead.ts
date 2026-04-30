/**
 * Lead pipeline — Phase 3 slice 1.
 * RBAC: gated on `leads.*`. Branch scope filters by branchId; own scope
 * (TELECALLER default) filters by assignedToId.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { pickAssignee } from '../lib/lead-distribute.js';
import { publishEvent } from '../lib/realtime.js';
import { logger } from '../logger.js';

const leadStatusSchema = z.enum([
  'NEW',
  'CONTACTED',
  'FOLLOWUP',
  'INTERESTED',
  'BOOKED',
  'CONVERTED',
  'LOST',
  'DNC',
]);

const sourceSchema = z.enum([
  'meta',
  'tiktok',
  'website',
  'walkin',
  'referral',
  'manual',
  'import',
]);

const baseLeadInput = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  source: sourceSchema.default('manual'),
  language: z.string().max(10).optional(),
  caseInterest: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().uuid().nullable().optional(),
  consentMarketing: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).optional(),
  externalId: z.string().max(120).optional(),
});

/** Build a Prisma `where` that respects the caller's leads.read scope. */
function leadReadWhere(
  ctx: { tenantId: string; scope: string; perms: { branchId: string | null; userId: string } },
): Prisma.LeadWhereInput {
  const base: Prisma.LeadWhereInput = { tenantId: ctx.tenantId, deletedAt: null };
  if (ctx.scope === 'tenant') return base;
  if (ctx.scope === 'branch') {
    return { ...base, branchId: ctx.perms.branchId };
  }
  if (ctx.scope === 'own') {
    return { ...base, assignedToId: ctx.perms.userId };
  }
  // 'assigned' / 'case' fall back to "assignedToId = me" until those resources land.
  return { ...base, assignedToId: ctx.perms.userId };
}

export const leadRouter = router({
  list: requirePermission('leads', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          q: z.string().optional(),
          status: leadStatusSchema.optional(),
          source: sourceSchema.optional(),
          language: z.string().optional(),
          branchId: z.string().uuid().optional(),
          assignedToMe: z.boolean().optional(),
          dateFrom: z.string().datetime().optional(),
          dateTo: z.string().datetime().optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.LeadWhereInput = {
        ...leadReadWhere(ctx),
        ...(input.status ? { status: input.status } : {}),
        ...(input.source ? { source: input.source } : {}),
        ...(input.language ? { language: input.language } : {}),
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.assignedToMe ? { assignedToId: ctx.perms.userId } : {}),
        ...(input.dateFrom || input.dateTo
          ? {
              createdAt: {
                ...(input.dateFrom ? { gte: new Date(input.dateFrom) } : {}),
                ...(input.dateTo ? { lte: new Date(input.dateTo) } : {}),
              },
            }
          : {}),
        ...(input.q
          ? {
              OR: [
                { firstName: { contains: input.q, mode: 'insensitive' as const } },
                { lastName: { contains: input.q, mode: 'insensitive' as const } },
                { email: { contains: input.q, mode: 'insensitive' as const } },
                { phone: { contains: input.q } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.lead.findMany({
          where,
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
          take: 50,
          skip: (input.page - 1) * 50,
          include: {
            assignedTo: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        ctx.prisma.lead.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: 50 };
    }),

  get: requirePermission('leads', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.id, ...leadReadWhere(ctx) },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          branch: { select: { id: true, name: true } },
          callLogs: { orderBy: { startedAt: 'desc' }, take: 50 },
          smsLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
          emailLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
          cases: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true, caseType: true, createdAt: true },
          },
          appointments: {
            orderBy: { scheduledAt: 'desc' },
            take: 10,
            select: {
              id: true,
              scheduledAt: true,
              status: true,
              outcome: true,
              kind: true,
              provider: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      return lead;
    }),

  create: requirePermission('leads', 'write')
    .input(baseLeadInput)
    .mutation(async ({ ctx, input }) => {
      // Branch managers can only create leads in their own branch.
      if (ctx.scope === 'branch' && input.branchId && input.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      const targetBranch = input.branchId ?? (ctx.perms.branchId ?? null);

      // Round-robin assignment among telecallers in the target branch.
      const distribute = await pickAssignee(ctx.prisma, {
        tenantId: ctx.tenantId,
        branchId: targetBranch,
      });

      const lead = await ctx.prisma.lead.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: targetBranch,
          assignedToId: distribute.assignedToId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          source: input.source,
          externalId: input.externalId,
          language: input.language,
          caseInterest: input.caseInterest,
          notes: input.notes,
          consentMarketing: input.consentMarketing,
          payload: input.payload as Prisma.InputJsonValue | undefined,
        },
      });

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.create',
          targetType: 'Lead',
          targetId: lead.id,
          payload: { source: input.source, distribute: distribute.reason, assignedToId: distribute.assignedToId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return lead;
    }),

  update: requirePermission('leads', 'write')
    .input(
      z
        .object({
          id: z.string().uuid(),
          firstName: z.string().max(100).nullable().optional(),
          lastName: z.string().max(100).nullable().optional(),
          email: z.string().email().nullable().optional(),
          phone: z.string().max(40).nullable().optional(),
          language: z.string().max(10).nullable().optional(),
          caseInterest: z.string().max(60).nullable().optional(),
          notes: z.string().max(2000).nullable().optional(),
          followupDueAt: z.string().datetime().nullable().optional(),
          priority: z.number().int().min(1).max(100).optional(),
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.id, ...leadReadWhere(ctx) },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.LeadUpdateInput = {};
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.email !== undefined) data.email = input.email;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.language !== undefined) data.language = input.language;
      if (input.caseInterest !== undefined) data.caseInterest = input.caseInterest;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.followupDueAt !== undefined) {
        data.followupDueAt = input.followupDueAt ? new Date(input.followupDueAt) : null;
      }
      if (input.priority !== undefined) data.priority = input.priority;
      const updated = await ctx.prisma.lead.update({ where: { id: lead.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.update',
          targetType: 'Lead',
          targetId: lead.id,
          payload: input as object,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  assign: requirePermission('leads', 'write')
    .input(z.object({ id: z.string().uuid(), userId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.id, ...leadReadWhere(ctx) },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.userId) {
        // Manual assignment is permissive — accept INVITED users too
        // (they'll see the lead the moment they accept their invite).
        // Block only DISABLED + soft-deleted; auto round-robin still
        // picks only ACTIVE telecallers, so this only affects manual
        // reassign by a firm admin / branch manager.
        const u = await ctx.prisma.user.findFirst({
          where: {
            id: input.userId,
            tenantId: ctx.tenantId,
            deletedAt: null,
            status: { in: ['ACTIVE', 'INVITED'] },
          },
        });
        if (!u) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That user is disabled or no longer in this firm.',
          });
        }
      }
      await ctx.prisma.lead.update({
        where: { id: lead.id },
        data: { assignedToId: input.userId },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.assign',
          targetType: 'Lead',
          targetId: lead.id,
          payload: { from: lead.assignedToId, to: input.userId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      if (input.userId) {
        void publishEvent(
          { kind: 'user', tenantId: ctx.tenantId, userId: input.userId },
          {
            type: 'lead.assigned',
            leadId: lead.id,
            assignedToId: input.userId,
            firstName: lead.firstName ?? undefined,
            lastName: lead.lastName ?? undefined,
            phone: lead.phone ?? undefined,
          },
        );
        // Phase 9.5 — push to the assignee's mobile devices.
        const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.phone || 'New lead';
        void (async () => {
          const { pushToUsers } = await import('../lib/push.js');
          await pushToUsers([input.userId!], {
            title: 'New lead assigned',
            body: `${fullName}${lead.caseInterest ? ` · ${lead.caseInterest.replace('_', ' ')}` : ''}`,
            data: { kind: 'lead', id: lead.id },
          });
        })();
      }
      return { ok: true };
    }),

  bulkAssign: requirePermission('leads', 'write')
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(500), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: { in: ['ACTIVE', 'INVITED'] },
        },
      });
      if (!u) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That user is disabled or no longer in this firm.',
        });
      }
      const result = await ctx.prisma.lead.updateMany({
        where: { id: { in: input.ids }, ...leadReadWhere(ctx) },
        data: { assignedToId: input.userId },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.bulkAssign',
          targetType: 'Lead',
          payload: { count: result.count, userId: input.userId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, count: result.count };
    }),

  changeStatus: requirePermission('leads', 'write')
    .input(z.object({ id: z.string().uuid(), status: leadStatusSchema, note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.id, ...leadReadWhere(ctx) },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: input.status,
          lastContactedAt: ['CONTACTED', 'INTERESTED', 'BOOKED'].includes(input.status)
            ? new Date()
            : lead.lastContactedAt,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.changeStatus',
          targetType: 'Lead',
          targetId: lead.id,
          payload: { from: lead.status, to: input.status, note: input.note ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  markDnc: requirePermission('leads', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const lead = await ctx.prisma.lead.findFirst({
        where: { id: input.id, ...leadReadWhere(ctx) },
      });
      if (!lead) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.lead.update({
        where: { id: lead.id },
        data: { dncFlag: true, status: 'DNC' },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'lead.markDnc',
          targetType: 'Lead',
          targetId: lead.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  merge: requirePermission('leads', 'write')
    .input(z.object({ fromId: z.string().uuid(), toId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.fromId === input.toId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot merge a lead into itself' });
      }
      const [from, to] = await Promise.all([
        ctx.prisma.lead.findFirst({ where: { id: input.fromId, ...leadReadWhere(ctx) } }),
        ctx.prisma.lead.findFirst({ where: { id: input.toId, ...leadReadWhere(ctx) } }),
      ]);
      if (!from || !to) throw new TRPCError({ code: 'NOT_FOUND' });
      // Move call/sms/email logs to the surviving lead, then soft-delete the source.
      await ctx.prisma.$transaction([
        ctx.prisma.callLog.updateMany({ where: { leadId: from.id }, data: { leadId: to.id } }),
        ctx.prisma.smsLog.updateMany({ where: { leadId: from.id }, data: { leadId: to.id } }),
        ctx.prisma.emailLog.updateMany({ where: { leadId: from.id }, data: { leadId: to.id } }),
        ctx.prisma.lead.update({ where: { id: from.id }, data: { deletedAt: new Date() } }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'lead.merge',
            targetType: 'Lead',
            targetId: to.id,
            payload: { mergedFrom: from.id },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);
      logger.info({ from: from.id, to: to.id }, 'lead merged');
      return { ok: true };
    }),

  /**
   * Telecaller "my queue" — single round-trip for the /queue dashboard.
   * Returns the caller's open leads + today's stats + followups due.
   * Honours own/branch/tenant scope (TELECALLER → only assignedTo=me).
   */
  myQueue: requirePermission('leads', 'read').query(async ({ ctx }) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const now = new Date();

    const baseWhere: Prisma.LeadWhereInput = {
      tenantId: ctx.tenantId,
      deletedAt: null,
      assignedToId: ctx.perms.userId,
    };

    const [open, followups, callsToday, conversionsToday, smsTodayInbound] = await Promise.all([
      ctx.prisma.lead.findMany({
        where: {
          ...baseWhere,
          status: { in: ['NEW', 'CONTACTED', 'FOLLOWUP', 'INTERESTED'] },
        },
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          status: true,
          source: true,
          language: true,
          caseInterest: true,
          followupDueAt: true,
          lastContactedAt: true,
          createdAt: true,
        },
      }),
      ctx.prisma.lead.count({
        where: {
          ...baseWhere,
          followupDueAt: { lte: now },
          status: { in: ['CONTACTED', 'FOLLOWUP', 'INTERESTED'] },
        },
      }),
      ctx.prisma.callLog.count({
        where: { tenantId: ctx.tenantId, agentId: ctx.perms.userId, startedAt: { gte: startOfToday } },
      }),
      ctx.prisma.lead.count({
        where: {
          ...baseWhere,
          status: { in: ['CONVERTED', 'BOOKED'] },
          updatedAt: { gte: startOfToday },
        },
      }),
      ctx.prisma.smsLog.count({
        where: {
          tenantId: ctx.tenantId,
          direction: 'inbound',
          createdAt: { gte: startOfToday },
          lead: { is: { assignedToId: ctx.perms.userId } },
        },
      }),
    ]);

    return {
      open,
      stats: {
        openCount: open.length,
        followupsDue: followups,
        callsToday,
        conversionsToday,
        smsInboundToday: smsTodayInbound,
      },
    };
  }),
});
