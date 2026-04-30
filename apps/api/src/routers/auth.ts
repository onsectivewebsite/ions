import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  beginTotpEnroll,
  verifyTotp,
  generateEmailOtp,
  verifyOtp,
  buildRegistrationOptions,
  verifyRegistration,
  buildAuthenticationOptions,
  verifyAuthentication,
  type AccessClaims,
} from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { sendOtpEmail, sendPasswordResetEmail, sendSecurityEventEmail, type SecurityEventKind } from '@onsecboad/email';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const env = loadEnv();

/**
 * Generate 10 recovery codes in the format `xxxx-xxxx` (4-4, lowercase
 * alphanumeric, dash separator). 8 chars × ~32 entropy ≈ 40 bits per
 * code — good for a printed backup that's only useful with the
 * password also.
 */
function generateRecoveryCodes(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 10; i++) {
    const left = randomBytes(3).toString('base64url').slice(0, 4).toLowerCase();
    const right = randomBytes(3).toString('base64url').slice(0, 4).toLowerCase();
    out.push(`${left}-${right}`);
  }
  return out;
}

/* ─── Auth ticket model ────────────────────────────────────────────────────
 * After step-1 password check, we hand the client a short-lived "ticket"
 * stored in Redis describing who passed step 1. Step 2 (TOTP / email OTP)
 * verifies the ticket then mints the real session.
 * ──────────────────────────────────────────────────────────────────────── */

type Ticket =
  | { kind: 'platform'; userId: string; methods: ('totp' | 'email_otp')[] }
  | { kind: 'firm'; userId: string; tenantId: string; roleId: string; branchId: string | null; methods: ('totp' | 'email_otp')[] };

const TICKET_TTL = 5 * 60;

async function makeTicket(t: Ticket): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await redis.set(`auth:ticket:${id}`, JSON.stringify(t), 'EX', TICKET_TTL);
  return id;
}

async function readTicket(id: string): Promise<Ticket | null> {
  const raw = await redis.get(`auth:ticket:${id}`);
  return raw ? (JSON.parse(raw) as Ticket) : null;
}

async function consumeTicket(id: string): Promise<void> {
  await redis.del(`auth:ticket:${id}`);
}

async function emitSession(ctx: { prisma: import('@onsecboad/db').PrismaClient; ip: string; userAgent?: string | undefined }, claims: AccessClaims) {
  const access = await signAccessToken(claims, env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SEC);
  const refresh = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_SEC * 1000);
  await ctx.prisma.session.create({
    data: {
      userId: claims.scope === 'firm' ? claims.sub : null,
      platformUserId: claims.scope === 'platform' ? claims.sub : null,
      refreshTokenHash: refresh.hash,
      device: ctx.userAgent ?? 'unknown',
      ip: ctx.ip,
      expiresAt,
    },
  });
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    accessExpiresAt: access.expiresAt.toISOString(),
  };
}

const FAIL_LOCKOUT_KEY = (email: string) => `auth:fail:${email.toLowerCase()}`;
const FAIL_LIMIT = 5;
const FAIL_WINDOW = 60;
const LOCK_DURATION = 15 * 60;

async function bumpFail(email: string): Promise<{ count: number; justLocked: boolean }> {
  const key = FAIL_LOCKOUT_KEY(email);
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, FAIL_WINDOW);
  const justLocked = n === FAIL_LIMIT;
  if (n >= FAIL_LIMIT) await redis.expire(key, LOCK_DURATION);
  return { count: n, justLocked };
}

async function isLocked(email: string): Promise<boolean> {
  const n = await redis.get(FAIL_LOCKOUT_KEY(email));
  return n !== null && Number(n) >= FAIL_LIMIT;
}

type Recipient = {
  to: string;
  name?: string;
  brand: { productName?: string; primaryHex?: string; logoUrl?: string | null };
};

async function recipientForPlatform(
  prisma: import('@onsecboad/db').PrismaClient,
  userId: string,
): Promise<Recipient | null> {
  const u = await prisma.platformUser.findUnique({ where: { id: userId } });
  if (!u) return null;
  return { to: u.email, name: u.name, brand: {} };
}

async function recipientForFirmUser(
  prisma: import('@onsecboad/db').PrismaClient,
  userId: string,
): Promise<Recipient | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
  if (!u) return null;
  const b = (u.tenant.branding as Record<string, unknown> | null | undefined) ?? {};
  return {
    to: u.email,
    name: u.name,
    brand: {
      productName: u.tenant.displayName,
      primaryHex: typeof b.customPrimary === 'string' ? b.customPrimary : undefined,
      logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
    },
  };
}

