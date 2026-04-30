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

  /**
   * Cross-tenant headline metrics for the platform dashboard. No date
   * range — these are point-in-time counters. MRR is computed from
   * active subscription rows × per-seat price × seat count, so
   * pricePerSeatCents must stay consistent on the Plan rows.
   */
  kpi: router({
    dashboard: platformProcedure.query(async ({ ctx }) => {
      const [
        firmsActive,
        firmsProvisioning,
        firmsSuspended,
        firmsCanceled,
        firmsOnTrial,
        seatsTotal,
        firmsByPlan,
      ] = await Promise.all([
        ctx.prisma.tenant.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        ctx.prisma.tenant.count({ where: { status: 'PROVISIONING', deletedAt: null } }),
        ctx.prisma.tenant.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
        ctx.prisma.tenant.count({ where: { status: 'CANCELED', deletedAt: null } }),
        ctx.prisma.tenant.count({
          where: {
            status: 'ACTIVE',
            deletedAt: null,
            trialEndsAt: { gt: new Date() },
          },
        }),
        ctx.prisma.tenant.aggregate({
          where: { status: 'ACTIVE', deletedAt: null },
          _sum: { seatCount: true },
        }),
        ctx.prisma.tenant.findMany({
          where: { status: 'ACTIVE', deletedAt: null },
          select: { seatCount: true, plan: { select: { code: true, pricePerSeatCents: true } } },
        }),
      ]);

      let mrrCents = 0n;
      const byPlan: Record<string, { firms: number; seats: number; mrrCents: bigint }> = {};
      for (const t of firmsByPlan) {
        if (!t.plan) continue;
        const code = t.plan.code;
        const seats = BigInt(t.seatCount);
        const subtotal = t.plan.pricePerSeatCents * seats;
        mrrCents += subtotal;
        if (!byPlan[code]) byPlan[code] = { firms: 0, seats: 0, mrrCents: 0n };
        byPlan[code].firms++;
        byPlan[code].seats += t.seatCount;
        byPlan[code].mrrCents += subtotal;
      }

      // BigInt isn't JSON-serializable; convert to number (cents fit easily).
      const mrr = Number(mrrCents);
      const planMix = Object.entries(byPlan).map(([code, v]) => ({
        code,
        firms: v.firms,
        seats: v.seats,
        mrrCents: Number(v.mrrCents),
      }));

      return {
        firmsActive,
        firmsProvisioning,
        firmsSuspended,
        firmsCanceled,
        firmsOnTrial,
        seatsTotal: seatsTotal._sum.seatCount ?? 0,
        mrrCents: mrr,
        arrCents: mrr * 12,
        planMix,
      };
    }),
  }),

  audit: router({
    list: platformProcedure
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          tenantId: z.string().uuid().optional(),
          action: z.string().max(120).optional(),
          actorType: z.enum(['PLATFORM', 'USER', 'CLIENT', 'SYSTEM']).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const where = {
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          ...(input.action ? { action: { contains: input.action } } : {}),
          ...(input.actorType ? { actorType: input.actorType } : {}),
        };
        const [items, total] = await Promise.all([
          ctx.prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 50,
            skip: (input.page - 1) * 50,
          }),
          ctx.prisma.auditLog.count({ where }),
        ]);
        return { items, total, page: input.page, pageSize: 50 };
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

  /**
   * Backup status (read-only). Lists objects in R2 under the backup
   * prefix. Backups are created by infra/scripts/pg_backup.sh on the
   * host (cron) and uploaded via rclone — this endpoint is purely for
   * verification. Restore is intentionally not in-app: it requires a
   * runbook step (infra/runbooks/restore.md).
   */
  backups: router({
    list: platformProcedure.query(async () => {
      const { listObjects, isDryRun } = await import('@onsecboad/r2');
      if (isDryRun()) {
        return {
          dryRun: true,
          items: [],
          newest: null,
        };
      }
      const items = await listObjects('backups/', 50);
      // Sort newest-first.
      const sorted = items
        .filter((o) => o.key)
        .sort((a, b) => {
          const ta = a.lastModified?.getTime() ?? 0;
          const tb = b.lastModified?.getTime() ?? 0;
          return tb - ta;
        });
      const newest = sorted[0]?.lastModified?.toISOString() ?? null;
      return {
        dryRun: false,
        items: sorted.map((o) => ({
          key: o.key,
          size: o.size,
          lastModified: o.lastModified?.toISOString() ?? null,
        })),
        newest,
      };
    }),
  }),

  /** Cross-firm billing queries. */
  billing: router({
    overview: platformProcedure.query(async ({ ctx }) => {
      const [recentInvoices, totalsByStatus] = await Promise.all([
        ctx.prisma.subscriptionInvoice.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { tenant: { select: { id: true, displayName: true, slug: true } } },
        }),
        ctx.prisma.subscriptionInvoice.groupBy({
          by: ['status'],
          _count: { _all: true },
          _sum: { amountCents: true },
        }),
      ]);
      return {
        recentInvoices: recentInvoices.map((i) => ({
          id: i.id,
          stripeInvoiceId: i.stripeInvoiceId,
          tenant: i.tenant,
          amountCents: Number(i.amountCents),
          currency: i.currency,
          periodStart: i.periodStart,
          periodEnd: i.periodEnd,
          seatCount: i.seatCount,
          status: i.status,
          createdAt: i.createdAt,
        })),
        totalsByStatus: totalsByStatus.map((g) => ({
          status: g.status,
          count: g._count._all,
          amountCents: Number(g._sum.amountCents ?? 0n),
        })),
      };
    }),
  }),
});
