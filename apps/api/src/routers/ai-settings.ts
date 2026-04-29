/**
 * AI settings — Phase 8.1.
 *
 * Per-tenant configuration for AI features. Lazy-creates a defaults row
 * on first read so freshly-provisioned firms don't see a NOT_FOUND.
 *
 * RBAC: gated on the new `aiSettings` resource. By default only
 * FIRM_ADMIN has access (others fall through to false). Branch managers
 * can READ via the usage dashboard, but only firm admins can flip
 * toggles or change the budget.
 */
import { z } from 'zod';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { getAiSettings, monthToDateCostCents } from '../lib/ai-usage.js';

export const aiSettingsRouter = router({
  get: requirePermission('aiSettings', 'read').query(async ({ ctx }) => {
    const settings = await getAiSettings(ctx.prisma, ctx.tenantId);
    const mtd = await monthToDateCostCents(ctx.prisma, ctx.tenantId);
    return { ...settings, monthToDateCostCents: mtd };
  }),

  update: requirePermission('aiSettings', 'write')
    .input(
      z.object({
        enabled: z.boolean().optional(),
        classifyAuto: z.boolean().optional(),
        formFillEnabled: z.boolean().optional(),
        agentEnabled: z.boolean().optional(),
        preferredModel: z.string().min(2).max(80).optional(),
        // 0 = no cap; otherwise CAD cents.
        monthlyBudgetCents: z.number().int().min(0).max(10_000_000).optional(),
        redactionLevel: z.enum(['standard', 'strict']).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Lazy-create then update — same row guaranteed.
      await getAiSettings(ctx.prisma, ctx.tenantId);
      const updated = await ctx.prisma.aiSettings.update({
        where: { tenantId: ctx.tenantId },
        data: input,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'aiSettings.update',
          targetType: 'AiSettings',
          targetId: ctx.tenantId,
          payload: { changes: Object.keys(input) },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),
});