async function fireSecurityEvent(
  r: Recipient,
  kind: SecurityEventKind,
  ctx: {
    ip: string;
    userAgent?: string | undefined;
    resetUrl?: string;
    email?: string;
    reasons?: string[];
  },
): Promise<void> {
  const result = await sendSecurityEventEmail({
    to: r.to,
    kind,
    recipientName: r.name,
    brand: r.brand,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    at: new Date(),
    resetUrl: ctx.resetUrl,
    email: ctx.email,
    reasons: ctx.reasons,
  });
  if (!result.ok) {
    logger.error({ to: r.to, kind, err: result.error }, 'security event email failed');
  } else {
    logger.info({ to: r.to, kind, dryRun: result.dryRun }, 'security event email sent');
  }
}

// ─── Anomaly detection ─────────────────────────────────────────────────────

/** Tiny user-agent → "Browser on OS" labeller. Avoids a runtime dep. */
function describeUserAgent(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua) && !/Chromium\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

function deviceFingerprint(ua: string | undefined, ip: string): string {
  return createHash('sha256').update(`${ua ?? ''}|${ip}`).digest('hex');
}

const KNOWN_DEVICES_KEY = (userId: string) => `auth:known-devices:${userId}`;
const KNOWN_COUNTRIES_KEY = (userId: string) => `auth:known-countries:${userId}`;

type LoginContext = {
  anomalous: boolean;
  reasons: string[];
  newDevice: boolean;
  newCountry: boolean;
  concurrent: { device: string; ip: string } | null;
  fingerprint: string;
};

/**
 * Evaluate whether this sign-in looks unusual. Three triggers, any one of which
 * marks the login anomalous and produces a reason line for the alert email.
 *
 * Must run BEFORE emitSession so the "concurrent session" check sees only
 * pre-existing sessions, not the one we're about to create.
 */
async function evaluateLoginContext(
  prisma: import('@onsecboad/db').PrismaClient,
  userId: string,
  scope: 'platform' | 'firm',
  reqCtx: { ip: string; userAgent?: string | undefined; country: string | null },
): Promise<LoginContext> {
  const fingerprint = deviceFingerprint(reqCtx.userAgent, reqCtx.ip);
  const reasons: string[] = [];

  // 1. New device (UA + IP combo we've never seen for this user)
  const knownDevice = await redis.sismember(KNOWN_DEVICES_KEY(userId), fingerprint);
  const newDevice = knownDevice === 0;
  if (newDevice) {
    // First-ever login is also "new" but isn't anomalous — only flag if the
    // user already has at least one known device.
    const count = await redis.scard(KNOWN_DEVICES_KEY(userId));
    if (count > 0) reasons.push(`New device: ${describeUserAgent(reqCtx.userAgent)} (${reqCtx.ip})`);
  }

  // 2. New country — only when Cloudflare gave us a country header
  let newCountry = false;
  if (reqCtx.country) {
    const knownCountry = await redis.sismember(KNOWN_COUNTRIES_KEY(userId), reqCtx.country);
    newCountry = knownCountry === 0;
    if (newCountry) {
      const count = await redis.scard(KNOWN_COUNTRIES_KEY(userId));
      if (count > 0) reasons.push(`New country: ${reqCtx.country}`);
    }
  }

  // 3. Concurrent session — any non-revoked, non-expired session already exists
  const where =
    scope === 'platform'
      ? { platformUserId: userId, revokedAt: null, expiresAt: { gt: new Date() } }
      : { userId, revokedAt: null, expiresAt: { gt: new Date() } };
  const existing = await prisma.session.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    select: { device: true, ip: true },
  });
  const concurrent = existing ? { device: existing.device, ip: existing.ip } : null;
  if (concurrent) {
    reasons.push(`Another session is already active on ${describeUserAgent(concurrent.device)} (${concurrent.ip})`);
  }

  return {
    anomalous: reasons.length > 0,
    reasons,
    newDevice,
    newCountry,
    concurrent,
    fingerprint,
  };
}

async function rememberLoginContext(
  userId: string,
  fingerprint: string,
  country: string | null,
): Promise<void> {
  await redis.sadd(KNOWN_DEVICES_KEY(userId), fingerprint);
  if (country) await redis.sadd(KNOWN_COUNTRIES_KEY(userId), country);
}

