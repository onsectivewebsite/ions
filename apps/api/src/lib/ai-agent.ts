/**
 * Missing-docs agent — Phase 8.3.
 *
 * Orchestrator for the autonomous "client uploads are still missing"
 * nudge. Wired into:
 *
 *   - tRPC `aiAgent.runNow` (staff hits the button on /cases/[id])
 *   - cron `apps/api/src/jobs/ai-agent-tick.ts` (daily scan, off in dev)
 *
 * Hard rules:
 *   - Case must be PENDING_DOCUMENTS.
 *   - Collection must be SENT or UNLOCKED (not DRAFT, not LOCKED).
 *   - At least one required item must still be missing.
 *   - 24-hour cooldown per case: if any prior AiAgentRun ended < 24h ago,
 *     skip with a clear `skipReason`.
 *   - Honours AiSettings: `enabled` master switch + `agentEnabled` +
 *     monthly budget cap (same gate Phase 8.1 uses for extract/classify).
 *
 * Side effects per run:
 *   - Composes a friendly nudge via Claude.
 *   - Posts the body to the Message table as a STAFF row with the
 *     `attachments` JSON tagged `{ source: 'agent' }` so the UI can
 *     render an "AI agent" pill instead of a staff name.
 *   - Logs AiUsage (feature='agent', refType='Case').
 *   - Inserts/updates an AiAgentRun row with steps + cost.
 */
import type { PrismaClient, Prisma } from '@onsecboad/db';
import { composeMissingDocsMessage, type AgentMissingItem } from '@onsecboad/ai';
import { logger } from '../logger.js';
import { publishEvent } from './realtime.js';
import { getAiSettings, logAiUsage, monthToDateCostCents } from './ai-usage.js';
import type { ChecklistItem } from './document-collection.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type AgentRunResult = {
  status: 'DONE' | 'SKIPPED' | 'ERROR';
  runId: string;
  skipReason?: string;
  messageId?: string;
  costCents?: number;
};

