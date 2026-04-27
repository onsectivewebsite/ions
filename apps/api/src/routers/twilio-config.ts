/**
 * Twilio config CRUD — used by /settings/integrations/twilio.
 * Per-tenant creds, stored encrypted in Tenant.twilio JSON.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  encryptTwilioCreds,
  decryptTwilioCreds,
  modeFor,
  type EncryptedTwilioConfig,
} from '@onsecboad/twilio';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

export const twilioConfigRouter = router({
  // Returns the masked view — auth token is never sent back to the client.
  get: requirePermission('settings', 'read').query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { twilio: true },
    });
    const enc = (t?.twilio as unknown as EncryptedTwilioConfig | null) ?? null;
    const decoded = decryptTwilioCreds(enc);
    return {
      configured: !!decoded,
      mode: modeFor(decoded),
      // Mask secrets — only show last 4 chars of SID, never auth token
      accountSidMasked: decoded ? maskSid(decoded.accountSid) : null,
      twimlAppSidMasked: decoded?.twimlAppSid ? maskSid(decoded.twimlAppSid) : null,
      phoneNumber: decoded?.phoneNumber ?? null,
      recordOutbound: decoded?.recordOutbound ?? true,
    };
  }),

  update: requirePermission('settings', 'write')
    .input(
      z.object({
        accountSid: z.string().regex(/^AC[a-zA-Z0-9]{32}$|^AC_dummy.*$/, 'Account SID must start with AC').optional(),
        authToken: z.string().min(8).max(200).optional(),
        twimlAppSid: z
          .string()
          .regex(/^AP[a-zA-Z0-9]{32}$|^AP_dummy.*$/, 'TwiML App SID must start with AP')
          .nullable()
          .optional(),
        phoneNumber: z.string().regex(/^\+\d{6,15}$/, 'Phone number must be E.164 (e.g. +14165551212)'),
        recordOutbound: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Load existing creds (so we can preserve auth token on partial updates).
      const before = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { twilio: true },
      });
      const existing = decryptTwilioCreds(
        (before?.twilio as unknown as EncryptedTwilioConfig | null) ?? null,
      );

      const accountSid = input.accountSid ?? existing?.accountSid ?? '';
      const authToken = input.authToken ?? existing?.authToken ?? '';
      if (!accountSid || !authToken) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'accountSid and authToken are required (at least once).',
        });
      }
      const twimlAppSid =
        input.twimlAppSid === null
          ? undefined
          : input.twimlAppSid ?? existing?.twimlAppSid;
      const encrypted = encryptTwilioCreds({
        accountSid,
        authToken,
        twimlAppSid,
        phoneNumber: input.phoneNumber,
        recordOutbound: input.recordOutbound,
      });
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { twilio: encrypted as unknown as Prisma.InputJsonValue },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'twilio.config.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: {
            phoneNumber: input.phoneNumber,
            recordOutbound: input.recordOutbound,
            authTokenChanged: !!input.authToken,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, mode: modeFor(decryptTwilioCreds(encrypted)) };
    }),

  clear: requirePermission('settings', 'write').mutation(async ({ ctx }) => {
    await ctx.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { twilio: Prisma.JsonNull },
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'twilio.config.clear',
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: true };
  }),
});

function maskSid(sid: string): string {
  if (sid.length < 6) return sid;
  return `${sid.slice(0, 2)}…${sid.slice(-4)}`;
}
