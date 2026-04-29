/**
 * AI usage dashboard — Phase 8.1.
 *
 * Tenant-wide today: every Anthropic call is logged in AiUsage with
 * tenantId. Branch-scoped filtering will land if/when we let branch
 * managers see only their branch's spend (right now `aiSettings.read`
 * is firm-admin-only and there's no `aiUsage` resource — branches see
 * the master view via the dashboard tile).
 */
import { z } from 'zod';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const RANGE = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .default({});

function defaultRange(input: { from?: string; to?: string }): { from: Date; to: Date } {
  const to = input.to ? new Date(input.to) : new Date();
  const from = input.from
    ? new Date(input.from)
    : (() => {
        const d = new Date(to);
        d.setDate(d.getDate() - 30);
        return d;
      })();
  return { from, to };
}

export const aiUsageRouter = router({
  // Headline tiles + by-feature breakdown for /settings/ai/usage.
  summary: requirePermission('aiSettings', 'read')
    .input(RANGE)
    .query(async ({ ctx, input }) => {
      const { from, to } = defaultRange(input);
      const where = {
        tenantId: ctx.tenantId,
        createdAt: { gte: from, lte: to },
      };
      const [total, byFeature, byModel, byMode, count] = await Promise.all([
        ctx.prisma.aiUsage.aggregate({
          where,
          _sum: {
            inputTokens: true,
            cachedInputTokens: true,
            outputTokens: true,
            costCents: true,
          },
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['feature'],
          where,
          _sum: { costCents: true, inputTokens: true, outputTokens: true },
          _count: { _all: true },
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['model'],
          where,
          _sum: { costCents: true },
          _count: { _all: true },
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['mode'],
          where,
          _sum: { costCents: true },
          _count: { _all: true },
        }),
        ctx.prisma.aiUsage.count({ where }),
      ]);
      return {
        from,
        to,
        callCount: count,
        totals: {
          inputTokens: total._sum.inputTokens ?? 0,
          cachedInputTokens: total._sum.cachedInputTokens ?? 0,
          outputTokens: total._sum.outputTokens ?? 0,
          costCents: total._sum.costCents ?? 0,
        },
        byFeature: byFeature.map((g) => ({
          feature: g.feature,
          callCount: g._count._all,
          inputTokens: g._sum.inputTokens ?? 0,
          outputTokens: g._sum.outputTokens ?? 0,
          costCents: g._sum.costCents ?? 0,
        })),
        byModel: byModel.map((g) => ({
          model: g.model,
          callCount: g._count._all,
          costCents: g._sum.costCents ?? 0,
        })),
        byMode: byMode.map((g) => ({
          mode: g.mode,
          callCount: g._count._all,
          costCents: g._sum.costCents ?? 0,
        })),
      };
    }),

  // Recent calls — paginated table for the dashboard.
  list: requirePermission('aiSettings', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(100).default(50),
          feature: z.string().optional(),
          from: z.string().datetime().optional(),
          to: z.string().datetime().optional(),
        })
        .default({ page: 1, pageSize: 50 }),
    )
    .query(async ({ ctx, input }) => {
      const { from, to } = defaultRange(input);
      const where = {
        tenantId: ctx.tenantId,
        createdAt: { gte: from, lte: to },
        ...(input.feature ? { feature: input.feature } : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.aiUsage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          select: {
            id: true,
            feature: true,
            model: true,
            mode: true,
            inputTokens: true,
            cachedInputTokens: true,
            outputTokens: true,
            costCents: true,
            refType: true,
            refId: true,
            createdAt: true,
          },
        }),
        ctx.prisma.aiUsage.count({ where }),
      ]);
      return { items, total };
    }),
});
