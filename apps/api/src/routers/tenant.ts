import { Prisma } from '@onsecboad/db';
import { z } from 'zod';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const brandingSchema = z.object({
  themeCode: z.enum(['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight', 'custom']),
  customPrimary: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  logoUrl: z.string().nullable().optional(),
});

const addressSchema = z.object({
  line1: z.string().max(200).nullable().optional(),
  line2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  province: z.string().max(60).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
});

const firmDetailsSchema = z.object({
  displayName: z.string().min(2).max(200).optional(),
  legalName: z.string().min(2).max(200).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  emailFrom: z.string().email().nullable().optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  address: addressSchema.nullable().optional(),
  // Min 90 days satisfies PIPEDA s.10.3 (24-month minimum for breach
  // records). 1825 = 5 years upper bound to keep storage in check.
  auditRetentionDays: z.number().int().min(90).max(1825).optional(),
});

export const tenantRouter = router({
  brandingGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    return t?.branding ?? null;
  }),

  brandingUpdate: firmProcedure
    .input(brandingSchema)
    .mutation(async ({ ctx, input }) => {
      // Preserve internal fields the client doesn't manage (logoR2Key set by
      // the upload route). Merge instead of overwrite so saving the form
      // doesn't lose the R2 key.
      const existing = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { branding: true },
      });
      const prev = (existing?.branding ?? {}) as Record<string, unknown>;
      const merged = { ...prev, ...input };
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { branding: merged },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.branding.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: input,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  firmDetailsGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: {
        id: true,
        slug: true,
        displayName: true,
        legalName: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        emailFrom: true,
        locale: true,
        timezone: true,
        address: true,
        packageTier: true,
        seatCount: true,
        auditRetentionDays: true,
      },
    });
    return t;
  }),

  firmDetailsUpdate: requirePermission('settings', 'write')
    .input(firmDetailsSchema)
    .mutation(async ({ ctx, input }) => {
      const data: Prisma.TenantUpdateInput = {};
      if (input.displayName !== undefined) data.displayName = input.displayName;
      if (input.legalName !== undefined) data.legalName = input.legalName;
      if (input.contactName !== undefined) data.contactName = input.contactName;
      if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
      if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
      if (input.emailFrom !== undefined) data.emailFrom = input.emailFrom;
      if (input.locale !== undefined) data.locale = input.locale;
      if (input.timezone !== undefined) data.timezone = input.timezone;
      if (input.auditRetentionDays !== undefined) {
        data.auditRetentionDays = input.auditRetentionDays;
      }
      if (input.address !== undefined) {
        data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
      }
      await ctx.prisma.tenant.update({ where: { id: ctx.tenantId }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tenant.firm_details.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: { changes: Object.keys(input) },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
