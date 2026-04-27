/**
 * Meta (Facebook + Instagram) Lead Ads webhook handlers.
 *
 *   GET  /api/v1/webhooks/meta-leads → Meta subscription verification
 *        (echoes hub.challenge if hub.verify_token matches one of our firms).
 *
 *   POST /api/v1/webhooks/meta-leads → inbound lead notification.
 *        Body shape:
 *          { object: 'page', entry: [{ id: <pageId>, changes: [{
 *              field: 'leadgen',
 *              value: { leadgen_id, page_id, form_id, created_time, ... }
 *          }]}] }
 *        For each `leadgen` change we fetch the lead via Graph API
 *        (or synthesise in dry-run) and create a Lead row.
 *
 * We mount the POST with `express.raw` so we can verify
 * `X-Hub-Signature-256` against the original bytes — JSON re-serialisation
 * would invalidate the HMAC.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import {
  verifyMetaSignature,
  fetchMetaLead,
  mapMetaFieldsToLead,
} from '@onsecboad/meta';
import { logger } from '../logger.js';
import { findTenantByMetaPageId, getMetaCreds } from '../lib/ad-config.js';
import { createLeadFromIngest } from '../lib/lead-create.js';

type LeadgenChange = {
  field?: string;
  value?: {
    leadgen_id?: string;
    page_id?: string;
    form_id?: string;
    created_time?: number;
  };
};

type MetaWebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string; // page id
    time?: number;
    changes?: LeadgenChange[];
  }>;
};

// ─── GET: subscription verification ───────────────────────────────────────

export async function metaLeadsVerifyHandler(req: Request, res: Response): Promise<void> {
  const mode = String(req.query['hub.mode'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');
  const token = String(req.query['hub.verify_token'] ?? '');

  if (mode !== 'subscribe' || !challenge || !token) {
    res.status(400).send('Bad subscription request');
    return;
  }

  // The verify_token is per-firm — find any tenant whose stored verifyToken
  // matches. We have to decrypt each tenant's creds to compare.
  const tenants = await prisma.tenant.findMany({
    where: { meta: { not: undefined as never }, deletedAt: null },
    select: { id: true },
  });
  for (const t of tenants) {
    const creds = await getMetaCreds(prisma, t.id);
    if (creds && creds.verifyToken === token) {
      res.status(200).send(challenge);
      return;
    }
  }
  res.status(403).send('Verify token not recognised');
}

// ─── POST: lead notification ──────────────────────────────────────────────

export async function metaLeadsWebhookHandler(req: Request, res: Response): Promise<void> {
  // express.raw gives us a Buffer at req.body
  const rawBody = req.body as Buffer;
  let parsed: MetaWebhookBody;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as MetaWebhookBody;
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  if (parsed.object !== 'page' || !Array.isArray(parsed.entry)) {
    // Always 200 to Meta when shape is unknown — they retry indefinitely otherwise.
    res.status(200).send('ok');
    return;
  }

  const signature = req.header('x-hub-signature-256');

  for (const entry of parsed.entry) {
    const pageId = entry.id;
    if (!pageId) continue;
    const tenantId = await findTenantByMetaPageId(prisma, pageId);
    if (!tenantId) {
      logger.warn({ pageId }, 'meta-leads: no tenant for page');
      continue;
    }
    const creds = await getMetaCreds(prisma, tenantId);
    const sigOk = verifyMetaSignature(creds, signature, rawBody);
    if (!sigOk) {
      logger.warn({ tenantId, pageId }, 'meta-leads: invalid signature');
      continue;
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen' || !change.value?.leadgen_id) continue;
      const leadgenId = change.value.leadgen_id;
      const eventId = `meta-leadgen-${leadgenId}`;

      // Idempotency via WebhookEvent
      const existing = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
      if (existing?.processedAt) continue;
      if (!existing) {
        try {
          await prisma.webhookEvent.create({
            data: { id: eventId, source: 'meta', type: 'leadgen', payload: change as object },
          });
        } catch {
          continue; // raced; duplicate ok
        }
      }

      try {
        const { lead: metaLead } = await fetchMetaLead(creds, leadgenId);
        const mapped = mapMetaFieldsToLead(metaLead.fields);
        await createLeadFromIngest(prisma, {
          tenantId,
          source: 'meta',
          externalId: leadgenId,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          email: mapped.email,
          phone: mapped.phone,
          language: mapped.language,
          caseInterest: mapped.caseInterest,
          consentMarketing: true, // Meta lead forms include their own consent step
          payload: { meta: metaLead.fields, formId: metaLead.formId },
          actorType: 'SYSTEM',
        });
        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { processedAt: new Date() },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error({ err: e, leadgenId, tenantId }, 'meta-leads: ingest failed');
        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { processedAt: new Date(), error: msg },
        });
      }
    }
  }

  res.status(200).send('ok');
}
