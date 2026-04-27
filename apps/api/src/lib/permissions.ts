/**
 * tRPC permission middleware. Loads the caller's role + permissions and
 * attaches them to ctx, so handlers can:
 *   - call requirePermission(resource, action) to throw FORBIDDEN on deny
 *   - read ctx.scope to know whether to filter by branch/own/etc.
 *
 * Built on top of firmProcedure (so it's already authenticated + tenant-scoped).
 */
import { TRPCError } from '@trpc/server';
import { resolveScope, type Permissions, type Action, type Scope } from '@onsecboad/auth';
import { firmProcedure } from '../trpc.js';

export type FirmPermsCtx = {
  permissions: Permissions;
  roleName: string;
  branchId: string | null;
  userId: string;
};

export const firmProcedureWithPerms = firmProcedure.use(async ({ ctx, next }) => {
  const u = await ctx.prisma.user.findUnique({
    where: { id: ctx.session.sub },
    include: { role: true },
  });
  if (!u || !u.role) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User or role missing' });
  const perms: FirmPermsCtx = {
    permissions: (u.role.permissions as Permissions) ?? {},
    roleName: u.role.name,
    branchId: u.branchId,
    userId: u.id,
  };
  return next({ ctx: { ...ctx, perms } });
});

/**
 * Build a procedure that requires `<resource>.<action>` to resolve to a
 * non-`false` scope. The resolved scope lands on `ctx.scope` for the handler.
 */
export function requirePermission(resource: string, action: Action) {
  return firmProcedureWithPerms.use(async ({ ctx, next }) => {
    const scope: Scope = resolveScope(ctx.perms.permissions, resource, action);
    if (scope === false) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Your role doesn't allow ${action} on ${resource}.`,
      });
    }
    return next({ ctx: { ...ctx, scope } });
  });
}
