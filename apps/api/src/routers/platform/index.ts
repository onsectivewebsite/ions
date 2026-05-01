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
   * Email deliverability metrics. Returns counts + rates over the last N
   * days, both cross-firm and per-firm (top 10 by volume). Pulls from
   * the EmailLog rows that the webhook updates.
   */
  email: router({
    metrics: platformProcedure
      .input(z.object({ days: z.number().int().min(1).max(90).default(30) }))
      .query(async ({ ctx, input }) => {
        const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
        const [byStatus, perTenant, total] = await Promise.all([
          ctx.prisma.emailLog.groupBy({
            by: ['status'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
          }),
          ctx.prisma.emailLog.groupBy({
            by: ['tenantId'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
            orderBy: { _count: { tenantId: 'desc' } },
            take: 10,
          }),
          ctx.prisma.emailLog.count({ where: { createdAt: { gte: since } } }),
        ]);

        const tenantIds = perTenant.map((t) => t.tenantId);
        const tenants = await ctx.prisma.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, displayName: true, slug: true },
        });
        const tenantMap = new Map(tenants.map((t) => [t.id, t]));

        const perTenantStatus = await ctx.prisma.emailLog.groupBy({
          by: ['tenantId', 'status'],
          where: {
            createdAt: { gte: since },
            tenantId: { in: tenantIds },
          },
          _count: { _all: true },
        });
        const perTenantBuckets = new Map<string, Record<string, number>>();
        for (const r of perTenantStatus) {
          const m = perTenantBuckets.get(r.tenantId) ?? {};
          m[r.status] = r._count._all;
          perTenantBuckets.set(r.tenantId, m);
        }

        return {
          days: input.days,
          totalSent: total,
          byStatus: byStatus.map((g) => ({ status: g.status, count: g._count._all })),
          perTenant: perTenant.map((t) => {
            const tenant = tenantMap.get(t.tenantId);
            const buckets = perTenantBuckets.get(t.tenantId) ?? {};
            const sent = t._count._all;
            const delivered =
              (buckets.delivered ?? 0) + (buckets.opened ?? 0) + (buckets.clicked ?? 0);
            const bounced = buckets.bounced ?? 0;
            const complained = buckets.complained ?? 0;
            return {
              tenantId: t.tenantId,
              tenantName: tenant?.displayName ?? '—',
              sent,
              delivered,
              bounced,
              complained,
              bounceRate: sent === 0 ? 0 : bounced / sent,
              complaintRate: sent === 0 ? 0 : complained / sent,
            };
          }),
        };
      }),
  }),

  /**
   * Cross-firm abuse signals. Top-10 firms by failed logins (24h), SMS
   * volume (7d), AI cost (7d), and suppression-list growth (7d). Helps
   * spot bad actors before they impact others.
   */
  abuse: router({
    signals: platformProcedure.query(async ({ ctx }) => {
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [failedLogins, smsVolume, aiCost, suppressionGrowth] = await Promise.all([
        ctx.prisma.auditLog.groupBy({
          by: ['tenantId'],
          where: {
            createdAt: { gte: last24h },
            action: { contains: 'signIn.fail' },
            tenantId: { not: null },
          },
          _count: { _all: true },
          orderBy: { _count: { tenantId: 'desc' } },
          take: 10,
        }),
        ctx.prisma.smsLog.groupBy({
          by: ['tenantId'],
          where: { createdAt: { gte: last7d } },
          _count: { _all: true },
          orderBy: { _count: { tenantId: 'desc' } },
          take: 10,
        }),
        ctx.prisma.aiUsage.groupBy({
          by: ['tenantId'],
          where: { createdAt: { gte: last7d } },
          _sum: { costCents: true },
          orderBy: { _sum: { costCents: 'desc' } },
          take: 10,
        }),
        ctx.prisma.suppressionEntry.groupBy({
          by: ['tenantId'],
          where: { createdAt: { gte: last7d } },
          _count: { _all: true },
          orderBy: { _count: { tenantId: 'desc' } },
          take: 10,
        }),
      ]);

      const allTenantIds = new Set<string>();
      [failedLogins, smsVolume, aiCost, suppressionGrowth].forEach((arr) => {
        for (const r of arr) {
          if (r.tenantId) allTenantIds.add(r.tenantId);
        }
      });
      const tenants = await ctx.prisma.tenant.findMany({
        where: { id: { in: Array.from(allTenantIds) } },
        select: { id: true, displayName: true },
      });
      const nameOf = new Map(tenants.map((t) => [t.id, t.displayName]));

      return {
        failedLogins: failedLogins.map((r) => ({
          tenantId: r.tenantId!,
          tenantName: nameOf.get(r.tenantId!) ?? '—',
          count: r._count._all,
        })),
        smsVolume: smsVolume.map((r) => ({
          tenantId: r.tenantId,
          tenantName: nameOf.get(r.tenantId) ?? '—',
          count: r._count._all,
        })),
        aiCost: aiCost.map((r) => ({
          tenantId: r.tenantId,
          tenantName: nameOf.get(r.tenantId) ?? '—',
          costCents: Number(r._sum.costCents ?? 0),
        })),
        suppressionGrowth: suppressionGrowth.map((r) => ({
          tenantId: r.tenantId,
          tenantName: nameOf.get(r.tenantId) ?? '—',
          count: r._count._all,
        })),
      };
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

  /** Cross-firm billing queries + ops (refunds). */
  billing: router({
    /**
     * Issue a refund against a paid SubscriptionInvoice. Calls Stripe
     * (or dry-runs) and marks the local row VOID so the platform
     * billing page reflects it. Audit-logged.
     */
    refundInvoice: platformProcedure
      .input(
        z.object({
          invoiceId: z.string().uuid(),
          amountCents: z.number().int().min(1).max(1_000_000_00).optional(),
          reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional(),
          note: z.string().min(2).max(500),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const inv = await ctx.prisma.subscriptionInvoice.findUnique({
          where: { id: input.invoiceId },
        });
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
        if (inv.status !== 'PAID') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot refund an invoice in status ${inv.status}.`,
          });
        }
        const { refundInvoice: stripeRefund } = await import('@onsecboad/stripe');
        const result = await stripeRefund({
          invoiceId: inv.stripeInvoiceId,
          amountCents: input.amountCents,
          reason: input.reason,
        });
        await ctx.prisma.subscriptionInvoice.update({
          where: { id: inv.id },
          data: { status: 'VOID' },
        });
        await ctx.prisma.auditLog.create({
          data: {
            tenantId: inv.tenantId,
            actorId: ctx.session.sub,
            actorType: 'PLATFORM',
            action: 'platform.invoice.refund',
            targetType: 'SubscriptionInvoice',
            targetId: inv.id,
            payload: {
              stripeInvoiceId: inv.stripeInvoiceId,
              refundId: result.refundId,
              amountCents: result.amountCents,
              reason: input.reason ?? null,
              note: input.note,
              fullRefund: input.amountCents === undefined,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });
        return {
          ok: true,
          refundId: result.refundId,
          status: result.status,
          amountCents: result.amountCents,
        };
      }),

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
