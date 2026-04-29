/**
 * Daily missing-docs agent scan — Phase 8.3.
 *
 * Walks every tenant with `agentEnabled=true`, finds PENDING_DOCUMENTS
 * cases whose collection has been SENT (or UNLOCKED — re-opened by an
 * admin) for at least 48 hours, and fires `runMissingDocsAgent` on each.
 *
 * Gating is layered — the agent itself enforces all hard rules
 * (cooldown, settings, budget, missing-items). The scan just narrows the
 * candidate set so we don't burn one DB lookup per never-eligible case.
 *
 * In dev with ENABLE_CRON=false this never fires.
 */
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';
import { runMissingDocsAgent } from '../lib/ai-agent.js';

const MIN_AGE_MS = 48 * 60 * 60 * 1000; // chase only after the link's been sent for 2 days

export async function aiAgentTick(): Promise<{
  tenantsScanned: number;
  candidates: number;
  done: number;
  skipped: number;
  errors: number;
}> {
  const now = Date.now();
  // Tenants with the agent enabled. AiSettings is lazy-created, so absence
  // of a row means defaults — and the default for `agentEnabled` is FALSE.
  // We only fire on rows that were explicitly opted in.
  const enabledTenants = await prisma.aiSettings.findMany({
    where: { enabled: true, agentEnabled: true },
    select: { tenantId: true },
  });

  let candidates = 0;
  let done = 0;
  let skipped = 0;
  let errors = 0;

  for (const t of enabledTenants) {
    // Find PENDING_DOCUMENTS cases on this tenant whose collection's
    // sentAt is older than MIN_AGE_MS. We can't filter the DC age in
    // a single query without a join, so two-step it: fetch DCs first,
    // then fetch the related cases.
    const collections = await prisma.documentCollection.findMany({
      where: {
        tenantId: t.tenantId,
        status: { in: ['SENT', 'UNLOCKED'] },
        sentAt: { lt: new Date(now - MIN_AGE_MS) },
      },
      select: { caseId: true },
    });
    if (collections.length === 0) continue;

    const cases = await prisma.case.findMany({
      where: {
        tenantId: t.tenantId,
        deletedAt: null,
        status: 'PENDING_DOCUMENTS',
        id: { in: collections.map((c) => c.caseId) },
      },
      select: { id: true },
    });

    candidates += cases.length;
    for (const c of cases) {
      try {
        const r = await runMissingDocsAgent(prisma, c.id, null);
        if (r.status === 'DONE') done++;
        else if (r.status === 'SKIPPED') skipped++;
        else errors++;
      } catch (err) {
        errors++;
        logger.error({ err, caseId: c.id }, 'agent tick: runMissingDocsAgent threw');
      }
    }
  }

  return {
    tenantsScanned: enabledTenants.length,
    candidates,
    done,
    skipped,
    errors,
  };
}