export async function runMissingDocsAgent(
  prismaClient: PrismaClient,
  caseId: string,
  kickedOffById: string | null,
): Promise<AgentRunResult> {
  // Resolve everything we need in one pass.
  const c = await prismaClient.case.findUnique({
    where: { id: caseId },
    include: {
      client: { select: { id: true, firstName: true, language: true } },
      tenant: { select: { displayName: true } },
    },
  });
  if (!c) {
    const r = await openRun(prismaClient, { tenantId: '00000000-0000-0000-0000-000000000000', caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'Case not found');
  }
  if (c.deletedAt) {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'Case deleted');
  }

  // Gate 1: case must be in PENDING_DOCUMENTS.
  if (c.status !== 'PENDING_DOCUMENTS') {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, `Case status is ${c.status}, not PENDING_DOCUMENTS`);
  }

  // Gate 2: cooldown.
  const lastRun = await prismaClient.aiAgentRun.findFirst({
    where: { tenantId: c.tenantId, caseId, status: { in: ['DONE', 'ERROR'] } },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, endedAt: true },
  });
  if (lastRun) {
    const ref = lastRun.endedAt ?? lastRun.startedAt;
    if (Date.now() - ref.getTime() < COOLDOWN_MS) {
      const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
      return finishSkipped(prismaClient, r.id, '24-hour cooldown — last run was within 24h');
    }
  }

  // Gate 3: AI enabled, agent enabled, budget OK.
  const settings = await getAiSettings(prismaClient, c.tenantId);
  if (!settings.enabled) {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'AI is disabled for this firm');
  }
  if (!settings.agentEnabled) {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'Autonomous agent is disabled for this firm');
  }
  if (settings.monthlyBudgetCents > 0) {
    const mtd = await monthToDateCostCents(prismaClient, c.tenantId);
    if (mtd >= settings.monthlyBudgetCents) {
      const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
      return finishSkipped(prismaClient, r.id, 'AI budget exhausted for this month');
    }
  }

  // Gate 4: collection ready and missing required items.
  const collection = await prismaClient.documentCollection.findUnique({
    where: { caseId: c.id },
  });
  if (!collection) {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'No document collection initialised');
  }
  if (collection.status === 'DRAFT') {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'Collection has not been sent to the client yet');
  }
  if (collection.status === 'LOCKED') {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'Collection is LOCKED — no need to chase');
  }

  const items = (collection.itemsJson as unknown as ChecklistItem[]) ?? [];
  const uploads = await prismaClient.documentUpload.findMany({
    where: { collectionId: collection.id, supersededAt: null },
    select: { itemKey: true },
  });
  const uploadedKeys = new Set(uploads.map((u) => u.itemKey));
  const missingItems: AgentMissingItem[] = items
    .filter((it) => it.required && !uploadedKeys.has(it.key))
    .map((it) => ({ key: it.key, label: it.label }));
  if (missingItems.length === 0) {
    const r = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
    return finishSkipped(prismaClient, r.id, 'No required items missing');
  }

  // OK — actually run.
  const run = await openRun(prismaClient, { tenantId: c.tenantId, caseId, kickedOffById });
  const sentAt = collection.sentAt ?? collection.createdAt;
  const daysSinceSent = Math.max(
    1,
    Math.floor((Date.now() - sentAt.getTime()) / (24 * 60 * 60 * 1000)),
  );
  try {
    const composed = await composeMissingDocsMessage({
      firmName: c.tenant.displayName,
      clientFirstName: c.client.firstName ?? 'there',
      caseType: c.caseType,
      missingItems,
      daysSinceSent,
      language: c.client.language ?? 'en',
      // 8.3 always picks Haiku for cost; tenants can opt into Sonnet/Opus
      // by setting preferredModel to a non-Haiku value (we honour it).
      model: settings.preferredModel?.startsWith('claude-haiku')
        ? settings.preferredModel
        : 'claude-haiku-4-5',
    });

    const message = await prismaClient.message.create({
      data: {
        tenantId: c.tenantId,
        clientId: c.client.id,
        caseId: c.id,
        sender: 'STAFF',
        // Cron runs have no senderUserId. UI distinguishes via the
        // attachments-tagged source field.
        senderUserId: null,
        body: composed.body,
        attachments: { source: 'agent', mode: composed.mode } as unknown as Prisma.InputJsonValue,
        readByStaff: new Date(),
      },
    });

    await logAiUsage(prismaClient, {
      tenantId: c.tenantId,
      feature: 'agent',
      model: composed.usage.model,
      inputTokens: composed.usage.inputTokens,
      cachedInputTokens: composed.usage.cachedInputTokens,
      outputTokens: composed.usage.outputTokens,
      costCents: composed.usage.costCents,
      mode: composed.mode,
      refType: 'Case',
      refId: c.id,
      createdById: kickedOffById ?? undefined,
    });

    await publishEvent(
      { kind: 'tenant', tenantId: c.tenantId },
      {
        type: 'message.new',
        messageId: message.id,
        clientId: c.client.id,
        caseId: c.id,
        sender: 'STAFF',
        bodyPreview: composed.body.length > 80 ? `${composed.body.slice(0, 79)}…` : composed.body,
      },
    );

    const finished = await prismaClient.aiAgentRun.update({
      where: { id: run.id },
      data: {
        status: 'DONE',
        endedAt: new Date(),
        costCents: composed.usage.costCents,
        steps: [
          {
            tool: 'compose_missing_docs',
            ts: new Date().toISOString(),
            input: { missingCount: missingItems.length, daysSinceSent },
            output: {
              messageId: message.id,
              model: composed.usage.model,
              mode: composed.mode,
              bodyPreview:
                composed.body.length > 120 ? `${composed.body.slice(0, 119)}…` : composed.body,
            },
          },
        ] as unknown as Prisma.InputJsonValue,
        result: {
          messageId: message.id,
          missingItems: missingItems.map((m) => m.key),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prismaClient.auditLog.create({
      data: {
        tenantId: c.tenantId,
        actorId: kickedOffById ?? '00000000-0000-0000-0000-000000000000',
        actorType: kickedOffById ? 'USER' : 'SYSTEM',
        action: 'aiAgent.missingDocsRun',
        targetType: 'Case',
        targetId: c.id,
        payload: {
          runId: run.id,
          messageId: message.id,
          costCents: composed.usage.costCents,
          model: composed.usage.model,
        },
      },
    });

    return {
      status: 'DONE',
      runId: finished.id,
      messageId: message.id,
      costCents: composed.usage.costCents,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'agent compose failed';
    logger.error({ err, caseId: c.id }, 'agent: missing-docs run failed');
    await prismaClient.aiAgentRun.update({
      where: { id: run.id },
      data: {
        status: 'ERROR',
        endedAt: new Date(),
        result: { error: msg } as unknown as Prisma.InputJsonValue,
      },
    });
    return { status: 'ERROR', runId: run.id, skipReason: msg };
  }
}

async function openRun(
  prismaClient: PrismaClient,
  args: { tenantId: string; caseId: string; kickedOffById: string | null },
) {
  return prismaClient.aiAgentRun.create({
    data: {
      tenantId: args.tenantId,
      caseId: args.caseId,
      mode: 'missing_docs',
      status: 'RUNNING',
      kickedOffById: args.kickedOffById,
    },
  });
}

async function finishSkipped(
  prismaClient: PrismaClient,
  runId: string,
  reason: string,
): Promise<AgentRunResult> {
  await prismaClient.aiAgentRun.update({
    where: { id: runId },
    data: { status: 'SKIPPED', endedAt: new Date(), skipReason: reason },
  });
  logger.info({ runId, reason }, 'agent: skipped');
  return { status: 'SKIPPED', runId, skipReason: reason };
}
