import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const addressSchema = z
  .object({
    line1: z.string().max(200).optional(),
    line2: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    province: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().length(2).default('CA'),
  })
  .partial()
  .optional();

const baseInput = z.object({
  name: z.string().min(2).max(120),
  address: addressSchema,
  phone: z.string().max(40).optional(),
  email: z.string().email().nullable().optional(),
});

export const branchRouter = router({
  list: requirePermission('branches', 'read')
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          q: z.string().optional(),
          includeInactive: z.boolean().default(false),
        })
        .default({ page: 1, includeInactive: false }),
    )
    .query(async ({ ctx, input }) => {
      const where: Prisma.BranchWhereInput = {
        tenantId: ctx.tenantId,
        // Branch-scoped readers (branch managers) see only their own branch.
        ...(ctx.scope === 'branch' && ctx.perms.branchId ? { id: ctx.perms.branchId } : {}),
        ...(input.includeInactive ? {} : { isActive: true }),
        ...(input.q
          ? { name: { contains: input.q, mode: 'insensitive' as const } }
          : {}),
      };
      const [items, total] = await Promise.all([
        ctx.prisma.branch.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: 20,
          skip: (input.page - 1) * 20,
          include: {
            manager: { select: { id: true, name: true, email: true } },
            _count: { select: { users: true } },
          },
        }),
        ctx.prisma.branch.count({ where }),
      ]);
      return { items, total, page: input.page, pageSize: 20 };
    }),

  get: requirePermission('branches', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Branch-scoped readers can only fetch their own branch.
      if (ctx.scope === 'branch' && ctx.perms.branchId !== input.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Out of branch scope' });
      }
      const b = await ctx.prisma.branch.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        include: {
          manager: { select: { id: true, name: true, email: true } },
          users: {
            where: { deletedAt: null },
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              role: { select: { id: true, name: true } },
              lastLoginAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          _count: { select: { users: true } },
        },
      });
      if (!b) throw new TRPCError({ code: 'NOT_FOUND' });
      return b;
    }),

  create: requirePermission('branches', 'write').input(baseInput).mutation(async ({ ctx, input }) => {
    const b = await ctx.prisma.branch.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone ?? '',
        email: input.email ?? null,
        address: (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
    await ctx.prisma.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        actorId: ctx.session.sub,
        actorType: 'USER',
        action: 'branch.create',
        targetType: 'Branch',
        targetId: b.id,
        payload: { name: b.name },
        ip: ctx.ip,
        userAgent: ctx.userAgent ?? null,
      },
    });
    return b;
  }),

  update: requirePermission('branches', 'write')
    .input(z.object({ id: z.string().uuid() }).merge(baseInput.partial()))
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.branch.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });
      const data: Prisma.BranchUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.email !== undefined) data.email = input.email;
      if (input.address !== undefined) {
        data.address = input.address ? (input.address as Prisma.InputJsonValue) : Prisma.JsonNull;
      }
      const updated = await ctx.prisma.branch.update({ where: { id: input.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'branch.update',
          targetType: 'Branch',
          targetId: updated.id,
          payload: input as object,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  archive: requirePermission('branches', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.branch.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!b) throw new TRPCError({ code: 'NOT_FOUND' });
      // Refuse archive if active users still belong to it — admin must
      // reassign first to avoid orphan data.
      const active = await ctx.prisma.user.count({
        where: { branchId: b.id, status: { not: 'DISABLED' }, deletedAt: null },
      });
      if (active > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${active} active user${active === 1 ? '' : 's'} still in this branch. Move or disable them first.`,
        });
      }
      await ctx.prisma.branch.update({
        where: { id: b.id },
        data: { isActive: false },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'branch.archive',
          targetType: 'Branch',
          targetId: b.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  assignManager: requirePermission('branches', 'write')
    .input(z.object({ id: z.string().uuid(), userId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const b = await ctx.prisma.branch.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!b) throw new TRPCError({ code: 'NOT_FOUND' });
      if (input.userId) {
        const u = await ctx.prisma.user.findFirst({
          where: { id: input.userId, tenantId: ctx.tenantId, deletedAt: null },
        });
        if (!u) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'That user is no longer in this firm.',
          });
        }
      }
      await ctx.prisma.branch.update({
        where: { id: b.id },
        data: { managerId: input.userId },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'branch.assignManager',
          targetType: 'Branch',
          targetId: b.id,
          payload: { managerId: input.userId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
