/**
 * Audit log retention purge — runs nightly. Deletes AuditLog rows older
 * than each tenant's `auditRetentionDays` (default 730 = 2 years; PIPEDA
 * s.10.3 minimum is 24 months for breach records, so 730 is the floor).
 *
 * Deletes in chunks of 5000 per tenant per pass to keep transaction size
 * sane. If a tenant accumulates faster than the purge can keep up, the
 * next nightly run picks up where this one left off — no special "catch-
 * up" mode needed.
 */
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';

const CHUNK = 5000;

export type AuditPurgeStats = {
  tenantsScanned: number;
  rowsDeleted: number;
  errors: number;
};

export async function auditPurgeTick(): Promise<AuditPurgeStats> {
  const stats: AuditPurgeStats = { tenantsScanned: 0, rowsDeleted: 0, errors: 0 };
  const tenants = await prisma.tenant.findMany({
    where: { deletedAt: null },
    select: { id: true, auditRetentionDays: true },
  });
  for (const t of tenants) {
    stats.tenantsScanned++;
    const cutoff = new Date(Date.now() - t.auditRetentionDays * 24 * 60 * 60 * 1000);
    try {
      // Loop chunked deletes until nothing older than cutoff remains.
      // Postgres has no LIMIT clause on DELETE; we use a CTE workaround
      // via prisma.$executeRaw, but plain deleteMany over the index is
      // fine for our row volume. Keep it simple.
      let deletedThisRun = 0;
      while (true) {
        const ids = await prisma.auditLog.findMany({
          where: { tenantId: t.id, createdAt: { lt: cutoff } },
          select: { id: true },
          take: CHUNK,
        });
        if (ids.length === 0) break;
        const r = await prisma.auditLog.deleteMany({
          where: { id: { in: ids.map((i) => i.id) } },
        });
        deletedThisRun += r.count;
        stats.rowsDeleted += r.count;
        // Prevent runaway loops if something drifts.
        if (r.count === 0) break;
      }
      if (deletedThisRun > 0) {
        logger.info(
          { tenantId: t.id, deleted: deletedThisRun, retentionDays: t.auditRetentionDays },
          'audit purge: tenant',
        );
      }
    } catch (e) {
      stats.errors++;
      logger.warn({ err: e, tenantId: t.id }, 'audit purge: tenant failed');
    }
  }
  return stats;
}
