/**
 * Firm-scoped role CRUD + permission matrix edits. Editing a built-in role
 * flips its isSystem flag off — it becomes a tenant-owned custom override.
 * Deleting a role is blocked when any user still holds it.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@onsecboad/db';
import { router, firmProcedure } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';

const SCOPES = ['own', 'assigned', 'case', 'branch', 'tenant'] as const;
const RESOURCES = [
  'leads',
  'clients',
  'cases',
  'documents',
  'calls',
  'campaigns',
  'appointments',
  'billing',
  'settings',
] as const;

const scopeSchema = z.union([z.literal(false), z.enum(SCOPES)]);
const resourcePermissionSchema = z
  .object({
    read: scopeSchema,
    write: scopeSchema,
    delete: scopeSchema,
  })
  .partial();

const permissionsSchema = z.object({
  _all: resourcePermissionSchema.optional(),
  ...Object.fromEntries(RESOURCES.map((r) => [r, resourcePermissionSchema.optional()])),
});

export const roleRouter = router({
  // Lookup-only: every firm user can read the role list (needed to render
  // role names in user-list filters, the manage-user dropdown, etc).
  // Editing is gated on roles.write/delete below.
  list: firmProcedure.query(async ({ ctx }) => {
    const roles = await ctx.prisma.role.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      name: r.name,
      isSystem: r.isSystem,
      permissions: r.permissions,
      userCount: r._count.users,
    }));
  }),

  get: firmProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const r = await ctx.prisma.role.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!r) throw new TRPCError({ code: 'NOT_FOUND' });
      return r;
    }),

  create: requirePermission('roles', 'write')
    .input(
      z.object({
        name: z.string().min(2).max(60).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, _ and - only'),
        permissions: permissionsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conflict = await ctx.prisma.role.findUnique({
        where: { tenantId_name: { tenantId: ctx.tenantId, name: input.name } },
      });
      if (conflict) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A role with that name already exists.' });
      }
      const role = await ctx.prisma.role.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          isSystem: false,
          permissions: input.permissions as Prisma.InputJsonValue,
        },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'role.create',
          targetType: 'Role',
          targetId: role.id,
          payload: { name: role.name, permissions: input.permissions },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return role;
    }),

  update: requirePermission('roles', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(2).max(60).optional(),
        permissions: permissionsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.role.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!before) throw new TRPCError({ code: 'NOT_FOUND' });

      // Renaming: enforce unique-per-tenant
      if (input.name && input.name !== before.name) {
        const conflict = await ctx.prisma.role.findUnique({
          where: { tenantId_name: { tenantId: ctx.tenantId, name: input.name } },
        });
        if (conflict) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A role with that name already exists.' });
        }
      }

      const data: Prisma.RoleUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.permissions !== undefined) {
        data.permissions = input.permissions as Prisma.InputJsonValue;
        // Editing a system role's permissions converts it to a custom override —
        // matches the "⚠ Editing a system role creates a custom override" UX.
        if (before.isSystem) data.isSystem = false;
      }

      const updated = await ctx.prisma.role.update({ where: { id: before.id }, data });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'role.update',
          targetType: 'Role',
          targetId: before.id,
          payload: {
            name: { from: before.name, to: updated.name },
            permissions: { from: before.permissions, to: updated.permissions },
            isSystemBefore: before.isSystem,
            isSystemAfter: updated.isSystem,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  delete: requirePermission('roles', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.prisma.role.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) throw new TRPCError({ code: 'NOT_FOUND' });
      if (role.name === 'FIRM_ADMIN') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'FIRM_ADMIN cannot be deleted.' });
      }
      if (role._count.users > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${role._count.users} user${role._count.users === 1 ? '' : 's'} still hold this role. Reassign first.`,
        });
      }
      await ctx.prisma.role.delete({ where: { id: role.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'role.delete',
          targetType: 'Role',
          targetId: role.id,
          payload: { name: role.name },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});
