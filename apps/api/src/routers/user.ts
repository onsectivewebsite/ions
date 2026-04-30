import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomBytes, createHash } from 'node:crypto';
import { Prisma } from '@onsecboad/db';
import { sendUserInviteEmail } from '@onsecboad/email';
import { tenantEmailBrand } from '../lib/email-brand.js';
import { loadEnv } from '@onsecboad/config';
import { router, protectedProcedure, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { logger } from '../logger.js';
import { syncSeats } from '../lib/seats.js';

const env = loadEnv();
const INVITE_TTL_DAYS = 7;

function passkeyOwnerWhere(session: { scope: string; sub: string }) {
  return session.scope === 'platform'
    ? { platformUserId: session.sub }
    : { userId: session.sub };
}

function makeInviteToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

const userStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DISABLED']);

export const userRouter = router({
  list: requirePermission('users', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          q: z.string().optional(),
          branchId: z.string().uuid().optional(),
          roleId: z.string().uuid().optional(),
          status: userStatusSchema.optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      // Branch-scoped readers (branch managers) only see users in their branch.
      const branchScopeFilter =
        ctx.scope === 'branch' && ctx.perms.branchId
          ? { branchId: ctx.perms.branchId }
          : {};
      const where: Prisma.UserWhereInput = {
        tenantId: ctx.tenantId,
        deletedAt: null,
        ...branchScopeFilter,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.q
          ? {
              OR: [
                { name: { contains: input.q, mode: 'insensitive' as const } },
                { email: { contains: input.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 50,
          skip: (input.page - 1) * 50,
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
            invitedAt: true,
            joinedAt: true,
            lastLoginAt: true,
            isBillable: true,
            role: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        ctx.prisma.user.count({ where }),
      ]);
      // Seat usage: a tenant's "seats" billable count = active+invited billable users.
      const billable = await ctx.prisma.user.count({
        where: { tenantId: ctx.tenantId, isBillable: true, status: { in: ['ACTIVE', 'INVITED'] }, deletedAt: null },
      });
      const tenant = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { plan: { select: { limits: true, name: true } } },
      });
      const userLimit =
        tenant?.plan && typeof tenant.plan.limits === 'object' && tenant.plan.limits !== null
          ? (tenant.plan.limits as Record<string, unknown>).users ?? null
          : null;
      return {
        items,
        total,
        page: input.page,
        pageSize: 50,
        seats: { billable, limit: userLimit },
      };
    }),

  invite: requirePermission('users', 'write')
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(2).max(200),
        phone: z.string().max(40).optional(),
        roleId: z.string().uuid(),
        branchId: z.string().uuid().nullable().optional(),
        isBillable: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Branch managers can only invite into their own branch and never as FIRM_ADMIN.
      if (ctx.scope === 'branch') {
        if (!input.branchId || input.branchId !== ctx.perms.branchId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only invite users into your own branch.',
          });
        }
        const targetRole = await ctx.prisma.role.findFirst({
          where: { id: input.roleId, tenantId: ctx.tenantId },
        });
        if (targetRole?.name === 'FIRM_ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Branch managers cannot invite firm admins.',
          });
        }
      }
      // Email uniqueness within the tenant.
      const conflict = await ctx.prisma.user.findFirst({
        where: { tenantId: ctx.tenantId, email: input.email, deletedAt: null },
      });
      if (conflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Someone in this firm already has that email.',
        });
      }
      const role = await ctx.prisma.role.findFirst({
        where: { id: input.roleId, tenantId: ctx.tenantId },
      });
      if (!role) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Role not in this firm' });
      if (input.branchId) {
        const branch = await ctx.prisma.branch.findFirst({
          where: { id: input.branchId, tenantId: ctx.tenantId, isActive: true },
        });
        if (!branch) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Branch not in this firm' });
      }

      const inviter = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.sub },
        include: { tenant: true },
      });
      if (!inviter) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const token = makeInviteToken();
      // Create the User row up front (status=INVITED) so the seat counter
      // moves immediately and the firm admin sees them in the list.
      const user = await ctx.prisma.user.create({
        data: {
          tenantId: ctx.tenantId,
          email: input.email,
          name: input.name,
          phone: input.phone ?? null,
          // Placeholder hash — overwritten when the invitee accepts.
          passwordHash: null,
          roleId: input.roleId,
          branchId: input.branchId ?? null,
          status: 'INVITED',
          isBillable: input.isBillable,
          invitedAt: new Date(),
        },
      });
      await ctx.prisma.invite.create({
        data: {
          tenantId: ctx.tenantId,
          email: input.email,
          roleId: input.roleId,
          branchId: input.branchId ?? null,
          invitedBy: ctx.session.sub,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
        },
      });

      const inviteUrl = `${env.APP_URL.replace(/\/$/, '')}/invite/${token.raw}`;
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const result = await sendUserInviteEmail({
          to: input.email,
          recipientName: input.name,
          firmName: inviter.tenant.displayName,
          roleName: role.name,
          inviterName: inviter.name,
          inviteUrl,
          ttlDays: INVITE_TTL_DAYS,
          brand: tenantEmailBrand(inviter.tenant),
        });
        emailSent = result.ok;
        if (!result.ok) {
          emailError = result.error ?? 'unknown';
          logger.error({ to: input.email, err: emailError }, 'user invite send failed');
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
        logger.error({ err: emailError }, 'user invite throw');
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.invite',
          targetType: 'User',
          targetId: user.id,
          payload: { email: input.email, roleId: input.roleId, branchId: input.branchId ?? null, emailSent },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      // Seat sync — INVITED billable users count toward the seat quantity.
      await syncSeats(ctx.prisma, ctx.tenantId);

      return { userId: user.id, inviteUrl, emailSent, emailError };
    }),

  resendInvite: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, status: 'INVITED', deletedAt: null },
        include: { role: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND', message: 'No pending invite for this user' });
      if (ctx.scope === 'branch' && u.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      const inviter = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.sub },
        include: { tenant: true },
      });
      if (!inviter) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const token = makeInviteToken();
      // Replace existing unaccepted invite token (single-flight per user).
      await ctx.prisma.invite.deleteMany({
        where: { tenantId: ctx.tenantId, email: u.email, acceptedAt: null },
      });
      await ctx.prisma.invite.create({
        data: {
          tenantId: ctx.tenantId,
          email: u.email,
          roleId: u.roleId,
          branchId: u.branchId,
          invitedBy: ctx.session.sub,
          tokenHash: token.hash,
          expiresAt: token.expiresAt,
        },
      });

      const inviteUrl = `${env.APP_URL.replace(/\/$/, '')}/invite/${token.raw}`;
      let emailSent = false;
      let emailError: string | undefined;
      try {
        const result = await sendUserInviteEmail({
          to: u.email,
          recipientName: u.name,
          firmName: inviter.tenant.displayName,
          roleName: u.role.name,
          inviterName: inviter.name,
          inviteUrl,
          ttlDays: INVITE_TTL_DAYS,
          brand: tenantEmailBrand(inviter.tenant),
        });
        emailSent = result.ok;
        if (!result.ok) emailError = result.error ?? 'unknown';
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.invite.resend',
          targetType: 'User',
          targetId: u.id,
          payload: { emailSent },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, inviteUrl, emailSent, emailError };
    }),

  /** Self-only — fetch + update the signed-in user's notification toggles. */
  getNotificationPrefs: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.scope !== 'firm') return null;
    const u = await ctx.prisma.user.findUnique({
      where: { id: ctx.session.sub },
      select: { notificationPrefs: true },
    });
    return u?.notificationPrefs ?? null;
  }),

  updateNotificationPrefs: protectedProcedure
    .input(
      z.object({
        email: z.object({
          leadAssigned: z.boolean(),
          appointmentReminder: z.boolean(),
          caseStatus: z.boolean(),
          billingReceipt: z.boolean(),
          weeklyDigest: z.boolean(),
        }),
        sms: z.object({
          appointmentReminder: z.boolean(),
          leadUrgent: z.boolean(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.scope !== 'firm') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Firm-only' });
      }
      await ctx.prisma.user.update({
        where: { id: ctx.session.sub },
        data: { notificationPrefs: input },
      });
      return { ok: true };
    }),

  update: requirePermission('users', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        phone: z.string().max(40).nullable().optional(),
        isBillable: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch' && before.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      await ctx.prisma.user.update({
        where: { id: input.id },
        data: {
          name: input.name ?? before.name,
          phone: input.phone === undefined ? before.phone : input.phone,
          isBillable: input.isBillable ?? before.isBillable,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.update',
          targetType: 'User',
          targetId: input.id,
          payload: input as object,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      // isBillable change moves the seat count.
      if (input.isBillable !== undefined && input.isBillable !== before.isBillable) {
        await syncSeats(ctx.prisma, ctx.tenantId);
      }
      return { ok: true };
    }),

  changeRole: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid(), roleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [u, role] = await Promise.all([
        ctx.prisma.user.findFirst({
          where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
          include: { role: true },
        }),
        ctx.prisma.role.findFirst({ where: { id: input.roleId, tenantId: ctx.tenantId } }),
      ]);
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!role) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Role not in this firm' });
      if (ctx.scope === 'branch') {
        if (u.branchId !== ctx.perms.branchId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
        }
        if (u.role.name === 'FIRM_ADMIN' || role.name === 'FIRM_ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Branch managers cannot change FIRM_ADMIN assignments.',
          });
        }
      }
      if (u.roleId === input.roleId) return { ok: true };
      // Prevent demoting the last FIRM_ADMIN of a tenant.
      if (u.role.name === 'FIRM_ADMIN' && role.name !== 'FIRM_ADMIN') {
        const otherAdmins = await ctx.prisma.user.count({
          where: {
            tenantId: ctx.tenantId,
            role: { name: 'FIRM_ADMIN' },
            id: { not: u.id },
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (otherAdmins === 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Cannot demote the only firm admin. Promote another user first.',
          });
        }
      }
      await ctx.prisma.user.update({ where: { id: u.id }, data: { roleId: input.roleId } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.changeRole',
          targetType: 'User',
          targetId: u.id,
          payload: { from: u.role.name, to: role.name },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  changeBranch: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid(), branchId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch') {
        // Branch managers can only move users in/out of their own branch.
        const intoBranch = input.branchId ?? null;
        if (intoBranch !== ctx.perms.branchId && u.branchId !== ctx.perms.branchId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
        }
      }
      if (input.branchId) {
        const branch = await ctx.prisma.branch.findFirst({
          where: { id: input.branchId, tenantId: ctx.tenantId, isActive: true },
        });
        if (!branch) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Branch not in this firm' });
      }
      await ctx.prisma.user.update({ where: { id: u.id }, data: { branchId: input.branchId } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.changeBranch',
          targetType: 'User',
          targetId: u.id,
          payload: { from: u.branchId, to: input.branchId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  disable: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        include: { role: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch' && (u.branchId !== ctx.perms.branchId || u.role.name === 'FIRM_ADMIN')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      if (u.role.name === 'FIRM_ADMIN') {
        const otherAdmins = await ctx.prisma.user.count({
          where: {
            tenantId: ctx.tenantId,
            role: { name: 'FIRM_ADMIN' },
            id: { not: u.id },
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (otherAdmins === 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Cannot disable the only firm admin.',
          });
        }
      }
      await ctx.prisma.user.update({ where: { id: u.id }, data: { status: 'DISABLED' } });
      await ctx.prisma.session.updateMany({
        where: { userId: u.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.disable',
          targetType: 'User',
          targetId: u.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      await syncSeats(ctx.prisma, ctx.tenantId);
      return { ok: true };
    }),

  enable: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, status: 'DISABLED', deletedAt: null },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch' && u.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      await ctx.prisma.user.update({
        where: { id: u.id },
        data: { status: u.passwordHash ? 'ACTIVE' : 'INVITED' },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.enable',
          targetType: 'User',
          targetId: u.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      await syncSeats(ctx.prisma, ctx.tenantId);
      return { ok: true };
    }),

  /**
   * Admin reset of a user's 2FA. Wipes the TOTP secret AND deletes every
   * passkey. The user must re-enroll on next sign-in. Used when a user
   * loses their authenticator device.
   *
   * Requires users.write since it's effectively credential admin. Audit
   * logs the action; the affected user will get a security email when
   * they next sign in (and email-OTP is the only remaining factor).
   */
  resetTwoFactor: requirePermission('users', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch' && u.branchId !== ctx.perms.branchId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      const [, deletedKeys] = await Promise.all([
        ctx.prisma.user.update({
          where: { id: u.id },
          data: { twoFASecret: null },
        }),
        ctx.prisma.passkey.deleteMany({ where: { userId: u.id } }),
      ]);
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.2fa.reset',
          targetType: 'User',
          targetId: u.id,
          payload: { passkeysRemoved: deletedKeys.count },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, passkeysRemoved: deletedKeys.count };
    }),

  delete: requirePermission('users', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const u = await ctx.prisma.user.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, deletedAt: null },
        include: { role: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      if (ctx.scope === 'branch' && (u.branchId !== ctx.perms.branchId || u.role.name === 'FIRM_ADMIN')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      if (u.role.name === 'FIRM_ADMIN') {
        const otherAdmins = await ctx.prisma.user.count({
          where: {
            tenantId: ctx.tenantId,
            role: { name: 'FIRM_ADMIN' },
            id: { not: u.id },
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (otherAdmins === 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Cannot delete the only firm admin.',
          });
        }
      }
      await ctx.prisma.user.update({
        where: { id: u.id },
        data: { deletedAt: new Date(), status: 'DISABLED' },
      });
      await ctx.prisma.session.updateMany({
        where: { userId: u.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.invite.deleteMany({
        where: { tenantId: ctx.tenantId, email: u.email, acceptedAt: null },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'user.delete',
          targetType: 'User',
          targetId: u.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      await syncSeats(ctx.prisma, ctx.tenantId);
      return { ok: true };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.scope === 'platform') {
      const u = await ctx.prisma.platformUser.findUnique({ where: { id: ctx.session.sub } });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        kind: 'platform' as const,
        id: u.id,
        email: u.email,
        name: u.name,
        isSuperadmin: u.isSuperadmin,
        twoFAEnrolled: !!u.twoFASecret,
      };
    }
    if (ctx.session.scope === 'firm' && ctx.session.tenantId) {
      const u = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.sub },
        include: { role: true, branch: true, tenant: true },
      });
      if (!u) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        kind: 'firm' as const,
        id: u.id,
        email: u.email,
        name: u.name,
        twoFAEnrolled: !!u.twoFASecret,
        role: { id: u.role.id, name: u.role.name, permissions: u.role.permissions },
        branch: u.branch ? { id: u.branch.id, name: u.branch.name } : null,
        tenant: {
          id: u.tenant.id,
          slug: u.tenant.slug,
          displayName: u.tenant.displayName,
          branding: u.tenant.branding,
          announcement: u.tenant.announcement,
          featureFlags: u.tenant.featureFlags,
        },
      };
    }
    throw new TRPCError({ code: 'BAD_REQUEST' });
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(120).optional(), phone: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.session.scope === 'platform') {
        return ctx.prisma.platformUser.update({
          where: { id: ctx.session.sub },
          data: { name: input.name },
        });
      }
      return ctx.prisma.user.update({ where: { id: ctx.session.sub }, data: input });
    }),

  passkeyList: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.passkey.findMany({
      where: passkeyOwnerWhere(ctx.session),
      select: {
        id: true,
        deviceType: true,
        transports: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  passkeyDelete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.passkey.findFirst({
        where: { id: input.id, ...passkeyOwnerWhere(ctx.session) },
      });
      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.passkey.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
