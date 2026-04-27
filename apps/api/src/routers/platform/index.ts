import { z } from 'zod';
import { router, platformProcedure } from '../../trpc.js';
import { tenantPlatformRouter } from './tenant.js';
import { planPlatformRouter } from './plan.js';
import { userPlatformRouter } from './user.js';
import { reconcileAllSeats } from '../../jobs/seat-reconcile.js';

export const platformRouter = router({
  tenant: tenantPlatformRouter,
  plan: planPlatformRouter,
  user: userPlatformRouter,
  jobs: router({
    // Manual trigger for the daily seat-reconcile cron — same code path,
    // useful for verification and for running after an incident.
    reconcileSeats: platformProcedure.mutation(async () => reconcileAllSeats()),
  }),
  audit: router({
    list: platformProcedure
      .input(z.object({ page: z.number().int().min(1).default(1) }))
      .query(async ({ ctx, input }) => {
        const items = await ctx.prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
          skip: (input.page - 1) * 50,
        });
        return { items };
      }),

    byTenant: platformProcedure
      .input(z.object({ tenantId: z.string().uuid(), page: z.number().int().min(1).default(1) }))
      .query(async ({ ctx, input }) => {
        const items = await ctx.prisma.auditLog.findMany({
          where: { tenantId: input.tenantId },
          orderBy: { createdAt: 'desc' },
          take: 30,
          skip: (input.page - 1) * 30,
        });
        return { items };
      }),
  }),
});
