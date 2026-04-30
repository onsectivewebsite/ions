import { z } from 'zod';
import { router, firmProcedure } from '../trpc.js';

const brandingSchema = z.object({
  themeCode: z.enum(['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight', 'custom']),
  customPrimary: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  logoUrl: z.string().nullable().optional(),
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
});
