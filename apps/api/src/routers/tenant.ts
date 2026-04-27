import { z } from 'zod';
import { router, firmProcedure } from '../trpc.js';

const brandingSchema = z.object({
  themeCode: z.enum(['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight', 'custom']),
  customPrimary: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
});

export const tenantRouter = router({
  brandingGet: firmProcedure.query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({ where: { id: ctx.tenantId } });
    return t?.branding ?? null;
  }),

  brandingUpdate: firmProcedure
    .input(brandingSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { branding: input },
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
