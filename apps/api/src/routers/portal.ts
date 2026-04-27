/**
 * Client portal router. Two surfaces in one file because the surface area
 * is small and tightly coupled:
 *
 *   - Auth (publicProcedure): signIn, completeSetup, signOut, me.
 *   - Data (clientProcedure): cases, case detail.
 *
 * The "admin invites a client to the portal" mutation lives separately on
 * the firm-scoped clientPortal router (different auth scope).
 *
 * Auth model: email + password only. Setup token (32-byte random,
 * sha256-hashed) sent via email. Re-uses the same JWT machinery as firm
 * auth — just scope='client' and sub=ClientPortalAccount.id.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
} from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { sendEmail } from '@onsecboad/email';
import { router, publicProcedure, clientProcedure, firmProcedure } from '../trpc.js';
import { logger } from '../logger.js';

const env = loadEnv();

const ACCESS_TTL_SEC = 60 * 60; // 1 hour

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

async function mintTokens(args: {
  prisma: import('@onsecboad/db').PrismaClient;
  accountId: string;
  tenantId: string;
  ip: string;
  userAgent: string | undefined;
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const { token: accessToken, expiresAt } = await signAccessToken(
    { sub: args.accountId, scope: 'client', tenantId: args.tenantId },
    env.JWT_ACCESS_SECRET,
    ACCESS_TTL_SEC,
  );
  const { token: refresh, hash } = generateRefreshToken();
  const refreshExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await args.prisma.clientPortalSession.create({
    data: {
      accountId: args.accountId,
      refreshTokenHash: hash,
      device: args.userAgent ?? 'unknown',
      ip: args.ip,
      expiresAt: refreshExpires,
    },
  });
  // We don't return the refresh token to the client right now — the SPA
  // re-authenticates on access-token expiry by prompting for password.
  // Phase 6 can layer in refresh-flow if needed.
  void refresh;
  return { accessToken, expiresAt };
}

export const portalRouter = router({
  // ─── Auth ─────────────────────────────────────────────────────────────

  signIn: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Email is unique per (tenant, email) — but the client picks no
      // tenant on the sign-in form. Look up by email alone; if multiple
      // hits (impossible in practice unless the same client email exists
      // at two firms), we surface an error instead of guessing.
      const matches = await ctx.prisma.clientPortalAccount.findMany({
        where: { email: input.email },
        include: { tenant: { select: { status: true, deletedAt: true } } },
      });
      const valid = matches.filter(
        (m) =>
          m.status === 'ACTIVE' &&
          !m.tenant.deletedAt &&
          m.tenant.status !== 'CANCELED' &&
          m.tenant.status !== 'SUSPENDED',
      );
      if (valid.length === 0) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      // Phase 6 will resolve the firm-disambiguation case (let the user pick).
      // For now, take the first ACTIVE.
      const account = valid[0]!;
      const ok = account.passwordHash
        ? await verifyPassword(account.passwordHash, input.password)
        : false;
      if (!ok) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
      }
      await ctx.prisma.clientPortalAccount.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() },
      });
      const t = await mintTokens({
        prisma: ctx.prisma,
        accountId: account.id,
        tenantId: account.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      logger.info({ accountId: account.id, tenantId: account.tenantId }, 'client portal sign-in');
      return { accessToken: t.accessToken, expiresAt: t.expiresAt };
    }),

  signOut: clientProcedure.mutation(async ({ ctx }) => {
    // No specific session to revoke without the refresh-token plaintext;
    // token expiry handles the rest. We could revoke all sessions for
    // the account, but that breaks parallel devices.
    return { ok: true };
  }),

  me: clientProcedure.query(async ({ ctx }) => {
    const account = await ctx.prisma.clientPortalAccount.findUnique({
      where: { id: ctx.accountId },
      include: {
        client: { select: { firstName: true, lastName: true, phone: true, email: true, language: true } },
        tenant: { select: { displayName: true, branding: true } },
      },
    });
    if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
    return {
      email: account.email,
      lastLoginAt: account.lastLoginAt,
      client: account.client,
      tenant: account.tenant,
    };
  }),

  // ─── Setup (token-based, no auth) ─────────────────────────────────────

  setupPreview: publicProcedure
    .input(z.object({ token: z.string().min(20).max(200) }))
    .query(async ({ ctx, input }) => {
      const account = await ctx.prisma.clientPortalAccount.findFirst({
        where: { setupTokenHash: hashToken(input.token) },
        include: {
          tenant: { select: { displayName: true, branding: true, status: true, deletedAt: true } },
          client: { select: { firstName: true, lastName: true, phone: true } },
        },
      });
      if (!account) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite link is invalid or expired.' });
      }
      if (account.setupTokenExpiresAt && account.setupTokenExpiresAt < new Date()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite link has expired.' });
      }
      if (account.tenant.deletedAt || account.tenant.status === 'CANCELED') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Firm is no longer active.' });
      }
      return {
        email: account.email,
        client: account.client,
        firm: { displayName: account.tenant.displayName, branding: account.tenant.branding },
      };
    }),

  completeSetup: publicProcedure
    .input(
      z.object({
        token: z.string().min(20).max(200),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const account = await ctx.prisma.clientPortalAccount.findFirst({
        where: { setupTokenHash: hashToken(input.token) },
      });
      if (!account)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite link is invalid or expired.' });
      if (account.setupTokenExpiresAt && account.setupTokenExpiresAt < new Date())
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite link has expired.' });

      const passwordHash = await hashPassword(input.password);
      const now = new Date();
      const updated = await ctx.prisma.clientPortalAccount.update({
        where: { id: account.id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          joinedAt: now,
          setupTokenHash: null,
          setupTokenExpiresAt: null,
          lastLoginAt: now,
        },
      });
      const t = await mintTokens({
        prisma: ctx.prisma,
        accountId: updated.id,
        tenantId: updated.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: updated.tenantId,
          actorId: '00000000-0000-0000-0000-000000000000',
          actorType: 'SYSTEM',
          action: 'clientPortal.setupComplete',
          targetType: 'ClientPortalAccount',
          targetId: updated.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { accessToken: t.accessToken, expiresAt: t.expiresAt };
    }),

  // ─── Data ─────────────────────────────────────────────────────────────

  cases: clientProcedure.query(async ({ ctx }) => {
    return ctx.prisma.case.findMany({
      where: { tenantId: ctx.tenantId, clientId: ctx.clientId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        caseType: true,
        status: true,
        retainerFeeCents: true,
        totalFeeCents: true,
        amountPaidCents: true,
        feesCleared: true,
        irccFileNumber: true,
        irccDecision: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }),

  caseDetail: clientProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId, clientId: ctx.clientId, deletedAt: null },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });

      // Filter what the client is allowed to see — NO internal staff
      // notes/audit/IRCC raw entries. Surface lifecycle timestamps only.
      const [appointments, intake, irccLog] = await Promise.all([
        ctx.prisma.appointment.findMany({
          where: { tenantId: ctx.tenantId, clientId: ctx.clientId },
          orderBy: { scheduledAt: 'desc' },
          take: 20,
          select: {
            id: true,
            scheduledAt: true,
            durationMin: true,
            kind: true,
            caseType: true,
            status: true,
            outcome: true,
            provider: { select: { name: true } },
          },
        }),
        ctx.prisma.intakeSubmission.findMany({
          where: { tenantId: ctx.tenantId, clientId: ctx.clientId },
          orderBy: { submittedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            caseType: true,
            submittedAt: true,
            template: { select: { name: true } },
          },
        }),
        // Show client-friendly IRCC events: submission + decision, plus
        // any RFE that's been responded to. Don't surface raw notes the
        // staff put in — only type + occurredAt.
        ctx.prisma.irccCorrespondence.findMany({
          where: {
            tenantId: ctx.tenantId,
            caseId: c.id,
            type: {
              in: [
                'submission',
                'decision',
                'biometrics_requested',
                'biometrics_completed',
                'interview_scheduled',
                'interview_completed',
                'medical_requested',
                'medical_completed',
              ],
            },
          },
          orderBy: { occurredAt: 'desc' },
          select: { id: true, type: true, occurredAt: true },
        }),
      ]);

      return {
        id: c.id,
        caseType: c.caseType,
        status: c.status,
        retainerFeeCents: c.retainerFeeCents,
        totalFeeCents: c.totalFeeCents,
        amountPaidCents: c.amountPaidCents,
        feesCleared: c.feesCleared,
        irccFileNumber: c.irccFileNumber,
        irccDecision: c.irccDecision,
        irccPortalDate: c.irccPortalDate,
        // Lifecycle timestamps — drives the timeline on the client portal.
        retainerApprovedAt: c.retainerApprovedAt,
        retainerSignedAt: c.retainerSignedAt,
        documentsLockedAt: c.documentsLockedAt,
        lawyerApprovedAt: c.lawyerApprovedAt,
        submittedToIrccAt: c.submittedToIrccAt,
        completedAt: c.completedAt,
        appointments,
        intake,
        irccLog,
      };
    }),
});

// ─── Firm-scoped: invite-to-portal mutation (lives here for cohesion) ────

const SETUP_TOKEN_TTL_DAYS = 14;

export const clientPortalAdminRouter = router({
  // List portal accounts the firm has invited (handy on /clients/[id]).
  list: firmProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.prisma.clientPortalAccount.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(input?.clientId ? { clientId: input.clientId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { client: { select: { firstName: true, lastName: true, phone: true } } },
      });
    }),

  // Invite a client to the portal. Generates a setup token, emails it.
  // Re-running on an INVITED account refreshes the token + resends the email.
  invite: firmProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        email: z.string().email().optional(), // override; defaults to client.email
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await ctx.prisma.client.findFirst({
        where: { id: input.clientId, tenantId: ctx.tenantId, deletedAt: null },
        include: { tenant: { select: { displayName: true } } },
      });
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      const email = (input.email ?? client.email ?? '').trim();
      if (!email) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No email on the client; pass one explicitly.',
        });
      }

      const tokenPlain = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(tokenPlain);
      const expires = new Date();
      expires.setDate(expires.getDate() + SETUP_TOKEN_TTL_DAYS);

      const existing = await ctx.prisma.clientPortalAccount.findUnique({
        where: { clientId: client.id },
      });
      const account = existing
        ? await ctx.prisma.clientPortalAccount.update({
            where: { id: existing.id },
            data: {
              email,
              status: existing.status === 'DISABLED' ? 'INVITED' : existing.status,
              setupTokenHash: tokenHash,
              setupTokenExpiresAt: expires,
              invitedAt: new Date(),
            },
          })
        : await ctx.prisma.clientPortalAccount.create({
            data: {
              tenantId: ctx.tenantId,
              clientId: client.id,
              email,
              status: 'INVITED',
              setupTokenHash: tokenHash,
              setupTokenExpiresAt: expires,
              invitedAt: new Date(),
              invitedById: ctx.session.sub,
            },
          });

      const url = `${env.APP_URL}/portal/setup?token=${tokenPlain}`;
      const firmName = client.tenant.displayName;
      const recipientName =
        [client.firstName, client.lastName].filter(Boolean).join(' ') || 'there';

      try {
        await sendEmail({
          to: email,
          subject: `${firmName} — set up your client portal`,
          text: `Hello ${recipientName},\n\n${firmName} has invited you to your secure client portal.\n\nSet up your account here:\n${url}\n\nThis link expires in ${SETUP_TOKEN_TTL_DAYS} days. If you didn't expect this email, you can safely ignore it.\n\n— ${firmName}`,
          html: `<p>Hello ${recipientName},</p><p><strong>${firmName}</strong> has invited you to your secure client portal.</p><p><a href="${url}">Set up your account</a></p><p>This link expires in ${SETUP_TOKEN_TTL_DAYS} days. If you didn't expect this email, you can safely ignore it.</p><p>— ${firmName}</p>`,
        });
      } catch (e) {
        logger.warn({ err: e, accountId: account.id }, 'portal invite email failed');
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'clientPortal.invite',
          targetType: 'ClientPortalAccount',
          targetId: account.id,
          payload: { email, ttlDays: SETUP_TOKEN_TTL_DAYS, refresh: !!existing },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      return {
        accountId: account.id,
        email,
        plaintextToken: tokenPlain,
        publicUrl: url,
        status: account.status,
      };
    }),

  disable: firmProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const a = await ctx.prisma.clientPortalAccount.findFirst({
        where: { id: input.accountId, tenantId: ctx.tenantId },
      });
      if (!a) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.clientPortalAccount.update({
        where: { id: a.id },
        data: { status: 'DISABLED' },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'clientPortal.disable',
          targetType: 'ClientPortalAccount',
          targetId: a.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
