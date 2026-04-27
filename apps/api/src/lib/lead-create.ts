/**
 * Shared lead-creation helper used by REST ingest, Meta webhook, TikTok webhook,
 * and tRPC `lead.create`. Centralises:
 *   - branch validation
 *   - lead-rule resolution (with round-robin fallback)
 *   - audit log entry
 *   - duplicate guard via (tenantId, source, externalId)
 *
 * Returns the created lead row — or the existing one if (source, externalId)
 * already collides (idempotent ad-platform replay).
 */
import type { Prisma, PrismaClient } from '@onsecboad/db';
import { resolveAssignment, type LeadRuleContext } from './lead-rules.js';
import { publishEvent } from './realtime.js';
import { logger } from '../logger.js';

export type CreateLeadInput = {
  tenantId: string;
  branchId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source: string;
  externalId?: string;
  language?: string;
  caseInterest?: string;
  notes?: string;
  consentMarketing?: boolean;
  payload?: Prisma.InputJsonValue;
  sourceCampaignId?: string;
  // Audit metadata
  actorId?: string; // null/system → '00000000-0000-0000-0000-000000000000'
  actorType?: 'USER' | 'SYSTEM';
  ip?: string | null;
  userAgent?: string | null;
};

export type CreateLeadResult = {
  leadId: string;
  assignedToId: string | null;
  branchId: string | null;
  ruleName: string;
  duplicate: boolean;
};

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

export async function createLeadFromIngest(
  prisma: PrismaClient,
  input: CreateLeadInput,
): Promise<CreateLeadResult> {
  // Idempotency on (source, externalId): ad platforms replay webhooks.
  if (input.externalId) {
    const existing = await prisma.lead.findUnique({
      where: {
        tenantId_source_externalId: {
          tenantId: input.tenantId,
          source: input.source,
          externalId: input.externalId,
        },
      },
    });
    if (existing) {
      return {
        leadId: existing.id,
        assignedToId: existing.assignedToId,
        branchId: existing.branchId,
        ruleName: 'duplicate-skip',
        duplicate: true,
      };
    }
  }

  // Validate branch belongs to the firm.
  let branchId: string | null = input.branchId ?? null;
  if (branchId) {
    const b = await prisma.branch.findFirst({
      where: { id: branchId, tenantId: input.tenantId, isActive: true },
      select: { id: true },
    });
    if (!b) branchId = null;
  }

  // Apply rules (priority order) + round-robin fallback.
  const ruleCtx: LeadRuleContext = {
    source: input.source,
    language: input.language,
    branchId,
    now: new Date(),
  };
  const decision = await resolveAssignment(prisma, input.tenantId, ruleCtx);
  // Rule may override the branch (e.g. route Punjabi leads to a particular branch).
  branchId = decision.branchId ?? branchId;

  const lead = await prisma.lead.create({
    data: {
      tenantId: input.tenantId,
      branchId,
      assignedToId: decision.assignedToId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      source: input.source,
      externalId: input.externalId,
      language: input.language,
      caseInterest: input.caseInterest,
      notes: input.notes,
      consentMarketing: input.consentMarketing ?? false,
      payload: input.payload,
      sourceCampaignId: input.sourceCampaignId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorId: input.actorId ?? SYSTEM_ACTOR,
      actorType: input.actorType ?? 'SYSTEM',
      action: 'lead.ingest',
      targetType: 'Lead',
      targetId: lead.id,
      payload: { source: input.source, rule: decision.ruleName },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  logger.info(
    {
      tenantId: input.tenantId,
      leadId: lead.id,
      source: input.source,
      assignedToId: decision.assignedToId,
      rule: decision.ruleName,
    },
    'lead created via ingest',
  );

  // Realtime fanout. Don't await — best-effort, never fail the ingest.
  void publishEvent(
    { kind: 'tenant', tenantId: input.tenantId },
    {
      type: 'lead.created',
      leadId: lead.id,
      source: input.source,
      branchId: lead.branchId,
    },
  );
  if (decision.assignedToId) {
    void publishEvent(
      { kind: 'user', tenantId: input.tenantId, userId: decision.assignedToId },
      {
        type: 'lead.assigned',
        leadId: lead.id,
        assignedToId: decision.assignedToId,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      },
    );
  }

  return {
    leadId: lead.id,
    assignedToId: decision.assignedToId,
    branchId: lead.branchId,
    ruleName: decision.ruleName,
    duplicate: false,
  };
}
