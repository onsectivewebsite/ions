/**
 * Platform-side user mutations. Lets the Onsective platform manager edit
 * users inside any tenant — currently scoped to FIRM_ADMIN-style fixes
 * (rename, change login email). Per-tenant email uniqueness is enforced.
 *
 * Phase 2 will add invite/disable/role-change here. Seat sync runs after
 * any change that could affect billable user count.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { syncSeats } from '../../lib/seats.js';

export const userPlatformRouter = router({
  update: platformProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        email: z.string().email().optional(),
        // When true and the old email matches Tenant.contactEmail, also
        // update the tenant's billing contact email so they stay in sync.
        syncContactEmail: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        include: { tenant: true, role: true },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

      // Email uniqueness within the tenant (the schema's unique index).
      if (input.email && input.email !== before.email) {
        const conflict = await ctx.prisma.user.findFirst({
          where: {
            tenantId: before.tenantId,
            email: input.email,
            id: { not: before.id },
            deletedAt: null,
          },
        });
        if (conflict) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another user in this firm already uses that email.',
          });
        }
      }

      const updated = await ctx.prisma.user.update({
        where: { id: before.id },
        data: {
          name: input.name ?? before.name,
          email: input.email ?? before.email,
        },
      });

      // Optionally keep the tenant's billing contact aligned with the
      // updated email. Only when it was previously set to the old user
      // email — never overwrite a different billing contact silently.
      if (
        input.syncContactEmail &&
        input.email &&
        input.email !== before.email &&
        before.tenant.contactEmail === before.email
      ) {
        await ctx.prisma.tenant.update({
          where: { id: before.tenantId },
          data: { contactEmail: input.email },
        });
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: before.tenantId,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'user.update',
          targetType: 'User',
          targetId: before.id,
          payload: {
            from: { name: before.name, email: before.email },
            to: { name: updated.name, email: updated.email },
            syncedContactEmail: input.syncContactEmail,
            roleName: before.role.name,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      // Cheap defensive sync — email changes don't move seats but role/status
      // changes (Phase 2) will. Keeping the call here means we can't drift.
      await syncSeats(ctx.prisma, before.tenantId);

      return { ok: true };
    }),
});
