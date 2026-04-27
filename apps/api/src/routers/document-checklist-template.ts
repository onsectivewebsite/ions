/**
 * Document checklist template CRUD. Per firm, optionally per case type.
 * One default per (tenant, caseType=null) is the firm-wide fallback.
 *
 * itemsJson shape:
 *   [{
 *     key: string,            // unique, snake_case
 *     label: string,
 *     description?: string,
 *     required?: boolean,
 *     accept?: string[],      // mime types or extensions
 *     maxSizeMb?: number      // per-file cap
 *   }]
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

const itemSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case'),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  required: z.boolean().default(false),
  accept: z.array(z.string().min(1).max(80)).max(20).optional(),
  maxSizeMb: z.number().int().min(1).max(200).optional(),
});

const itemsSchema = z
  .array(itemSchema)
  .min(1)
  .max(80)
  .refine(
    (arr) => new Set(arr.map((i) => i.key)).size === arr.length,
    { message: 'item keys must be unique within a checklist' },
  );

export const documentChecklistTemplateRouter = router({
  list: requirePermission('documents', 'read').query(async ({ ctx }) => {
    return ctx.prisma.documentChecklistTemplate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ isDefault: 'desc' }, { caseType: 'asc' }, { name: 'asc' }],
    });
  }),

  get: requirePermission('documents', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.documentChecklistTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return t;
    }),

  create: requirePermission('documents', 'write')
    .input(
      z.object({
        name: z.string().min(1).max(120),
        caseType: z.enum(CASE_TYPES).nullable().optional(),
        description: z.string().max(2000).optional(),
        itemsJson: itemsSchema,
        isActive: z.boolean().default(true),
        isDefault: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.isDefault) {
        await ctx.prisma.documentChecklistTemplate.updateMany({
          where: { tenantId: ctx.tenantId, caseType: input.caseType ?? null, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await ctx.prisma.documentChecklistTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          caseType: input.caseType ?? null,
          description: input.description,
          itemsJson: input.itemsJson as unknown as Prisma.InputJsonValue,
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
          action: 'documentChecklistTemplate.create',
          targetType: 'DocumentChecklistTemplate',
          targetId: created.id,
          payload: { name: input.name, caseType: input.caseType ?? null, items: input.itemsJson.length },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return created;
    }),

  update: requirePermission('documents', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        caseType: z.enum(CASE_TYPES).nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
        itemsJson: itemsSchema.optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.documentChecklistTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.isDefault) {
        const target = input.caseType !== undefined ? input.caseType : existing.caseType;
        await ctx.prisma.documentChecklistTemplate.updateMany({
          where: {
            tenantId: ctx.tenantId,
            caseType: target ?? null,
            isDefault: true,
            NOT: { id: input.id },
          },
          data: { isDefault: false },
        });
      }
      const data: Prisma.DocumentChecklistTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.caseType !== undefined) data.caseType = input.caseType;
      if (input.description !== undefined) data.description = input.description;
      if (input.itemsJson !== undefined)
        data.itemsJson = input.itemsJson as unknown as Prisma.InputJsonValue;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.isDefault !== undefined) data.isDefault = input.isDefault;

      const updated = await ctx.prisma.documentChecklistTemplate.update({
        where: { id: input.id },
        data,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'documentChecklistTemplate.update',
          targetType: 'DocumentChecklistTemplate',
          targetId: updated.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  delete: requirePermission('documents', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inUse = await ctx.prisma.documentCollection.count({
        where: { tenantId: ctx.tenantId, templateId: input.id },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete: ${inUse} past collection(s) reference this template. Deactivate instead.`,
        });
      }
      const existing = await ctx.prisma.documentChecklistTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.documentChecklistTemplate.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'documentChecklistTemplate.delete',
          targetType: 'DocumentChecklistTemplate',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
