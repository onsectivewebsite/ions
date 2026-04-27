import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { hashPassword } from '@onsecboad/auth';
import { router, publicProcedure } from '../trpc.js';

const brandingSchema = z.object({
  themeCode: z.enum(['maple', 'glacier', 'forest', 'slate', 'aurora', 'midnight', 'custom']),
  customPrimary: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
});

async function tenantForToken(prisma: import('@onsecboad/db').PrismaClient, rawToken: string) {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const tenant = await prisma.tenant.findUnique({ where: { setupTokenHash: tokenHash } });
  if (!tenant) return null;
  if (tenant.setupCompletedAt) return { ...tenant, expired: false, alreadyComplete: true };
  if (!tenant.setupTokenExpiresAt || tenant.setupTokenExpiresAt < new Date()) {
    return { ...tenant, expired: true, alreadyComplete: false };
  }
  return { ...tenant, expired: false, alreadyComplete: false };
}

export const setupRouter = router({
  // Inspect a setup token. Used by /setup to render firm name + admin email
  // before showing the form. Returns a generic error for invalid/expired tokens.
  verifyToken: publicProcedure
    .input(z.object({ token: z.string().min(20) }))
    .query(async ({ ctx, input }) => {
      const t = await tenantForToken(ctx.prisma, input.token);
      if (!t) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired setup link' });
      if (t.alreadyComplete) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This firm is already set up. Sign in instead.' });
      }
      if (t.expired) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Setup link expired. Ask your platform administrator to resend it.',
        });
      }
      const admin = await ctx.prisma.user.findFirst({
        where: { tenantId: t.id, status: 'INVITED' },
        orderBy: { createdAt: 'asc' },
      });
      return {
        firmName: t.displayName,
        legalName: t.legalName,
        slug: t.slug,
        adminEmail: admin?.email ?? null,
        adminName: admin?.name ?? null,
      };
    }),

  complete: publicProcedure
    .input(
      z.object({
        token: z.string().min(20),
        password: z.string().min(8).max(200),
        branding: brandingSchema,
        firstBranch: z.object({
          name: z.string().min(2).max(120),
          phone: z.string().optional(),
          addressLine1: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          postalCode: z.string().optional(),
          country: z.string().default('CA'),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await tenantForToken(ctx.prisma, input.token);
      if (!t || t.expired || t.alreadyComplete) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid, expired, or already-used setup link' });
      }

      const admin = await ctx.prisma.user.findFirst({
        where: { tenantId: t.id, status: 'INVITED' },
        orderBy: { createdAt: 'asc' },
      });
      if (!admin) throw new TRPCError({ code: 'NOT_FOUND', message: 'No pending firm admin' });

      const newPasswordHash = await hashPassword(input.password);
      const branch = await ctx.prisma.branch.findFirst({
        where: { tenantId: t.id },
        orderBy: { createdAt: 'asc' },
      });
      if (!branch) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Branch missing' });

      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: admin.id },
          data: { passwordHash: newPasswordHash, status: 'ACTIVE', joinedAt: new Date() },
        }),
        ctx.prisma.branch.update({
          where: { id: branch.id },
          data: {
            name: input.firstBranch.name,
            phone: input.firstBranch.phone ?? '',
            address: {
              line1: input.firstBranch.addressLine1 ?? null,
              city: input.firstBranch.city ?? null,
              province: input.firstBranch.province ?? null,
              postalCode: input.firstBranch.postalCode ?? null,
              country: input.firstBranch.country,
            },
          },
        }),
        ctx.prisma.tenant.update({
          where: { id: t.id },
          data: {
            status: 'ACTIVE',
            branding: input.branding,
            setupCompletedAt: new Date(),
            setupTokenHash: null,
            setupTokenExpiresAt: null,
          },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: t.id,
            actorId: admin.id,
            actorType: 'USER',
            action: 'tenant.setup.complete',
            targetType: 'Tenant',
            targetId: t.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);

      return { ok: true, adminEmail: admin.email };
    }),
});
