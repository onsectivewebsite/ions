/**
 * Public lead ingestion endpoint. POST /api/v1/leads/ingest with
 * `Authorization: Bearer osk_xxx` header. Validates the body, looks up the
 * firm by API key, creates the Lead, runs round-robin distribution,
 * returns 201 with the new lead id.
 *
 * Auth flow:
 *   1. Hash the bearer token (sha256), look up an unrevoked ApiKey row.
 *   2. Update lastUsedAt for visibility.
 *   3. Tenant from the ApiKey row → must be ACTIVE (not deleted/canceled/suspended).
 *   4. Scope check: the key must have 'leads:write'.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';
import { hashApiKey } from '../routers/api-key.js';
import { pickAssignee } from '../lib/lead-distribute.js';

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
  // Bearer auth
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

  // Body
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

  // Branch must belong to this tenant if specified, otherwise null (firm-wide).
  let branchId: string | null = null;
  if (input.branchId) {
    const b = await prisma.branch.findFirst({
      where: { id: input.branchId, tenantId: apiKey.tenantId, isActive: true },
    });
    if (!b) {
      res.status(400).json({ ok: false, error: 'branchId does not belong to this firm' });
      return;
    }
    branchId = b.id;
  }

  // Round-robin among active telecallers in the target branch.
  const distribute = await pickAssignee(prisma, {
    tenantId: apiKey.tenantId,
    branchId,
  });

  const lead = await prisma.lead.create({
    data: {
      tenantId: apiKey.tenantId,
      branchId,
      assignedToId: distribute.assignedToId,
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
      payload: input.payload as Parameters<typeof prisma.lead.create>[0]['data']['payload'],
    },
  });

  // Update lastUsedAt for the API key (visibility on the keys page).
  // Fire-and-forget — failure here doesn't fail the ingest.
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  // Audit (system actor — there's no logged-in user)
  await prisma.auditLog.create({
    data: {
      tenantId: apiKey.tenantId,
      actorId: '00000000-0000-0000-0000-000000000000',
      actorType: 'SYSTEM',
      action: 'lead.ingest',
      targetType: 'Lead',
      targetId: lead.id,
      payload: { source: input.source, apiKeyId: apiKey.id, distribute: distribute.reason },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    },
  });

  logger.info(
    { tenantId: apiKey.tenantId, leadId: lead.id, source: input.source, assignedToId: distribute.assignedToId },
    'lead ingested via REST',
  );

  res.status(201).json({
    ok: true,
    id: lead.id,
    assignedToId: distribute.assignedToId,
    distribute: distribute.reason,
  });
}
