/**
 * RBAC scope resolver. See docs/phase-02-roles-branches-users.md.
 * Permissions JSON shape:
 *   { "<resource>": {"read": <scope>, "write": <scope>, "delete": <scope>} }
 * Scopes (least → most): false | own | assigned | case | branch | tenant
 * Plus a special "_all" key that applies to every resource (used by FIRM_ADMIN).
 */

export type Scope = false | 'own' | 'assigned' | 'case' | 'branch' | 'tenant';
export type Action = 'read' | 'write' | 'delete';
export type Permissions = Record<string, Partial<Record<Action, Scope>> | undefined> & {
  _all?: Partial<Record<Action, Scope>>;
};

const ORDER: Scope[] = [false, 'own', 'assigned', 'case', 'branch', 'tenant'];

function rank(s: Scope): number {
  return ORDER.indexOf(s);
}

export function resolveScope(perms: Permissions, resource: string, action: Action): Scope {
  const explicit = perms[resource]?.[action];
  const fallback = perms._all?.[action];
  if (explicit !== undefined) return explicit;
  if (fallback !== undefined) return fallback;
  return false;
}

export function hasAtLeast(perms: Permissions, resource: string, action: Action, min: Scope): boolean {
  const have = resolveScope(perms, resource, action);
  return rank(have) >= rank(min);
}

export type RbacContext = {
  userId: string;
  branchId: string | null;
  permissions: Permissions;
};

/**
 * Returns a Prisma `where` fragment that narrows a query by tenant, plus
 * branch/user filters dictated by the user's scope on this resource.
 *
 * Caller still injects tenantId — RLS is the ultimate guard.
 */
export function whereForRead(
  ctx: RbacContext,
  resource: string,
  fieldMap: { branchField?: string; ownerField?: string; assigneeFields?: string[] } = {},
): Record<string, unknown> | null {
  const scope = resolveScope(ctx.permissions, resource, 'read');
  if (scope === false) return null;
  if (scope === 'tenant') return {};
  if (scope === 'branch') {
    if (!fieldMap.branchField || !ctx.branchId) return {};
    return { [fieldMap.branchField]: ctx.branchId };
  }
  if (scope === 'own' && fieldMap.ownerField) return { [fieldMap.ownerField]: ctx.userId };
  if (scope === 'assigned' && fieldMap.assigneeFields?.length) {
    return { OR: fieldMap.assigneeFields.map((f) => ({ [f]: ctx.userId })) };
  }
  return {};
}
