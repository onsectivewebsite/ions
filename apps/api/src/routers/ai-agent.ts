/**
 * AI agent — Phase 8.3.
 *
 * `runs({ caseId })` — recent runs on a case for the UI timeline.
 * `runNow({ caseId })` — staff-triggered manual run. The runMissingDocsAgent
 *  helper does its own gating (status / cooldown / settings / budget) and
 *  returns a structured `{ status, skipReason? }` payload, which we surface
 *  verbatim so the UI can display the exact reason a run was skipped.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { runMissingDocsAgent } from '../lib/ai-agent.js';

export const aiAgentRouter = router({
  runs: requirePermission('ai', 'read')
    .input(z.object({ caseId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.prisma.aiAgentRun.findMany({
        where: { tenantId: ctx.tenantId, caseId: c.id },
        orderBy: { startedAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          mode: true,
          status: true,
          skipReason: true,
          costCents: true,
          steps: true,
          result: true,
          kickedOffById: true,
          startedAt: true,
          endedAt: true,
        },
      });
    }),

  runNow: requirePermission('ai', 'write')
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return runMissingDocsAgent(ctx.prisma, c.id, ctx.session.sub);
    }),
});
