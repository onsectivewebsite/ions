/**
 * CASL suppression list — Phase 10.1.
 *
 * Per-tenant. Firm admins manage the list; branch managers can read.
 *
 *   suppression.list({ channel?, q? })
 *   suppression.add({ channel, value, reason?, source? })
 *   suppression.remove({ channel, value })
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { addSuppression, normaliseValue, removeSuppression } from '../lib/suppression.js';

const CHANNEL = z.enum(['sms', 'email']);
const SOURCE = z.enum(['unsubscribe', 'complaint', 'admin', 'bounce']);

export const suppressionRouter = router({
  list: requirePermission('suppression', 'read')
    .input(
      z.object({
        channel: CHANNEL.optional(),
        q: z.string().optional(),
        page: z.number().int().min(1).default(1),
      }).default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      const where = {
        tenantId: ctx.tenantId,
        ...(input.channel ? { channel: input.channel } : {}),
        ...(input.q
          ? { value: { contains: input.q.toLowerCase() } }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.suppressionEntry.findMany({
          where,
          orderBy: { addedAt: 'desc' },
          take: 50,
          skip: (input.page - 1) * 50,
        }),
        ctx.prisma.suppressionEntry.count({ where }),
      ]);
      return { items, total };
    }),

  add: requirePermission('suppression', 'write')
    .input(
      z.object({
        channel: CHANNEL,
        value: z.string().min(3).max(200),
        reason: z.string().max(500).optional(),
        source: SOURCE.default('admin'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const normalised = normaliseValue(input.channel, input.value);
      if (!normalised) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid value.' });
      }
      await addSuppression(ctx.prisma, {
        tenantId: ctx.tenantId,
        channel: input.channel,
        value: input.value,
        reason: input.reason ?? null,
        source: input.source,
        addedById: ctx.session.sub,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'suppression.add',
          targetType: 'SuppressionEntry',
          payload: { channel: input.channel, value: normalised, source: input.source },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true, normalised };
    }),

  remove: requirePermission('suppression', 'write')
    .input(z.object({ channel: CHANNEL, value: z.string().min(3).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await removeSuppression(ctx.prisma, ctx.tenantId, input.channel, input.value);
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'suppression.remove',
          targetType: 'SuppressionEntry',
          payload: {
            channel: input.channel,
            value: normaliseValue(input.channel, input.value),
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
