/**
 * Campaign router. Phase 3.4 ships CRUD only — running campaigns
 * (broadcast SMS, email blast, audience filters) lands in Phase 4.
 *
 * Permissions: gated on `campaigns.read` / `campaigns.write` / `campaigns.delete`.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const campaignChannel = z.enum(['sms', 'email', 'meta', 'tiktok', 'manual']);

export const campaignRouter = router({
  list: requirePermission('campaigns', 'read').query(async ({ ctx }) => {
    return ctx.prisma.campaign.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        branchId: true,
      },
    });
  }),

  get: requirePermission('campaigns', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.campaign.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const counts = await ctx.prisma.lead.count({
        where: { tenantId: ctx.tenantId, sourceCampaignId: c.id },
      });
      return { ...c, leadsAttributed: counts };
    }),

  create: requirePermission('campaigns', 'write')
    .input(
      z.object({
        name: z.string().min(1).max(120),
        channel: campaignChannel,
        branchId: z.string().uuid().nullable().optional(),
        templateKey: z.string().max(60).optional(),
        body: z.string().max(4000).optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          channel: input.channel,
          branchId: input.branchId ?? null,
          templateKey: input.templateKey,
          body: input.body,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          status: 'draft',
          createdBy: ctx.session.sub,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'campaign.create',
          targetType: 'Campaign',
          targetId: c.id,
          payload: { name: c.name, channel: c.channel },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return c;
    }),

  update: requirePermission('campaigns', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        status: z.enum(['draft', 'scheduled', 'running', 'paused', 'completed']).optional(),
        branchId: z.string().uuid().nullable().optional(),
        templateKey: z.string().max(60).optional(),
        body: z.string().max(4000).optional(),
        startsAt: z.string().datetime().nullable().optional(),
        endsAt: z.string().datetime().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.campaign.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.CampaignUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.status !== undefined) data.status = input.status;
      if (input.branchId !== undefined) data.branchId = input.branchId;
      if (input.templateKey !== undefined) data.templateKey = input.templateKey;
      if (input.body !== undefined) data.body = input.body;
      if (input.startsAt !== undefined)
        data.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined)
        data.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      const c = await ctx.prisma.campaign.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'campaign.update',
          targetType: 'Campaign',
          targetId: c.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return c;
    }),

  delete: requirePermission('campaigns', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.campaign.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await ctx.prisma.campaign.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'campaign.delete',
          targetType: 'Campaign',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
