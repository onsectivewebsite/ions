/**
 * Meta (Facebook) Lead Ads config — used by /settings/integrations/meta.
 * Per-tenant creds, encrypted in Tenant.meta JSON.
 */
import { z } from 'zod';
import {
  encryptMetaCreds,
  decryptMetaCreds,
  modeFor,
  type EncryptedMetaConfig,
} from '@onsecboad/meta';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

function maskTail(v: string | undefined | null): string | null {
  if (!v) return null;
  if (v.length <= 6) return v;
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

export const metaConfigRouter = router({
  get: requirePermission('settings', 'read').query(async ({ ctx }) => {
    const t = await ctx.prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { meta: true },
    });
    const enc = (t?.meta as unknown as EncryptedMetaConfig | null) ?? null;
    const decoded = decryptMetaCreds(enc);
    return {
      configured: !!decoded,
      mode: modeFor(decoded),
      pageId: decoded?.pageId ?? null,
      verifyTokenMasked: maskTail(decoded?.verifyToken),
      pageAccessTokenMasked: maskTail(decoded?.pageAccessToken),
      graphApiVersion: decoded?.graphApiVersion ?? 'v19.0',
    };
  }),

  update: requirePermission('settings', 'write')
    .input(
      z.object({
        appSecret: z.string().min(8).max(200).optional(),
        pageId: z.string().min(3).max(80),
        pageAccessToken: z.string().min(8).max(500).optional(),
        verifyToken: z.string().min(8).max(120).optional(),
        graphApiVersion: z.string().regex(/^v\d+\.\d+$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { meta: true },
      });
      const existing = decryptMetaCreds(
        (before?.meta as unknown as EncryptedMetaConfig | null) ?? null,
      );

      const appSecret = input.appSecret ?? existing?.appSecret ?? '';
      const pageAccessToken = input.pageAccessToken ?? existing?.pageAccessToken ?? '';
      const verifyToken = input.verifyToken ?? existing?.verifyToken ?? '';
      // appSecret + pageAccessToken can be left blank for dry-run.
      const encrypted = encryptMetaCreds({
        appSecret: appSecret || 'dummy_app_secret',
        pageId: input.pageId,
        pageAccessToken: pageAccessToken || 'dummy_page_access_token',
        verifyToken: verifyToken || 'dummy_verify_token',
        graphApiVersion: input.graphApiVersion ?? existing?.graphApiVersion ?? 'v19.0',
      });
      await ctx.prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: { meta: encrypted as unknown as Prisma.InputJsonValue },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'meta.config.update',
          targetType: 'Tenant',
          targetId: ctx.tenantId,
          payload: {
            pageId: input.pageId,
            secretChanged: !!input.appSecret,
            tokenChanged: !!input.pageAccessToken,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, mode: modeFor(decryptMetaCreds(encrypted)) };
    }),

  clear: requirePermission('settings', 'write').mutation(async ({ ctx }) => {
    await ctx.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { meta: Prisma.JsonNull },
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'meta.config.clear',
        targetType: 'Tenant',
        targetId: ctx.tenantId,
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return { ok: true };
  }),
});
