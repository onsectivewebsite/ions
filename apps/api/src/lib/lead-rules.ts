/**
 * Lead-rule resolution for inbound leads.
 *
 * Rules live in `LeadRule` (per tenant, ordered by `priority` ascending).
 * Each row carries:
 *   matchJson:  { source?: string, language?: string, caseInterest?: string,
 *                 branchId?: string, hourRange?: [startHour, endHour] }
 *   actionJson: { assignTo: 'round_robin' | 'user' | 'unassigned',
 *                 userId?: string, branchId?: string }
 *
 * `resolveAssignment` walks active rules in order, returns the first match's
 * action. If none match (or the matched rule says round_robin), we fall
 * back to the existing pickAssignee round-robin among active TELECALLERs.
 */
import type { PrismaClient } from '@onsecboad/db';
import { pickAssignee } from './lead-distribute.js';

export type LeadRuleContext = {
  source: string;
  language?: string;
  caseInterest?: string;
  branchId?: string | null;
  now: Date;
};

export type LeadRuleMatch = {
  source?: string;
  language?: string;
  caseInterest?: string;
  branchId?: string;
  hourRange?: [number, number];
};

export type LeadRuleAction = {
  assignTo: 'round_robin' | 'user' | 'unassigned';
  userId?: string;
  branchId?: string;
};

export type AssignmentDecision = {
  assignedToId: string | null;
  branchId: string | null;
  ruleName: string;
};

function matchesRule(match: LeadRuleMatch | null | undefined, ctx: LeadRuleContext): boolean {
  if (!match) return true;
  if (match.source && match.source !== ctx.source) return false;
  if (match.language && ctx.language && match.language !== ctx.language) return false;
  if (match.language && !ctx.language) return false;
  if (match.caseInterest && ctx.caseInterest && match.caseInterest !== ctx.caseInterest) return false;
  if (match.caseInterest && !ctx.caseInterest) return false;
  if (match.branchId && match.branchId !== ctx.branchId) return false;
  if (match.hourRange) {
    const h = ctx.now.getHours();
    const [start, end] = match.hourRange;
    // Allow wrapping ranges (e.g. 22..6 = night shift).
    const inRange = start <= end ? h >= start && h < end : h >= start || h < end;
    if (!inRange) return false;
  }
  return true;
}

export async function resolveAssignment(
  prisma: PrismaClient,
  tenantId: string,
  ctx: LeadRuleContext,
): Promise<AssignmentDecision> {
  const rules = await prisma.leadRule.findMany({
    where: { tenantId, isActive: true },
    orderBy: { priority: 'asc' },
    select: { id: true, name: true, matchJson: true, actionJson: true },
  });

  for (const rule of rules) {
    const match = rule.matchJson as LeadRuleMatch | null;
    if (!matchesRule(match, ctx)) continue;
    const action = rule.actionJson as LeadRuleAction | null;
    if (!action) continue;

    const branchId = action.branchId ?? ctx.branchId ?? null;

    if (action.assignTo === 'unassigned') {
      return { assignedToId: null, branchId, ruleName: rule.name };
    }
    if (action.assignTo === 'user' && action.userId) {
      const user = await prisma.user.findFirst({
        where: { id: action.userId, tenantId, deletedAt: null },
        select: { id: true, status: true },
      });
      if (user && user.status === 'ACTIVE') {
        return { assignedToId: user.id, branchId, ruleName: rule.name };
      }
      // Fallthrough to round-robin if specified user is unavailable.
    }
    // Round-robin within the branch the rule pointed at.
    const rr = await pickAssignee(prisma, { tenantId, branchId });
    return { assignedToId: rr.assignedToId, branchId, ruleName: `${rule.name}:rr` };
  }

  // No rules matched → default round-robin in inbound branch.
  const rr = await pickAssignee(prisma, { tenantId, branchId: ctx.branchId ?? null });
  return {
    assignedToId: rr.assignedToId,
    branchId: ctx.branchId ?? null,
    ruleName: rr.assignedToId ? 'default-round-robin' : 'unassigned',
  };
}
