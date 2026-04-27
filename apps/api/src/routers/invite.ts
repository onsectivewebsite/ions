/**
 * Public invite-accept flow. The invited user clicks the email link, lands on
 * /invite/[token], previews the firm + role, sets a password, and is signed
 * in. 2FA enrollment is offered post-accept (TOTP via /settings/security or
 * email OTP at every sign-in by default).
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { hashPassword, signAccessToken, generateRefreshToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { router, publicProcedure } from '../trpc.js';

const env = loadEnv();

async function inviteByToken(prisma: import('@onsecboad/db').PrismaClient, raw: string) {
  const tokenHash = createHash('sha256').update(raw).digest('hex');
  const invite = await prisma.invite.findUnique({ where: { tokenHash } });
  if (!invite) return { invite: null, expired: false, alreadyAccepted: false };
  if (invite.acceptedAt) return { invite, expired: false, alreadyAccepted: true };
  if (invite.expiresAt < new Date()) return { invite, expired: true, alreadyAccepted: false };
  return { invite, expired: false, alreadyAccepted: false };
}

export const inviteRouter = router({
  preview: publicProcedure
    .input(z.object({ token: z.string().min(20) }))
    .query(async ({ ctx, input }) => {
      const { invite, expired, alreadyAccepted } = await inviteByToken(ctx.prisma, input.token);
      if (!invite) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid invite link' });
      if (alreadyAccepted) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invite has already been used. Sign in instead.' });
      }
      if (expired) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This invite has expired. Ask your firm admin to resend.',
        });
      }
      const [tenant, role, user] = await Promise.all([
        ctx.prisma.tenant.findUnique({
          where: { id: invite.tenantId },
          select: { displayName: true, branding: true },
        }),
        ctx.prisma.role.findUnique({
          where: { id: invite.roleId },
          select: { name: true },
        }),
        ctx.prisma.user.findFirst({
          where: { tenantId: invite.tenantId, email: invite.email, deletedAt: null },
          select: { name: true, email: true },
        }),
      ]);
      if (!tenant || !role || !user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite target missing' });
      }
      return {
        firmName: tenant.displayName,
        roleName: role.name,
        recipientName: user.name,
        recipientEmail: user.email,
        branding: tenant.branding,
      };
    }),

  accept: publicProcedure
    .input(
      z.object({
        token: z.string().min(20),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { invite, expired, alreadyAccepted } = await inviteByToken(ctx.prisma, input.token);
      if (!invite || expired || alreadyAccepted) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid, expired, or already-used invite' });
      }
      const user = await ctx.prisma.user.findFirst({
        where: { tenantId: invite.tenantId, email: invite.email, deletedAt: null },
      });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });

      const newHash = await hashPassword(input.password);
      const now = new Date();
      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: newHash, status: 'ACTIVE', joinedAt: now },
        }),
        ctx.prisma.invite.update({
          where: { tokenHash: invite.tokenHash },
          data: { acceptedAt: now },
        }),
        ctx.prisma.auditLog.create({
          data: {
            tenantId: invite.tenantId,
            actorId: user.id,
            actorType: 'USER',
            action: 'user.invite.accept',
            targetType: 'User',
            targetId: user.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);

      // Mint a fresh access token and refresh session — invitee skips the
      // sign-in screen entirely after accepting.
      const claims = {
        sub: user.id,
        scope: 'firm' as const,
        tenantId: invite.tenantId,
        roleId: user.roleId,
        ...(user.branchId ? { branchId: user.branchId } : {}),
      };
      const access = await signAccessToken(claims, env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SEC);
      const refresh = generateRefreshToken();
      const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);
      await ctx.prisma.session.create({
        data: {
          userId: user.id,
          refreshTokenHash: refresh.hash,
          device: ctx.userAgent ?? 'unknown',
          ip: ctx.ip,
          expiresAt,
        },
      });

      return {
        ok: true,
        accessToken: access.token,
        refreshToken: refresh.token,
        accessExpiresAt: access.expiresAt.toISOString(),
      };
    }),
});
