/**
 * Public lead ingestion endpoint. POST /api/v1/leads/ingest with
 * `Authorization: Bearer osk_xxx` header. Validates the body, looks up the
 * firm by API key, creates the Lead via `createLeadFromIngest` (which runs
 * lead-rule resolution + round-robin fallback + audit log + idempotency),
 * returns 201.
 *
 * Auth flow:
 *   1. Hash the bearer token (sha256), look up an unrevoked ApiKey row.
 *   2. Tenant must be ACTIVE.
 *   3. Scope check: the key must have 'leads:write'.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { type Prisma, prisma } from '@onsecboad/db';
import { hashApiKey } from '../routers/api-key.js';
import { createLeadFromIngest } from '../lib/lead-create.js';

const ingestSchema = z.object({
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  source: z.enum(['website', 'meta', 'tiktok', 'referral', 'walkin', 'manual', 'import']).default('website'),
  externalId: z.string().max(120).optional(),
  language: z.string().max(10).optional(),
  caseInterest: z.string().max(60).optional(),
  notes: z.string().max(2000).optional(),
  branchId: z.string().uuid().optional(),
  consentMarketing: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function leadsIngestHandler(req: Request, res: Response): Promise<void> {
  const auth = req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing Authorization: Bearer header' });
    return;
  }
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { tenant: { select: { id: true, status: true, deletedAt: true } } },
  });
  if (!apiKey || apiKey.revokedAt) {
    res.status(401).json({ ok: false, error: 'Invalid or revoked API key' });
    return;
  }
  if (
    apiKey.tenant.deletedAt ||
    apiKey.tenant.status === 'CANCELED' ||
    apiKey.tenant.status === 'SUSPENDED'
  ) {
    res.status(401).json({ ok: false, error: 'Firm is not active' });
    return;
  }
  if (!apiKey.scopes.includes('leads:write')) {
    res.status(403).json({ ok: false, error: 'Key missing required scope: leads:write' });
    return;
  }

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'Validation failed',
      details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const input = parsed.data;

  const result = await createLeadFromIngest(prisma, {
    tenantId: apiKey.tenantId,
    branchId: input.branchId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    source: input.source,
    externalId: input.externalId,
    language: input.language,
    caseInterest: input.caseInterest,
    notes: input.notes,
    consentMarketing: input.consentMarketing,
    payload: input.payload as Prisma.InputJsonValue | undefined,
    actorType: 'SYSTEM',
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  });

  // Update lastUsedAt for the API key (visibility on the keys page).
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  res.status(result.duplicate ? 200 : 201).json({
    ok: true,
    id: result.leadId,
    assignedToId: result.assignedToId,
    distribute: result.ruleName,
    duplicate: result.duplicate,
  });
}
