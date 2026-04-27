/**
 * Retainer template CRUD. Per firm, optionally per case type.
 * One default per (tenant, caseType=null) is the firm-wide fallback.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const CASE_TYPES = [
  'work_permit',
  'study_permit',
  'pr',
  'visitor_visa',
  'citizenship',
  'lmia',
  'other',
] as const;

export const retainerTemplateRouter = router({
  list: requirePermission('retainer', 'read').query(async ({ ctx }) => {
    return ctx.prisma.retainerTemplate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ isDefault: 'desc' }, { caseType: 'asc' }, { name: 'asc' }],
    });
  }),

  get: requirePermission('retainer', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.retainerTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return t;
    }),

  create: requirePermission('retainer', 'write')
    .input(
      z.object({
        name: z.string().min(1).max(120),
        caseType: z.enum(CASE_TYPES).nullable().optional(),
        description: z.string().max(2000).optional(),
        contentMd: z.string().min(20).max(50_000),
        isActive: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only one default per (tenant, caseType) — flip the prior default off.
      if (input.isDefault) {
        await ctx.prisma.retainerTemplate.updateMany({
          where: { tenantId: ctx.tenantId, caseType: input.caseType ?? null, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await ctx.prisma.retainerTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          caseType: input.caseType ?? null,
          description: input.description,
          contentMd: input.contentMd,
          isActive: input.isActive,
          isDefault: input.isDefault,
          createdBy: ctx.session.sub,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'retainerTemplate.create',
          targetType: 'RetainerTemplate',
          targetId: created.id,
          payload: { name: input.name, caseType: input.caseType ?? null, isDefault: input.isDefault },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return created;
    }),

  update: requirePermission('retainer', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        caseType: z.enum(CASE_TYPES).nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
        contentMd: z.string().min(20).max(50_000).optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.retainerTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });

      if (input.isDefault) {
        const targetCaseType = input.caseType !== undefined ? input.caseType : existing.caseType;
        await ctx.prisma.retainerTemplate.updateMany({
          where: {
            tenantId: ctx.tenantId,
            caseType: targetCaseType ?? null,
            isDefault: true,
            NOT: { id: input.id },
          },
          data: { isDefault: false },
        });
      }
      const data: Prisma.RetainerTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.caseType !== undefined) data.caseType = input.caseType;
      if (input.description !== undefined) data.description = input.description;
      if (input.contentMd !== undefined) data.contentMd = input.contentMd;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;

      const updated = await ctx.prisma.retainerTemplate.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'retainerTemplate.update',
          targetType: 'RetainerTemplate',
          targetId: updated.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  delete: requirePermission('retainer', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inUse = await ctx.prisma.retainerAgreement.count({
        where: { tenantId: ctx.tenantId, templateId: input.id },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete: ${inUse} past agreement(s) reference this template. Deactivate instead.`,
        });
      }
      const existing = await ctx.prisma.retainerTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.retainerTemplate.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'retainerTemplate.delete',
          targetType: 'RetainerTemplate',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
