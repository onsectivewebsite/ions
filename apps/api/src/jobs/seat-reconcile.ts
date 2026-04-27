/**
 * Daily seat reconciliation. Walks every active tenant, recomputes the local
 * seat count from the user table, and pushes the quantity to Stripe via
 * syncSeats. Mismatches between previous Tenant.seatCount and the recomputed
 * count are recorded in the audit log so we can spot drift.
 *
 * In dry-run, syncSeats logs and returns — drift detection still works,
 * since it compares local counts against local Tenant.seatCount.
 */
import { prisma } from '@onsecboad/db';
import { syncSeats } from '../lib/seats.js';
import { logger } from '../logger.js';

export type ReconcileResult = {
  scanned: number;
  drifted: number;
  errors: number;
};

export async function reconcileAllSeats(): Promise<ReconcileResult> {
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ['ACTIVE', 'PROVISIONING'] }, deletedAt: null },
    select: { id: true, displayName: true, seatCount: true },
  });
  const result: ReconcileResult = { scanned: 0, drifted: 0, errors: 0 };
  for (const t of tenants) {
    result.scanned++;
    try {
      const before = t.seatCount;
      const { seats: after } = await syncSeats(prisma, t.id);
      if (before !== after) {
        result.drifted++;
        await prisma.auditLog.create({
          data: {
            tenantId: t.id,
            actorId: '00000000-0000-0000-0000-000000000000',
            actorType: 'SYSTEM',
            action: 'tenant.seats.drift',
            targetType: 'Tenant',
            targetId: t.id,
            payload: { before, after },
          },
        });
        logger.warn(
          { tenantId: t.id, displayName: t.displayName, before, after },
          'seat drift detected and corrected',
        );
      }
    } catch (e) {
      result.errors++;
      logger.error({ err: e, tenantId: t.id }, 'seat reconcile error');
    }
  }
  return result;
}
