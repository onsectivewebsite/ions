/**
 * Round-robin lead assignment across active TELECALLERs in a branch.
 * Rotation cursor is stored in Redis per (tenant, branch) so consecutive
 * leads cycle through the team instead of all going to the first agent.
 *
 * Phase 3.4 will replace the hard-coded "TELECALLER, round-robin in branch"
 * with the LeadRule editor's matchJson/actionJson resolution.
 */
import type { PrismaClient } from '@onsecboad/db';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const cursorKey = (tenantId: string, branchId: string | null) =>
  `lead:rr-cursor:${tenantId}:${branchId ?? 'firm'}`;

export type DistributeInput = {
  tenantId: string;
  branchId?: string | null;
};

export type DistributeResult = {
  assignedToId: string | null;
  reason: string;
};

export async function pickAssignee(
  prisma: PrismaClient,
  input: DistributeInput,
): Promise<DistributeResult> {
  // Pool: active telecallers in target branch (or firm-wide if branch unset).
  const candidates = await prisma.user.findMany({
    where: {
      tenantId: input.tenantId,
      status: 'ACTIVE',
      deletedAt: null,
      role: { name: 'TELECALLER' },
      ...(input.branchId ? { branchId: input.branchId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });

  if (candidates.length === 0) {
    logger.info({ tenantId: input.tenantId, branchId: input.branchId }, 'no telecaller candidates');
    return { assignedToId: null, reason: 'no-telecaller-in-branch' };
  }

  // Atomic round-robin: INCR returns 1, 2, 3... → modulo into the pool.
  const idx = (await redis.incr(cursorKey(input.tenantId, input.branchId ?? null))) - 1;
  const picked = candidates[idx % candidates.length]!;
  return { assignedToId: picked.id, reason: 'round-robin' };
}
