/**
 * KPI / reports router. Aggregates Lead / CallLog / SmsLog over a date range.
 *
 * Permission: gated on `reports.read`. Branch-scoped users get their branch
 * automatically; tenant-scoped see firm-wide. We honour `ctx.scope` so the
 * aggregations match what the user is allowed to see.
 */
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const rangeSchema = z.object({
  // ISO-8601 dates. Default = last 30 days.
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  branchId: z.string().uuid().optional(),
});

function defaultRange(): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from, to };
}

export const kpiRouter = router({
  summary: requirePermission('reports', 'read')
    .input(rangeSchema)
    .query(async ({ ctx, input }) => {
      const { from: defFrom, to: defTo } = defaultRange();
      const from = input.from ? new Date(input.from) : defFrom;
      const to = input.to ? new Date(input.to) : defTo;

      // If the user's scope is `branch`, force-narrow to their branch
      // regardless of what they asked for.
      const branchFilter: { branchId?: string | null } = {};
      if (ctx.scope === 'branch' && ctx.perms.branchId) {
        branchFilter.branchId = ctx.perms.branchId;
      } else if (input.branchId) {
        branchFilter.branchId = input.branchId;
      }

      const leadWhere: Prisma.LeadWhereInput = {
        tenantId: ctx.tenantId,
        createdAt: { gte: from, lte: to },
        deletedAt: null,
        ...branchFilter,
      };
      const callWhere: Prisma.CallLogWhereInput = {
        tenantId: ctx.tenantId,
        startedAt: { gte: from, lte: to },
        ...(branchFilter.branchId
          ? { lead: { is: { branchId: branchFilter.branchId } } }
          : {}),
      };
      const smsWhere: Prisma.SmsLogWhereInput = {
        tenantId: ctx.tenantId,
        createdAt: { gte: from, lte: to },
        ...(branchFilter.branchId
          ? { lead: { is: { branchId: branchFilter.branchId } } }
          : {}),
      };

      const [
        leadsTotal,
        leadsBySource,
        leadsByStatus,
        leadsConverted,
        callsTotal,
        callsCompleted,
        smsTotal,
        smsInbound,
      ] = await Promise.all([
        ctx.prisma.lead.count({ where: leadWhere }),
        ctx.prisma.lead.groupBy({
          by: ['source'],
          where: leadWhere,
          _count: { _all: true },
        }),
        ctx.prisma.lead.groupBy({
          by: ['status'],
          where: leadWhere,
          _count: { _all: true },
        }),
        ctx.prisma.lead.count({ where: { ...leadWhere, status: 'CONVERTED' } }),
        ctx.prisma.callLog.count({ where: callWhere }),
        ctx.prisma.callLog.count({ where: { ...callWhere, status: 'completed' } }),
        ctx.prisma.smsLog.count({ where: smsWhere }),
        ctx.prisma.smsLog.count({ where: { ...smsWhere, direction: 'inbound' } }),
      ]);

      // Per-agent breakdown (call counts + lead conversions).
      const callsPerAgent = await ctx.prisma.callLog.groupBy({
        by: ['agentId'],
        where: { ...callWhere, agentId: { not: null } },
        _count: { _all: true },
        _sum: { durationSec: true },
      });
      const agentIds = callsPerAgent.map((r) => r.agentId).filter((x): x is string => !!x);
      const agents = agentIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: agentIds }, tenantId: ctx.tenantId },
            select: { id: true, name: true, email: true },
          })
        : [];
      const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

      const conversionsPerAgent = await ctx.prisma.lead.groupBy({
        by: ['assignedToId'],
        where: { ...leadWhere, status: 'CONVERTED', assignedToId: { not: null } },
        _count: { _all: true },
      });
      const conversionsByAgent = new Map(
        conversionsPerAgent.map((r) => [r.assignedToId!, r._count._all]),
      );

      const perAgent = callsPerAgent.map((r) => ({
        agentId: r.agentId!,
        agentName: agentNameById.get(r.agentId!) ?? 'Unknown',
        calls: r._count._all,
        totalDurationSec: r._sum.durationSec ?? 0,
        conversions: conversionsByAgent.get(r.agentId!) ?? 0,
      }));

      return {
        range: { from: from.toISOString(), to: to.toISOString() },
        leads: {
          total: leadsTotal,
          converted: leadsConverted,
          conversionRate: leadsTotal === 0 ? 0 : leadsConverted / leadsTotal,
          bySource: leadsBySource.map((r) => ({ source: r.source, count: r._count._all })),
          byStatus: leadsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
        },
        calls: {
          total: callsTotal,
          completed: callsCompleted,
          answerRate: callsTotal === 0 ? 0 : callsCompleted / callsTotal,
        },
        sms: {
          total: smsTotal,
          inbound: smsInbound,
        },
        perAgent: perAgent.sort((a, b) => b.calls - a.calls),
      };
    }),

  /**
   * Lightweight tile counters for the firm dashboard. Permission-free
   * (firmProcedure) so every staff user sees the same headline numbers.
   * Branch-scoped users still see only their branch via ctx.scope.
   */
  dashboard: firmProcedure.query(async ({ ctx }) => {
    const branchFilter: { branchId?: string } = {};
    if (ctx.scope === 'branch' && ctx.perms.branchId) {
      branchFilter.branchId = ctx.perms.branchId;
    }
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      openLeads,
      casesInFlight,
      callsThisWeek,
      pendingInvoiceAggregate,
      intakeRequestsSentThisWeek,
      intakeRequestsFilledThisWeek,
    ] = await Promise.all([
      ctx.prisma.lead.count({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: { in: ['NEW', 'CONTACTED', 'FOLLOWUP', 'INTERESTED', 'BOOKED'] },
          ...branchFilter,
        },
      }),
      ctx.prisma.case.count({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          status: {
            in: [
              'PENDING_RETAINER',
              'PENDING_RETAINER_SIGNATURE',
              'PENDING_DOCUMENTS',
              'PREPARING',
              'PENDING_LAWYER_APPROVAL',
              'SUBMITTED_TO_IRCC',
              'IN_REVIEW',
            ],
          },
          ...branchFilter,
        },
      }),
      ctx.prisma.callLog.count({
        where: {
          tenantId: ctx.tenantId,
          startedAt: { gte: weekAgo },
          ...(branchFilter.branchId
            ? { lead: { is: { branchId: branchFilter.branchId } } }
            : {}),
        },
      }),
      ctx.prisma.caseInvoice.aggregate({
        where: {
          tenantId: ctx.tenantId,
          status: { in: ['SENT', 'PARTIAL'] },
          ...(branchFilter.branchId
            ? { case: { is: { branchId: branchFilter.branchId } } }
            : {}),
        },
        _sum: { totalCents: true },
      }),
      ctx.prisma.intakeRequest.count({
        where: {
          tenantId: ctx.tenantId,
          createdAt: { gte: weekAgo },
        },
      }),
      ctx.prisma.intakeRequest.count({
        where: {
          tenantId: ctx.tenantId,
          createdAt: { gte: weekAgo },
          filledAt: { not: null },
        },
      }),
    ]);

    return {
      openLeads,
      casesInFlight,
      callsThisWeek,
      pendingInvoiceCents: pendingInvoiceAggregate._sum.totalCents ?? 0,
      intake: {
        sentThisWeek: intakeRequestsSentThisWeek,
        filledThisWeek: intakeRequestsFilledThisWeek,
      },
    };
  }),
});
