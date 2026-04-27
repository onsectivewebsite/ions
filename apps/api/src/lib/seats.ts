/**
 * Seat sync. Single source of truth: count active billable users in our DB
 * and push that quantity to the Stripe subscription. Called whenever a user
 * is created, activated, disabled, or restored.
 *
 * In dry-run, the Stripe call is a no-op (logs only). Real keys → real push.
 */
import { updateSubscriptionQuantity } from '@onsecboad/stripe';
import type { PrismaClient } from '@onsecboad/db';
import { logger } from '../logger.js';

export async function syncSeats(prisma: PrismaClient, tenantId: string): Promise<{ seats: number }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('Tenant not found');
  const seats = await prisma.user.count({
    where: {
      tenantId,
      isBillable: true,
      status: { in: ['ACTIVE', 'INVITED'] },
      deletedAt: null,
    },
  });
  if (seats !== tenant.seatCount) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { seatCount: seats } });
  }
  if (tenant.stripeSubscriptionId) {
    try {
      await updateSubscriptionQuantity(tenant.stripeSubscriptionId, seats);
    } catch (e) {
      logger.error({ err: e, tenantId }, 'stripe seat sync failed (will reconcile later)');
    }
  }
  return { seats };
}
