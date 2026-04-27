/**
 * TikTok Lead Generation webhook.
 *
 * POST /api/v1/webhooks/tiktok-leads
 *   Headers: X-TikTok-Signature: <hex hmac-sha256(rawBody, appSecret)>
 *   Body: see @onsecboad/tiktok TikTokWebhookPayload
 *
 * Mounted with express.raw so we can verify the HMAC against original bytes.
 * Looks up the tenant by `advertiser_id`, verifies signature, dedupes by
 * lead_id, ingests via createLeadFromIngest.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import {
  verifyTikTokSignature,
  extractTikTokLead,
  mapTikTokFieldsToLead,
  type TikTokWebhookPayload,
} from '@onsecboad/tiktok';
import { logger } from '../logger.js';
import { findTenantByTikTokAdvertiser, getTikTokCreds } from '../lib/ad-config.js';
import { createLeadFromIngest } from '../lib/lead-create.js';

export async function tiktokLeadsWebhookHandler(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer;
  let parsed: TikTokWebhookPayload;
  try {
    parsed = JSON.parse(rawBody.toString('utf8')) as TikTokWebhookPayload;
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }

  const advertiserId = parsed.advertiser_id;
  if (!advertiserId) {
    // Acknowledge so TikTok doesn't retry; we just don't know which firm this is for.
    res.status(200).send('ok');
    return;
  }

  const tenantId = await findTenantByTikTokAdvertiser(prisma, advertiserId);
  if (!tenantId) {
    logger.warn({ advertiserId }, 'tiktok-leads: no tenant for advertiser');
    res.status(200).send('ok');
    return;
  }

  const creds = await getTikTokCreds(prisma, tenantId);
  const signature = req.header('x-tiktok-signature');
  if (!verifyTikTokSignature(creds, signature, rawBody)) {
    logger.warn({ tenantId, advertiserId }, 'tiktok-leads: invalid signature');
    res.status(401).send('invalid signature');
    return;
  }

  if (parsed.event !== 'lead.create' && parsed.event !== undefined) {
    res.status(200).send('ok'); // events we don't process yet
    return;
  }

  const ttLead = extractTikTokLead(parsed);
  if (!ttLead) {
    res.status(200).send('ok');
    return;
  }

  const eventId = `tiktok-lead-${ttLead.id}`;
  const existing = await prisma.webhookEvent.findUnique({ where: { id: eventId } });
  if (existing?.processedAt) {
    res.status(200).send('ok');
    return;
  }
  if (!existing) {
    try {
      await prisma.webhookEvent.create({
        data: { id: eventId, source: 'tiktok', type: 'lead.create', payload: parsed as object },
      });
    } catch {
      res.status(200).send('ok');
      return;
    }
  }

  try {
    const mapped = mapTikTokFieldsToLead(ttLead.fields);
    await createLeadFromIngest(prisma, {
      tenantId,
      source: 'tiktok',
      externalId: ttLead.id,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      email: mapped.email,
      phone: mapped.phone,
      language: mapped.language,
      caseInterest: mapped.caseInterest,
      consentMarketing: true,
      payload: { tiktok: ttLead.fields, formId: ttLead.formId },
      actorType: 'SYSTEM',
    });
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date() },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error({ err: e, tenantId, leadId: ttLead.id }, 'tiktok-leads: ingest failed');
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { processedAt: new Date(), error: msg },
    });
  }

  res.status(200).send('ok');
}
