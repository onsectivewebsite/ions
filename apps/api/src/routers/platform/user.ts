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
import { createHash, randomBytes } from 'node:crypto';
import { sendPasswordResetEmail } from '@onsecboad/email';
import { loadEnv } from '@onsecboad/config';
import { router, platformProcedure } from '../../trpc.js';
import { redis } from '../../redis.js';
import { syncSeats } from '../../lib/seats.js';
import { tenantEmailBrand } from '../../lib/email-brand.js';
import { logger } from '../../logger.js';

const env = loadEnv();

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

  /**
   * Force password reset on a firm user. Mints a single-use reset token,
   * stashes it in Redis (30-min TTL), and emails a branded reset link to
   * the user's address. Audit-logs the action with the platform admin's
   * id so it's clear support did this. Doesn't change the password
   * itself — the user picks a new one via the reset link.
   */
  forcePasswordReset: platformProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.userId, deletedAt: null },
        include: { tenant: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });

      // Same key shape as auth.requestPasswordReset so completePasswordReset
      // can consume it without changes.
      const tokenRaw = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(tokenRaw).digest('hex');
      await redis.set(
        `auth:pwreset:${tokenHash}`,
        JSON.stringify({ kind: 'firm', userId: u.id }),
        'EX',
        30 * 60,
      );
      const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${tokenRaw}`;

      let emailSent = false;
      let emailError: string | null = null;
      try {
        const result = await sendPasswordResetEmail({
          to: u.email,
          recipientName: u.name,
          resetUrl,
          ttlMinutes: 30,
          brand: tenantEmailBrand(u.tenant),
        });
        emailSent = result.ok;
        if (!result.ok) emailError = result.error ?? 'unknown';
      } catch (e) {
        emailError = e instanceof Error ? e.message : 'send failed';
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: u.tenantId,
          actorId: ctx.session.sub,
          actorType: 'PLATFORM',
          action: 'platform.forcePasswordReset',
          targetType: 'User',
          targetId: u.id,
          payload: { targetEmail: u.email, emailSent },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.warn(
        { platformUserId: ctx.session.sub, targetUserId: u.id, tenantId: u.tenantId },
        'platform: force password reset',
      );

      // Return the URL so the platform admin can copy it manually if SMTP
      // dropped the message — typical support fallback.
      return { ok: true, emailSent, emailError, resetUrl };
    }),
});
