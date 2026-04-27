/**
 * TikTok Lead Gen config — used by /settings/integrations/tiktok.
 * Per-tenant creds, encrypted in Tenant.tiktok JSON.
 */
import { z } from 'zod';
import {
  encryptTikTokCreds,
  decryptTikTokCreds,
  modeFor,
  type EncryptedTikTokConfig,
} from '@onsecboad/tiktok';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

function maskTail(v: string | undefined | null): string | null {
  if (!v) return null;
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export const tiktokConfigRouter = router({
  get: requirePermission('settings', 'read').query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { tiktok: true },
    });
    const enc = (t?.tiktok as unknown as EncryptedTikTokConfig | null) ?? null;
    const decoded = decryptTikTokCreds(enc);
    return {
      configured: !!decoded,
      mode: modeFor(decoded),
      advertiserId: decoded?.advertiserId ?? null,
      accessTokenMasked: maskTail(decoded?.accessToken),
    };
  }),

  update: requirePermission('settings', 'write')
    .input(
      z.object({
        appSecret: z.string().min(8).max(200).optional(),
        advertiserId: z.string().min(3).max(80),
        accessToken: z.string().min(8).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { tiktok: true },
      });
      const existing = decryptTikTokCreds(
        (before?.tiktok as unknown as EncryptedTikTokConfig | null) ?? null,
      );

      const appSecret = input.appSecret ?? existing?.appSecret ?? '';
      const accessToken = input.accessToken ?? existing?.accessToken ?? '';
      const encrypted = encryptTikTokCreds({
        appSecret: appSecret || 'dummy_app_secret',
        advertiserId: input.advertiserId,
        accessToken: accessToken || 'dummy_access_token',
      });
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { tiktok: encrypted as unknown as Prisma.InputJsonValue },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'tiktok.config.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: {
            advertiserId: input.advertiserId,
            secretChanged: !!input.appSecret,
            tokenChanged: !!input.accessToken,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, mode: modeFor(decryptTikTokCreds(encrypted)) };
    }),

  clear: requirePermission('settings', 'write').mutation(async ({ ctx }) => {
    await ctx.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { tiktok: Prisma.JsonNull },
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'tiktok.config.clear',
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: true };
  }),
});
