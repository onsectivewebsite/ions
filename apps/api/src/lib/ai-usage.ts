/**
 * Phase 8.1 — AI usage logging + per-tenant settings + budget gate.
 *
 * Centralised so every AI call site (extraction today, classify/agent in
 * later phases) goes through the same:
 *
 *   1. Read settings (lazy-create defaults).
 *   2. Fail loudly if disabled or over budget.
 *   3. Run the call.
 *   4. Log AiUsage with tokens + cost.
 *
 * Step 4 is wired AFTER the call completes — we don't predict cost up
 * front. The budget gate uses month-to-date sum; a call that puts the
 * tenant over budget is allowed (we don't half-cut a request) but the
 * NEXT call gets blocked.
 */
import type { PrismaClient } from '@onsecboad/db';

export type AiFeature = 'extract' | 'classify' | 'formfill' | 'agent' | 'summary' | 'transcribe';

export type AiSettings = {
  tenantId: string;
  enabled: boolean;
  classifyAuto: boolean;
  formFillEnabled: boolean;
  agentEnabled: boolean;
  preferredModel: string;
  monthlyBudgetCents: number;
  redactionLevel: string;
};

const DEFAULT_SETTINGS = {
  enabled: true,
  classifyAuto: true,
  formFillEnabled: true,
  agentEnabled: false,
  preferredModel: 'claude-sonnet-4-6',
  monthlyBudgetCents: 0,
  redactionLevel: 'standard',
};

/**
 * Read the tenant's AiSettings, creating a defaults row if none exists.
 * Returned shape matches the DB row but is safe to log (no secrets).
 */
export async function getAiSettings(
  prisma: PrismaClient,
  tenantId: string,
): Promise<AiSettings> {
  const row = await prisma.aiSettings.upsert({
    where: { tenantId },
    create: { tenantId, ...DEFAULT_SETTINGS },
    update: {},
  });
  return {
    tenantId: row.tenantId,
    enabled: row.enabled,
    classifyAuto: row.classifyAuto,
    formFillEnabled: row.formFillEnabled,
    agentEnabled: row.agentEnabled,
    preferredModel: row.preferredModel,
    monthlyBudgetCents: row.monthlyBudgetCents,
    redactionLevel: row.redactionLevel,
  };
}

/**
 * Sum of AiUsage.costCents this calendar month for the tenant. Used by
 * the budget gate AND surfaced on the dashboard.
 */
export async function monthToDateCostCents(
  prisma: PrismaClient,
  tenantId: string,
): Promise<number> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const r = await prisma.aiUsage.aggregate({
    where: { tenantId, createdAt: { gte: startOfMonth } },
    _sum: { costCents: true },
  });
  return r._sum.costCents ?? 0;
}

export class AiBudgetExceeded extends Error {
  constructor(
    public readonly mtdCents: number,
    public readonly capCents: number,
  ) {
    super(
      `AI monthly budget exceeded: $${(mtdCents / 100).toFixed(2)} CAD spent of $${(capCents / 100).toFixed(2)} CAD cap.`,
    );
  }
}

export class AiDisabled extends Error {
  constructor() {
    super('AI is disabled for this firm. Enable it in Settings → AI.');
  }
}

/**
 * Throws if the firm has AI disabled OR is over their monthly cap. Call
 * this BEFORE making the Anthropic request so we don't burn tokens on a
 * call we'll refuse to use anyway.
 *
 * Per-feature flags are checked too — formfill calls fail-fast if
 * formFillEnabled=false even when the master toggle is on.
 */
export async function assertAiAllowed(
  prisma: PrismaClient,
  tenantId: string,
  feature: AiFeature,
): Promise<AiSettings> {
  const settings = await getAiSettings(prisma, tenantId);
  if (!settings.enabled) throw new AiDisabled();
  if (feature === 'classify' && !settings.classifyAuto) {
    throw new AiDisabled();
  }
  if (feature === 'formfill' && !settings.formFillEnabled) {
    throw new AiDisabled();
  }
  if (feature === 'agent' && !settings.agentEnabled) {
    throw new AiDisabled();
  }
  if (settings.monthlyBudgetCents > 0) {
    const mtd = await monthToDateCostCents(prisma, tenantId);
    if (mtd >= settings.monthlyBudgetCents) {
      throw new AiBudgetExceeded(mtd, settings.monthlyBudgetCents);
    }
  }
  return settings;
}

/**
 * Persist a single AI call's usage. Always called from within the
 * originating handler's transaction-or-not flow; failure to log is
 * NOT propagated (we'd rather lose a usage row than fail the user's
 * request after we already burned the tokens).
 */
export async function logAiUsage(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    feature: AiFeature;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costCents: number;
    mode: 'real' | 'dry-run';
    refType?: string;
    refId?: string;
    createdById?: string;
  },
): Promise<void> {
  try {
    await prisma.aiUsage.create({ data: args });
  } catch {
    /* swallow — see fn-doc */
  }
}