export const authRouter = router({
  signIn: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (await isLocked(input.email)) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many failed attempts. Try later.' });
      }

      // Look up first so we can email the real account holder on a failed attempt.
      // Firm-side filter excludes users whose tenant has been deleted/canceled/
      // suspended — they can't sign in at all. The error message stays generic
      // so we don't leak tenant state to attackers.
      const platformUser = await ctx.prisma.platformUser.findUnique({ where: { email: input.email } });
      const firmUser = platformUser
        ? null
        : await ctx.prisma.user.findFirst({
            where: {
              email: input.email,
              status: 'ACTIVE',
              deletedAt: null,
              tenant: { deletedAt: null, status: 'ACTIVE' },
            },
          });

      const matchedRecipient: Recipient | null = platformUser
        ? { to: platformUser.email, name: platformUser.name, brand: {} }
        : firmUser
          ? await recipientForFirmUser(ctx.prisma, firmUser.id)
          : null;

      if (platformUser && platformUser.passwordHash && (await verifyPassword(platformUser.passwordHash, input.password))) {
        const methods: ('totp' | 'email_otp')[] = platformUser.twoFASecret ? ['totp', 'email_otp'] : ['email_otp'];
        const ticket = await makeTicket({ kind: 'platform', userId: platformUser.id, methods });
        return { ticket, methods };
      }
      if (firmUser && firmUser.passwordHash && (await verifyPassword(firmUser.passwordHash, input.password))) {
        const methods: ('totp' | 'email_otp')[] = firmUser.twoFASecret ? ['totp', 'email_otp'] : ['email_otp'];
        const ticket = await makeTicket({
          kind: 'firm',
          userId: firmUser.id,
          tenantId: firmUser.tenantId,
          roleId: firmUser.roleId,
          branchId: firmUser.branchId,
          methods,
        });
        return { ticket, methods };
      }

      const fail = await bumpFail(input.email);
      await ctx.prisma.auditLog.create({
        data: {
          actorId: '00000000-0000-0000-0000-000000000000',
          actorType: 'SYSTEM',
          action: 'auth.signin.fail',
          targetType: 'Email',
          payload: { email: input.email },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      // Email the real account holder, if any. Skipped for unknown emails so we
      // don't leak existence and don't spam unrelated mailboxes.
      if (matchedRecipient) {
        if (fail.justLocked) {
          await fireSecurityEvent(matchedRecipient, 'account_locked', {
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        } else {
          await fireSecurityEvent(matchedRecipient, 'login_fail', {
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
    }),

  requestEmailOtp: publicProcedure
    .input(z.object({ ticket: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const t = await readTicket(input.ticket);
      if (!t) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Ticket expired' });

      // Two-tier dedupe:
      //   1. Short 5-second lock absorbs React strict-mode double-mounts and
      //      accidental double-clicks (auth:otp-lock:* — separate key).
      //   2. The OTP key itself is overwritten on each legitimate send so an
      //      explicit Resend (after the 5s window) invalidates the old code.
      const lockKey = `auth:otp-lock:${input.ticket}`;
      const lockAcquired = await redis.set(lockKey, '1', 'EX', 5, 'NX');
      if (!lockAcquired) {
        // Recent send within the last 5s — treat as already sent.
        ctx.log.info({ ticket: input.ticket }, 'OTP request deduped (within 5s)');
        return { ok: true, emailSent: true };
      }

      const otpKey = `auth:otp:${input.ticket}`;
      const otp = generateEmailOtp(6);
      await redis.set(otpKey, otp.hash, 'EX', 5 * 60);

      // Look up the recipient email + name + (firm) branding.
      let to: string | null = null;
      let name: string | undefined;
      let brand: { productName?: string; primaryHex?: string; logoUrl?: string | null } = {};
      if (t.kind === 'platform') {
        const u = await ctx.prisma.platformUser.findUnique({ where: { id: t.userId } });
        to = u?.email ?? null;
        name = u?.name;
      } else {
        const u = await ctx.prisma.user.findUnique({
          where: { id: t.userId },
          include: { tenant: true },
        });
        to = u?.email ?? null;
        name = u?.name;
        const b = (u?.tenant.branding as Record<string, unknown> | null | undefined) ?? {};
        brand = {
          productName: u?.tenant.displayName,
          primaryHex: typeof b.customPrimary === 'string' ? b.customPrimary : undefined,
          logoUrl: typeof b.logoUrl === 'string' ? b.logoUrl : null,
        };
      }
      if (!to) {
        await redis.del(otpKey);
        await redis.del(lockKey);
        logger.warn({ ticket: input.ticket }, 'OTP requested but recipient not found');
        // Don't signal "not found" to the caller — keep the response shape
        // identical to a successful send to avoid account enumeration.
        return { ok: true, emailSent: true };
      }

      const result = await sendOtpEmail({ to, code: otp.code, ttlMinutes: 5, recipientName: name, brand });
      if (!result.ok) {
        // Send failed — clear both keys so the user can retry immediately
        // without waiting for the 5s lock to lapse.
        await redis.del(otpKey);
        await redis.del(lockKey);
        logger.error({ to, err: result.error }, 'OTP email send failed');
        return { ok: true, emailSent: false, emailError: result.error ?? 'unknown' };
      }
      logger.info({ to, dryRun: result.dryRun, messageId: result.messageId }, 'OTP email sent');
      return { ok: true, emailSent: true };
    }),

  verify2FA: publicProcedure
    .input(
      z.object({
        ticket: z.string().min(1),
        code: z.string().min(4),
        method: z.enum(['totp', 'email_otp', 'recovery_code']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await readTicket(input.ticket);
      if (!t) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Ticket expired' });

      let ok = false;
      if (input.method === 'totp') {
        const secret =
          t.kind === 'platform'
            ? (await ctx.prisma.platformUser.findUnique({ where: { id: t.userId } }))?.twoFASecret
            : (await ctx.prisma.user.findUnique({ where: { id: t.userId } }))?.twoFASecret;
        if (!secret) throw new TRPCError({ code: 'BAD_REQUEST', message: 'TOTP not enrolled' });
        ok = verifyTotp(secret, input.code);
      } else if (input.method === 'recovery_code') {
        // Recovery codes only exist for firm users.
        if (t.kind !== 'firm') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Recovery codes not supported here' });
        }
        const candidate = input.code.trim().toLowerCase();
        const codes = await ctx.prisma.twoFactorRecoveryCode.findMany({
          where: { userId: t.userId, usedAt: null },
        });
        for (const c of codes) {
          if (await verifyPassword(c.codeHash, candidate)) {
            await ctx.prisma.twoFactorRecoveryCode.update({
              where: { id: c.id },
              data: { usedAt: new Date() },
            });
            ok = true;
            break;
          }
        }
      } else {
        const hash = await redis.get(`auth:otp:${input.ticket}`);
        if (!hash) throw new TRPCError({ code: 'BAD_REQUEST', message: 'OTP not requested or expired' });
        ok = verifyOtp(input.code, hash);
      }
      if (!ok) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid code' });

      await consumeTicket(input.ticket);
      await redis.del(`auth:otp:${input.ticket}`);

      const claims: AccessClaims =
        t.kind === 'platform'
          ? { sub: t.userId, scope: 'platform' }
          : {
              sub: t.userId,
              scope: 'firm',
              tenantId: t.tenantId,
              roleId: t.roleId,
              branchId: t.branchId ?? undefined,
            };

      // Evaluate anomalies BEFORE creating the new session so the
      // "concurrent session" check only sees pre-existing sessions.
      const loginCtx = await evaluateLoginContext(ctx.prisma, t.userId, t.kind, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        country: ctx.country,
      });

      const session = await emitSession(ctx, claims);
      await (t.kind === 'platform'
        ? ctx.prisma.platformUser.update({ where: { id: t.userId }, data: { lastLoginAt: new Date() } })
        : ctx.prisma.user.update({ where: { id: t.userId }, data: { lastLoginAt: new Date() } }));
      // Clear the failed-attempt counter so honest users aren't a step closer to lockout.
      const recipient =
        t.kind === 'platform'
          ? await recipientForPlatform(ctx.prisma, t.userId)
          : await recipientForFirmUser(ctx.prisma, t.userId);
      if (recipient) await redis.del(FAIL_LOCKOUT_KEY(recipient.to));
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: t.kind === 'firm' ? t.tenantId : null,
          actorId: t.userId,
          actorType: t.kind === 'platform' ? 'PLATFORM' : 'USER',
          action: loginCtx.anomalous ? 'auth.signin.success.anomalous' : 'auth.signin.success',
          targetType: 'Session',
          payload: loginCtx.anomalous ? { reasons: loginCtx.reasons } : undefined,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      if (recipient) {
        if (loginCtx.anomalous) {
          await fireSecurityEvent(recipient, 'unauthorized_login', {
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            reasons: loginCtx.reasons,
          });
        } else {
          await fireSecurityEvent(recipient, 'login_success', {
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }
      // Remember the device + country for future anomaly checks.
      await rememberLoginContext(t.userId, loginCtx.fingerprint, ctx.country);
      return session;
    }),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.session.updateMany({
      where: {
        OR: [
          { userId: ctx.session.scope === 'firm' ? ctx.session.sub : undefined },
          { platformUserId: ctx.session.scope === 'platform' ? ctx.session.sub : undefined },
        ],
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }),

  totpBeginEnroll: protectedProcedure.mutation(async ({ ctx }) => {
    const u =
      ctx.session.scope === 'platform'
        ? await ctx.prisma.platformUser.findUnique({ where: { id: ctx.session.sub } })
        : await ctx.prisma.user.findUnique({ where: { id: ctx.session.sub } });
    if (!u) throw new TRPCError({ code: 'UNAUTHORIZED' });
    return beginTotpEnroll(u.email);
  }),

  totpConfirmEnroll: protectedProcedure
    .input(z.object({ secret: z.string().min(16), code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      if (!verifyTotp(input.secret, input.code)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Code did not match' });
      }
      const isPlatform = ctx.session.scope === 'platform';
      if (isPlatform) {
        await ctx.prisma.platformUser.update({ where: { id: ctx.session.sub }, data: { twoFASecret: input.secret } });
        return { ok: true, recoveryCodes: [] };
      }
      await ctx.prisma.user.update({
        where: { id: ctx.session.sub },
        data: { twoFASecret: input.secret },
      });
      // Generate 10 single-use recovery codes. Stored hashed; the user sees
      // each plaintext exactly once.
      const codes = generateRecoveryCodes();
      await ctx.prisma.twoFactorRecoveryCode.deleteMany({
        where: { userId: ctx.session.sub },
      });
      await ctx.prisma.twoFactorRecoveryCode.createMany({
        data: await Promise.all(
          codes.map(async (c) => ({
            userId: ctx.session.sub,
            codeHash: await hashPassword(c),
          })),
        ),
      });
      return { ok: true, recoveryCodes: codes };
    }),

  /**
   * Regenerate the recovery code set. Wipes old codes (used or unused) and
   * returns 10 fresh ones. Print them, then no one — including support — can
   * read them again.
   */
  recoveryCodesRegenerate: protectedProcedure.mutation(async ({ ctx }) => {
    if (ctx.session.scope !== 'firm') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Firm-only' });
    }
    const codes = generateRecoveryCodes();
    await ctx.prisma.twoFactorRecoveryCode.deleteMany({
      where: { userId: ctx.session.sub },
    });
    await ctx.prisma.twoFactorRecoveryCode.createMany({
      data: await Promise.all(
        codes.map(async (c) => ({
          userId: ctx.session.sub,
          codeHash: await hashPassword(c),
        })),
      ),
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.session.tenantId ?? null,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'auth.recoveryCodes.regenerate',
        targetType: 'User',
        targetId: ctx.session.sub,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { codes };
  }),

  /** Counts how many recovery codes remain unused. */
  recoveryCodesStatus: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.session.scope !== 'firm') return { remaining: 0, total: 0 };
    const [remaining, total] = await Promise.all([
      ctx.prisma.twoFactorRecoveryCode.count({
        where: { userId: ctx.session.sub, usedAt: null },
      }),
      ctx.prisma.twoFactorRecoveryCode.count({
        where: { userId: ctx.session.sub },
      }),
    ]);
    return { remaining, total };
  }),

  // ─── Passkeys ────────────────────────────────────────────────────────────
  // Discoverable-credential flow on sign-in: client sends no credential id;
  // browser shows the account picker; we identify the user from the
  // credential id returned by the authenticator. 2FA is still required after
  // a successful passkey login (matches the docs/04-security policy).
  passkeyBeginAuthentication: publicProcedure.mutation(async () => {
    const opts = await buildAuthenticationOptions(
      { rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN },
      [],
    );
    const challengeId = randomBytes(24).toString('base64url');
    await redis.set(`auth:pk:auth:${challengeId}`, opts.challenge, 'EX', 5 * 60);
    return { challengeId, options: opts };
  }),

  passkeyFinishAuthentication: publicProcedure
    .input(z.object({ challengeId: z.string().min(1), response: z.any() }))
    .mutation(async ({ ctx, input }) => {
      const expectedChallenge = await redis.get(`auth:pk:auth:${input.challengeId}`);
      if (!expectedChallenge) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Challenge expired' });

      const credIdB64 = String(input.response?.id ?? '');
      if (!credIdB64) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Missing credential id' });
      const credIdBytes = Buffer.from(credIdB64, 'base64url');
      const passkey = await ctx.prisma.passkey.findUnique({ where: { credentialId: credIdBytes } });
      if (!passkey) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unknown passkey' });

      const verification = await verifyAuthentication(
        { rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN },
        expectedChallenge,
        input.response,
        {
          credentialID: credIdB64,
          credentialPublicKey: new Uint8Array(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports as never,
        },
      );
      if (!verification.verified) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Verification failed' });

      await ctx.prisma.passkey.update({
        where: { id: passkey.id },
        data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
      });
      await redis.del(`auth:pk:auth:${input.challengeId}`);

      // Mint a 2FA ticket — passkey replaces the password step, not 2FA.
      let ticket: string;
      let methods: ('totp' | 'email_otp')[];
      if (passkey.platformUserId) {
        const u = await ctx.prisma.platformUser.findUnique({ where: { id: passkey.platformUserId } });
        if (!u) throw new TRPCError({ code: 'UNAUTHORIZED' });
        methods = u.twoFASecret ? ['totp', 'email_otp'] : ['email_otp'];
        ticket = await makeTicket({ kind: 'platform', userId: u.id, methods });
      } else if (passkey.userId) {
        const u = await ctx.prisma.user.findUnique({ where: { id: passkey.userId } });
        if (!u) throw new TRPCError({ code: 'UNAUTHORIZED' });
        methods = u.twoFASecret ? ['totp', 'email_otp'] : ['email_otp'];
        ticket = await makeTicket({
          kind: 'firm',
          userId: u.id,
          tenantId: u.tenantId,
          roleId: u.roleId,
          branchId: u.branchId,
          methods,
        });
      } else {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return { ticket, methods };
    }),

  passkeyBeginRegistration: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.sub;
    const isPlatform = ctx.session.scope === 'platform';
    const user = isPlatform
      ? await ctx.prisma.platformUser.findUnique({ where: { id: userId } })
      : await ctx.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });

    const existing = await ctx.prisma.passkey.findMany({
      where: isPlatform ? { platformUserId: userId } : { userId },
      select: { credentialId: true },
    });
    const opts = await buildRegistrationOptions(
      { rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN },
      { id: user.id, name: user.email, displayName: user.name },
      existing.map((p) => Buffer.from(p.credentialId)),
    );
    const challengeId = randomBytes(24).toString('base64url');
    await redis.set(
      `auth:pk:reg:${challengeId}`,
      JSON.stringify({ challenge: opts.challenge, userId, isPlatform }),
      'EX',
      5 * 60,
    );
    return { challengeId, options: opts };
  }),

  passkeyFinishRegistration: protectedProcedure
    .input(z.object({ challengeId: z.string().min(1), response: z.any() }))
    .mutation(async ({ ctx, input }) => {
      const raw = await redis.get(`auth:pk:reg:${input.challengeId}`);
      if (!raw) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge expired' });
      const stored = JSON.parse(raw) as { challenge: string; userId: string; isPlatform: boolean };
      if (stored.userId !== ctx.session.sub) throw new TRPCError({ code: 'FORBIDDEN' });

      const verification = await verifyRegistration(
        { rpName: env.WEBAUTHN_RP_NAME, rpId: env.WEBAUTHN_RP_ID, origin: env.WEBAUTHN_ORIGIN },
        stored.challenge,
        input.response,
      );
      if (!verification.verified || !verification.registrationInfo) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Verification failed' });
      }
      const info = verification.registrationInfo;
      const credIdBytes = Buffer.from(info.credentialID, 'base64url');
      const transports =
        (input.response?.response?.transports as string[] | undefined) ?? [];

      await ctx.prisma.passkey.create({
        data: {
          userId: stored.isPlatform ? null : stored.userId,
          platformUserId: stored.isPlatform ? stored.userId : null,
          credentialId: credIdBytes,
          publicKey: Buffer.from(info.credentialPublicKey),
          counter: info.counter,
          deviceType: info.credentialDeviceType ?? 'unknown',
          transports,
        },
      });
      await redis.del(`auth:pk:reg:${input.challengeId}`);
      return { ok: true };
    }),

  // ─── Password reset ─────────────────────────────────────────────────────
  // Token: random base64url, 30-min TTL, hashed in Redis. Single-use.
  //
  // SECURITY NOTE: This response includes `emailSent` (true on successful send,
  // false on SMTP failure). The "unknown email" branch returns emailSent=true
  // so an attacker can't tell unknown-account from successful-send — they
  // CAN, however, distinguish "your account exists but our SMTP is down" from
  // "either way nothing happened." That's a small but real account-enumeration
  // surface. Acceptable for now per Rishabh's call (he wants visibility on
  // SMTP failures during dev). Tighten by always returning emailSent=true here
  // once SMTP is reliable in prod.
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const platformUser = await ctx.prisma.platformUser.findUnique({ where: { email: input.email } });
      const firmUser = platformUser
        ? null
        : await ctx.prisma.user.findFirst({
            where: {
              email: input.email,
              status: 'ACTIVE',
              deletedAt: null,
              tenant: { deletedAt: null, status: 'ACTIVE' },
            },
          });
      const recipient: Recipient | null = platformUser
        ? { to: platformUser.email, name: platformUser.name, brand: {} }
        : firmUser
          ? await recipientForFirmUser(ctx.prisma, firmUser.id)
          : null;
      if (!recipient) {
        ctx.log.info({ email: input.email }, 'password reset for unknown email — silent ok');
        // Return emailSent=true to avoid signalling "this account doesn't exist".
        return { ok: true, emailSent: true };
      }

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const payload = platformUser
        ? { kind: 'platform' as const, userId: platformUser.id }
        : { kind: 'firm' as const, userId: firmUser!.id };
      await redis.set(`auth:pwreset:${tokenHash}`, JSON.stringify(payload), 'EX', 30 * 60);

      const resetUrl = `${env.APP_URL.replace(/\/$/, '')}/reset-password?token=${rawToken}`;
      const result = await sendPasswordResetEmail({
        to: recipient.to,
        resetUrl,
        ttlMinutes: 30,
        brand: recipient.brand,
      });
      let emailSent = result.ok;
      let emailError: string | undefined;
      if (!result.ok) {
        emailError = result.error ?? 'unknown';
        logger.error({ to: recipient.to, err: emailError }, 'reset email send failed');
      } else {
        logger.info({ to: recipient.to, dryRun: result.dryRun }, 'reset email sent');
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: payload.kind === 'firm' ? firmUser!.tenantId : null,
          actorId: payload.userId,
          actorType: payload.kind === 'platform' ? 'PLATFORM' : 'USER',
          action: 'auth.password_reset.request',
          targetType: 'User',
          payload: { emailSent, emailError: emailError ?? null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, emailSent, emailError };
    }),

  completePasswordReset: publicProcedure
    .input(z.object({ token: z.string().min(20), password: z.string().min(8).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = createHash('sha256').update(input.token).digest('hex');
      const key = `auth:pwreset:${tokenHash}`;
      const raw = await redis.get(key);
      if (!raw) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This reset link is invalid or expired. Request a new one.' });
      const payload = JSON.parse(raw) as { kind: 'platform' | 'firm'; userId: string };
      // Single-use — delete first so a parallel attempt can't reuse it.
      await redis.del(key);

      const newHash = await hashPassword(input.password);
      if (payload.kind === 'platform') {
        await ctx.prisma.platformUser.update({ where: { id: payload.userId }, data: { passwordHash: newHash } });
      } else {
        await ctx.prisma.user.update({ where: { id: payload.userId }, data: { passwordHash: newHash } });
      }

      // Revoke every active session — force re-auth everywhere.
      await ctx.prisma.session.updateMany({
        where: {
          OR: [
            { userId: payload.kind === 'firm' ? payload.userId : undefined },
            { platformUserId: payload.kind === 'platform' ? payload.userId : undefined },
          ],
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });

      const recipient =
        payload.kind === 'platform'
          ? await recipientForPlatform(ctx.prisma, payload.userId)
          : await recipientForFirmUser(ctx.prisma, payload.userId);
      if (recipient) {
        await redis.del(FAIL_LOCKOUT_KEY(recipient.to));
        await fireSecurityEvent(recipient, 'password_reset_completed', {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      await ctx.prisma.auditLog.create({
        data: {
          actorId: payload.userId,
          actorType: payload.kind === 'platform' ? 'PLATFORM' : 'USER',
          action: 'auth.password_reset.complete',
          targetType: 'User',
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  /**
   * Authenticated in-app password change. Verifies the current password
   * before swapping the hash. Does NOT revoke other sessions — that's
   * different from a forced reset. Fires a security-event email so the
   * user notices any unauthorized change.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'New password must differ from the current one.',
        });
      }
      const isPlatform = ctx.session.scope === 'platform';
      const userId = ctx.session.sub;
      const user = isPlatform
        ? await ctx.prisma.platformUser.findUnique({ where: { id: userId } })
        : await ctx.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const ok = await verifyPassword(user.passwordHash, input.currentPassword);
      if (!ok) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Current password is incorrect.',
        });
      }
      const newHash = await hashPassword(input.newPassword);
      if (isPlatform) {
        await ctx.prisma.platformUser.update({
          where: { id: userId },
          data: { passwordHash: newHash },
        });
      } else {
        await ctx.prisma.user.update({
          where: { id: userId },
          data: { passwordHash: newHash },
        });
      }
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.session.scope === 'firm' ? (ctx.session.tenantId ?? null) : null,
          actorId: userId,
          actorType: isPlatform ? 'PLATFORM' : 'USER',
          action: 'auth.password.change',
          targetType: isPlatform ? 'PlatformUser' : 'User',
          targetId: userId,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      const recipient = isPlatform
        ? await recipientForPlatform(ctx.prisma, userId)
        : await recipientForFirmUser(ctx.prisma, userId);
      if (recipient) {
        await fireSecurityEvent(recipient, 'password_changed', {
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }
      return { ok: true };
    }),

  /**
   * In-app email change. Verifies current password, swaps the email,
   * fires a notice to the OLD address so an attacker can't quietly
   * change it to lock the user out. Skips a full email-verification
   * round-trip in v1 — the password gate is the safeguard.
   */
  changeEmail: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newEmail: z.string().email().max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isPlatform = ctx.session.scope === 'platform';
      const userId = ctx.session.sub;
      const newEmail = input.newEmail.toLowerCase().trim();
      const user = isPlatform
        ? await ctx.prisma.platformUser.findUnique({ where: { id: userId } })
        : await ctx.prisma.user.findUnique({ where: { id: userId } });
      if (!user || !user.passwordHash) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const ok = await verifyPassword(user.passwordHash, input.currentPassword);
      if (!ok) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Current password is incorrect.',
        });
      }
      const oldEmail = user.email;
      if (oldEmail.toLowerCase() === newEmail) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'New email matches the current one.',
        });
      }
      // Uniqueness check inside scope.
      if (isPlatform) {
        const taken = await ctx.prisma.platformUser.findUnique({ where: { email: newEmail } });
        if (taken) {
          throw new TRPCError({ code: 'CONFLICT', message: 'That email is already in use.' });
        }
        await ctx.prisma.platformUser.update({
          where: { id: userId },
          data: { email: newEmail },
        });
      } else {
        const tenantId = ctx.session.tenantId!;
        const taken = await ctx.prisma.user.findFirst({
          where: { tenantId, email: newEmail, deletedAt: null },
        });
        if (taken) {
          throw new TRPCError({ code: 'CONFLICT', message: 'That email is already in use.' });
        }
        await ctx.prisma.user.update({
          where: { id: userId },
          data: { email: newEmail },
        });
      }
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.session.scope === 'firm' ? (ctx.session.tenantId ?? null) : null,
          actorId: userId,
          actorType: isPlatform ? 'PLATFORM' : 'USER',
          action: 'auth.email.change',
          targetType: isPlatform ? 'PlatformUser' : 'User',
          targetId: userId,
          payload: { from: oldEmail, to: newEmail },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      // Notify the OLD address so the user notices an unauthorised change.
      const recipient = isPlatform
        ? await recipientForPlatform(ctx.prisma, userId)
        : await recipientForFirmUser(ctx.prisma, userId);
      if (recipient) {
        // Override the recipient so the notice goes to the old email.
        await fireSecurityEvent(
          { ...recipient, to: oldEmail },
          'password_changed',
          { ip: ctx.ip, userAgent: ctx.userAgent },
        );
      }
      return { ok: true, email: newEmail };
    }),

  // Used only by ops to seed a password without going through invite flow (Phase 0).
  _devSetPassword: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      if (env.NODE_ENV !== 'development') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const hash = await hashPassword(input.password);
      const u = await ctx.prisma.user.findFirst({ where: { email: input.email } });
      if (u) {
        await ctx.prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
        return { ok: true, kind: 'firm' as const };
      }
      const p = await ctx.prisma.platformUser.findUnique({ where: { email: input.email } });
      if (p) {
        await ctx.prisma.platformUser.update({ where: { id: p.id }, data: { passwordHash: hash } });
        return { ok: true, kind: 'platform' as const };
      }
      throw new TRPCError({ code: 'NOT_FOUND' });
    }),
});

export type AuthRouter = typeof authRouter;
