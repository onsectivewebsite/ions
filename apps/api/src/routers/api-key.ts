/**
 * Firm API keys — used by external systems (the firm's own website forms,
 * Zapier, integrations) to call the public `/api/v1/leads/ingest` endpoint.
 *
 * Only FIRM_ADMIN can issue keys. The plaintext key is shown ONCE on
 * creation; after that, only the hash is stored.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

export const SCOPE_OPTIONS = ['leads:write', 'leads:read'] as const;
const scopeSchema = z.enum(SCOPE_OPTIONS);

const KEY_PREFIX = 'osk';

export function makeApiKey(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('base64url'); // 32 chars
  const plaintext = `${KEY_PREFIX}_${raw}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  // Visible prefix for the UI list — first 8 chars after `osk_`.
  const prefix = `${KEY_PREFIX}_${raw.slice(0, 8)}`;
  return { plaintext, hash, prefix };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export const apiKeyRouter = router({
  list: requirePermission('settings', 'read').query(async ({ ctx }) => {
    const items = await ctx.prisma.apiKey.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });
    return items;
  }),

  create: requirePermission('settings', 'write')
    .input(
      z.object({
        name: z.string().min(2).max(80),
        scopes: z.array(scopeSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conflict = await ctx.prisma.apiKey.findFirst({
        where: { tenantId: ctx.tenantId, name: input.name, revokedAt: null },
      });
      if (conflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An active key with that name already exists.',
        });
      }
      const key = makeApiKey();
      const row = await ctx.prisma.apiKey.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          keyHash: key.hash,
          keyPrefix: key.prefix,
          scopes: input.scopes,
          createdBy: ctx.session.sub,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'apiKey.create',
          targetType: 'ApiKey',
          targetId: row.id,
          payload: { name: row.name, scopes: row.scopes, prefix: row.keyPrefix },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      // Plaintext key is returned ONCE — never stored, never shown again.
      return {
        id: row.id,
        name: row.name,
        scopes: row.scopes,
        prefix: row.keyPrefix,
        plaintextKey: key.plaintext,
      };
    }),

  revoke: requirePermission('settings', 'write')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const k = await ctx.prisma.apiKey.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!k) throw new TRPCError({ code: 'NOT_FOUND' });
      if (k.revokedAt) {
        return { ok: true }; // already revoked, idempotent
      }
      await ctx.prisma.apiKey.update({
        where: { id: k.id },
        data: { revokedAt: new Date() },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'apiKey.revoke',
          targetType: 'ApiKey',
          targetId: k.id,
          payload: { name: k.name },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
