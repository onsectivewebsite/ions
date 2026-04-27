/**
 * Firm-scoped audit log access. Read-only — entries are written by the
 * procedures that perform mutations (branch.*, user.*, role.*, tenant.*).
 *
 * Slice 4 will add per-user-type filtering (BranchManager only sees own-branch
 * entries) once the resolveScope middleware is wired.
 */
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

export const auditRouter = router({
  list: requirePermission('audit', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          q: z.string().optional(),
          action: z.string().optional(),
          actorType: z.enum(['PLATFORM', 'USER', 'CLIENT', 'SYSTEM']).optional(),
          targetType: z.string().optional(),
          since: z.string().datetime().optional(),
          until: z.string().datetime().optional(),
        })
        .default({ page: 1 }),
    )
    .query(async ({ ctx, input }) => {
      // Branch-scoped readers see only entries whose actor is in their branch.
      // Tenant-level events (no actor in users table — PLATFORM/SYSTEM) are
      // out of scope for branch managers.
      let branchActorIds: string[] | null = null;
      if (ctx.scope === 'branch' && ctx.perms.branchId) {
        const branchUsers = await ctx.prisma.user.findMany({
          where: { tenantId: ctx.tenantId, branchId: ctx.perms.branchId },
          select: { id: true },
        });
        branchActorIds = branchUsers.map((u) => u.id);
        if (branchActorIds.length === 0) {
          return { items: [], total: 0, page: input.page, pageSize: 50 };
        }
      }
      const where: Prisma.AuditLogWhereInput = {
        tenantId: ctx.tenantId,
        ...(branchActorIds ? { actorId: { in: branchActorIds } } : {}),
        ...(input.action ? { action: { contains: input.action, mode: 'insensitive' as const } } : {}),
        ...(input.actorType ? { actorType: input.actorType } : {}),
        ...(input.targetType ? { targetType: input.targetType } : {}),
        ...(input.since || input.until
          ? {
              createdAt: {
                ...(input.since ? { gte: new Date(input.since) } : {}),
                ...(input.until ? { lte: new Date(input.until) } : {}),
              },
            }
          : {}),
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
      // Resolve actor names for the rows we just fetched. Platform actors have
      // no User record (they live in PlatformUser); we mark those as "Onsective".
      const userIds = Array.from(
        new Set(items.filter((i) => i.actorType === 'USER').map((i) => i.actorId)),
      );
      const users = userIds.length
        ? await ctx.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
      const userById = new Map(users.map((u) => [u.id, u]));
      return {
        items: items.map((i) => ({
          ...i,
          actor:
            i.actorType === 'USER'
              ? userById.get(i.actorId) ?? { id: i.actorId, name: 'Unknown user', email: null }
              : i.actorType === 'PLATFORM'
                ? { id: i.actorId, name: 'Onsective platform', email: null }
                : { id: i.actorId, name: i.actorType, email: null },
        })),
        total,
        page: input.page,
        pageSize: 50,
      };
    }),
});
