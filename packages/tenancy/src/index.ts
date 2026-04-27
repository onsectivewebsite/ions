/**
 * Tenant context propagation. Every tenant-scoped DB query MUST run inside
 * `withTenant` so the Postgres session GUC `app.tenant_id` is set for any
 * RLS policy added later (Phase 1+).
 *
 * Usage:
 *   const cases = await withTenant(prisma, tenantId, (tx) =>
 *     tx.case.findMany({ where: { branchId } }),
 *   );
 *
 * The platform manager superuser bypasses this with `withPlatformGod()`.
 * Every god-mode call must be audited by the caller.
 */
import { prisma, type PrismaClient } from '@onsecboad/db';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export async function withTenant<T>(
  client: PrismaClient,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) throw new Error('withTenant: invalid tenantId');
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
    return fn(tx);
  });
}

export async function withPlatformGod<T>(
  client: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.is_platform = 'true'`);
    return fn(tx);
  });
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export { prisma };
