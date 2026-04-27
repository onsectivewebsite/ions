/**
 * Lead-rule CRUD. Rules drive inbound-lead routing — see lib/lead-rules.ts.
 *
 * Permissions: gated on `leadRules.read` / `leadRules.write` /
 * `leadRules.delete`. Default permission set in role seed gives Firm Admin
 * full access; Branch Manager read-only.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const matchSchema = z
  .object({
    source: z.string().max(40).optional(),
    language: z.string().max(10).optional(),
    caseInterest: z.string().max(60).optional(),
    branchId: z.string().uuid().optional(),
    hourRange: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).optional(),
  })
  .strict();

const actionSchema = z
  .object({
    assignTo: z.enum(['round_robin', 'user', 'unassigned']),
    userId: z.string().uuid().optional(),
    branchId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => v.assignTo !== 'user' || !!v.userId, {
    message: 'userId required when assignTo=user',
  });

export const leadRuleRouter = router({
  list: requirePermission('leadRules', 'read').query(async ({ ctx }) => {
    return ctx.prisma.leadRule.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { priority: 'asc' },
    });
  }),

  create: requirePermission('leadRules', 'write')
    .input(
      z.object({
        name: z.string().min(1).max(80),
        priority: z.number().int().min(0).max(10000).optional(),
        matchJson: matchSchema,
        actionJson: actionSchema,
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Default priority = max(existing) + 10 so new rules go to the bottom.
      let priority = input.priority;
      if (priority === undefined) {
        const last = await ctx.prisma.leadRule.findFirst({
          where: { tenantId: ctx.tenantId },
          orderBy: { priority: 'desc' },
          select: { priority: true },
        });
        priority = (last?.priority ?? 0) + 10;
      }
      const rule = await ctx.prisma.leadRule.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          priority,
          matchJson: input.matchJson as unknown as Prisma.InputJsonValue,
          actionJson: input.actionJson as unknown as Prisma.InputJsonValue,
          isActive: input.isActive,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'leadRule.create',
          targetType: 'LeadRule',
          targetId: rule.id,
          payload: { name: rule.name, priority: rule.priority },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return rule;
    }),

  update: requirePermission('leadRules', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(80).optional(),
        priority: z.number().int().min(0).max(10000).optional(),
        matchJson: matchSchema.optional(),
        actionJson: actionSchema.optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.leadRule.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });

      const data: Prisma.LeadRuleUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.matchJson !== undefined)
        data.matchJson = input.matchJson as unknown as Prisma.InputJsonValue;
      if (input.actionJson !== undefined)
        data.actionJson = input.actionJson as unknown as Prisma.InputJsonValue;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      const rule = await ctx.prisma.leadRule.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'leadRule.update',
          targetType: 'LeadRule',
          targetId: rule.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return rule;
    }),

  delete: requirePermission('leadRules', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.leadRule.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
      await ctx.prisma.leadRule.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'leadRule.delete',
          targetType: 'LeadRule',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  reorder: requirePermission('leadRules', 'write')
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      // Re-assign priority by index (10, 20, 30...). Atomic in a transaction
      // so a partial failure doesn't leave dupes.
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, idx) =>
          ctx.prisma.leadRule.updateMany({
            where: { id, tenantId: ctx.tenantId },
            data: { priority: (idx + 1) * 10 },
          }),
        ),
      );
      return { ok: true };
    }),
});
