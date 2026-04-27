/**
 * Intake form template CRUD. Per-firm, per-case-type schemas — driven by
 * /settings/intake-forms in the web app.
 *
 * fieldsJson shape (validated below):
 *   [{
 *     key: string,            // unique within the template
 *     label: string,
 *     type: 'text'|'email'|'phone'|'date'|'number'|'textarea'|
 *           'select'|'multiselect'|'checkbox'|'file',
 *     required?: boolean,
 *     placeholder?: string,
 *     helpText?: string,
 *     options?: string[],     // for select / multiselect
 *     maxLength?: number
 *   }]
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

export const FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'date',
  'number',
  'textarea',
  'select',
  'multiselect',
  'checkbox',
  'file',
] as const;

export const CASE_TYPES = [
  'work_permit',
  'study_permit',
  'pr',
  'visitor_visa',
  'citizenship',
  'lmia',
  'other',
] as const;

const fieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case (a-z, 0-9, _)'),
    label: z.string().min(1).max(200),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    placeholder: z.string().max(200).optional(),
    helpText: z.string().max(500).optional(),
    options: z.array(z.string().min(1).max(120)).max(50).optional(),
    maxLength: z.number().int().min(1).max(50_000).optional(),
  })
  .refine(
    (f) => !(f.type === 'select' || f.type === 'multiselect') || (f.options?.length ?? 0) > 0,
    { message: 'select/multiselect fields require non-empty options' },
  );

const fieldsSchema = z.array(fieldSchema).min(1).max(80).refine(
  (arr) => new Set(arr.map((f) => f.key)).size === arr.length,
  { message: 'field keys must be unique within a template' },
);

export const intakeTemplateRouter = router({
  list: requirePermission('intake', 'read').query(async ({ ctx }) => {
    return ctx.prisma.intakeFormTemplate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ caseType: 'asc' }, { name: 'asc' }],
    });
  }),

  byCaseType: requirePermission('intake', 'read')
    .input(z.object({ caseType: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.intakeFormTemplate.findMany({
        where: { tenantId: ctx.tenantId, caseType: input.caseType, isActive: true },
        orderBy: { name: 'asc' },
      });
    }),

  get: requirePermission('intake', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.intakeFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return t;
    }),

  create: requirePermission('intake', 'write')
    .input(
      z.object({
        name: z.string().min(1).max(120),
        caseType: z.enum(CASE_TYPES),
        description: z.string().max(2000).optional(),
        fieldsJson: fieldsSchema,
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tpl = await ctx.prisma.intakeFormTemplate.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          caseType: input.caseType,
          description: input.description,
          fieldsJson: input.fieldsJson as unknown as Prisma.InputJsonValue,
          isActive: input.isActive,
          createdBy: ctx.session.sub,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intakeTemplate.create',
          targetType: 'IntakeFormTemplate',
          targetId: tpl.id,
          payload: { name: tpl.name, caseType: tpl.caseType, fieldCount: input.fieldsJson.length },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return tpl;
    }),

  update: requirePermission('intake', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        caseType: z.enum(CASE_TYPES).optional(),
        description: z.string().max(2000).nullable().optional(),
        fieldsJson: fieldsSchema.optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.intakeFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.IntakeFormTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.caseType !== undefined) data.caseType = input.caseType;
      if (input.description !== undefined) data.description = input.description;
      if (input.fieldsJson !== undefined)
        data.fieldsJson = input.fieldsJson as unknown as Prisma.InputJsonValue;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      const tpl = await ctx.prisma.intakeFormTemplate.update({
        where: { id: input.id },
        data,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intakeTemplate.update',
          targetType: 'IntakeFormTemplate',
          targetId: tpl.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return tpl;
    }),

  delete: requirePermission('intake', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Block delete when submissions reference it — prevent orphan history.
      const inUse = await ctx.prisma.intakeSubmission.count({
        where: { tenantId: ctx.tenantId, templateId: input.id },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete: ${inUse} past submission(s) use this template. Deactivate instead.`,
        });
      }
      const existing = await ctx.prisma.intakeFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.intakeFormTemplate.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'intakeTemplate.delete',
          targetType: 'IntakeFormTemplate',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
