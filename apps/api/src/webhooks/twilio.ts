/**
 * Twilio webhook handlers — voice status, recording, inbound SMS.
 *
 * Slice 3.3.1 ships these as functional stubs: signature verification +
 * idempotent persistence. The "route inbound call to an available agent"
 * smarts come with the softphone in Slice 3.3.2.
 *
 * Idempotency: every Twilio webhook carries a unique SID — we persist it
 * to WebhookEvent on first receipt (same table as Stripe), short-circuit
 * duplicates with 200.
 */
import type { Request, Response } from 'express';
import { verifyTwilioSignature } from '@onsecboad/twilio';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';
import { getTwilioCreds } from '../lib/twilio-config.js';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

async function findTenantByPhoneNumber(phoneNumber: string): Promise<string | null> {
  // Phase 3: each firm has one Twilio number. Find the tenant whose
  // encrypted twilio.phoneNumber equals the dialed number. We match on
  // plaintext because phoneNumber is stored unencrypted in the JSON.
  const tenants = await prisma.tenant.findMany({
    where: { twilio: { not: undefined as never }, deletedAt: null },
    select: { id: true, twilio: true },
  });
  for (const t of tenants) {
    const cfg = t.twilio as { phoneNumber?: string } | null;
    if (cfg?.phoneNumber === phoneNumber) return t.id;
  }
  return null;
}

async function recordWebhook(
  source: string,
  type: string,
  sid: string | null,
  payload: unknown,
): Promise<{ duplicate: boolean }> {
  if (!sid) return { duplicate: false };
  const existing = await prisma.webhookEvent.findUnique({ where: { id: sid } });
  if (existing?.processedAt) return { duplicate: true };
  if (!existing) {
    try {
      await prisma.webhookEvent.create({
        data: { id: sid, source, type, payload: payload as object },
      });
    } catch {
      return { duplicate: true };
    }
  }
  return { duplicate: false };
}

async function markProcessed(sid: string | null, error?: string): Promise<void> {
  if (!sid) return;
  await prisma.webhookEvent.update({
    where: { id: sid },
    data: { processedAt: new Date(), error: error ?? null },
  });
}

// ─── Voice status callback ────────────────────────────────────────────────

export async function twilioVoiceStatusHandler(req: Request, res: Response): Promise<void> {
  const params = req.body as Record<string, string>;
  const callSid = params.CallSid ?? null;
  const callStatus = params.CallStatus ?? '';
  const to = params.To ?? '';
  const from = params.From ?? '';

  // Identify the tenant. For outbound calls, From=our number; for inbound, To=our number.
  const tenantId =
    (await findTenantByPhoneNumber(from)) ?? (await findTenantByPhoneNumber(to));
  if (!tenantId) {
    logger.warn({ callSid, to, from }, 'twilio voice status: no matching tenant');
    res.status(200).send(''); // ack so Twilio doesn't retry
    return;
  }

  const creds = await getTwilioCreds(prisma, tenantId);
  const sigOk = verifyTwilioSignature(
    creds,
    req.header('x-twilio-signature'),
    `${env.API_URL}/api/v1/webhooks/twilio-voice/status`,
    params,
  );
  if (!sigOk) {
    res.status(401).json({ ok: false, error: 'invalid signature' });
    return;
  }

  const { duplicate } = await recordWebhook('twilio', 'voice.status', `${callSid}-${callStatus}`, params);
  if (duplicate) {
    res.status(200).send('');
    return;
  }

  try {
    if (callSid) {
      await prisma.callLog.updateMany({
        where: { tenantId, twilioSid: callSid },
        data: {
          status: callStatus,
          ...(params.CallDuration ? { durationSec: parseInt(params.CallDuration, 10) } : {}),
          ...(callStatus === 'completed' ? { endedAt: new Date() } : {}),
        },
      });
    }
    await markProcessed(`${callSid}-${callStatus}`);
  } catch (e) {
    await markProcessed(`${callSid}-${callStatus}`, e instanceof Error ? e.message : String(e));
    logger.error({ err: e, callSid }, 'voice status handler error');
  }
  res.status(200).send('');
}

// ─── Recording status ─────────────────────────────────────────────────────

export async function twilioRecordingStatusHandler(req: Request, res: Response): Promise<void> {
  const params = req.body as Record<string, string>;
  const callSid = params.CallSid ?? null;
  const recordingSid = params.RecordingSid ?? null;
  const recordingUrl = params.RecordingUrl ?? null;

  // Slice 3.3.2 will queue a job to fetch the recording into R2 and
  // generate a signed URL. For now, just persist the Twilio-hosted URL
  // on the matching CallLog row.
  if (callSid && recordingSid && recordingUrl) {
    await prisma.callLog.updateMany({
      where: { twilioSid: callSid },
      data: {
        recordingSid,
        recordingUrl,
      },
    });
  }
  await recordWebhook('twilio', 'recording.status', recordingSid, params);
  await markProcessed(recordingSid);
  res.status(200).send('');
}

// ─── Inbound SMS ──────────────────────────────────────────────────────────

export async function twilioSmsIncomingHandler(req: Request, res: Response): Promise<void> {
  const params = req.body as Record<string, string>;
  const messageSid = params.MessageSid ?? params.SmsSid ?? null;
  const from = params.From ?? '';
  const to = params.To ?? '';
  const body = params.Body ?? '';

  const tenantId = await findTenantByPhoneNumber(to);
  if (!tenantId) {
    res.set('content-type', 'text/xml').status(200).send('<Response/>');
    return;
  }

  // Match to a lead by phone number (most recent if multiple).
  const lead = await prisma.lead.findFirst({
    where: { tenantId, phone: from, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  await prisma.smsLog.create({
    data: {
      tenantId,
      leadId: lead?.id,
      twilioSid: messageSid ?? undefined,
      direction: 'inbound',
      fromNumber: from,
      toNumber: to,
      body,
      status: 'received',
    },
  });

  await recordWebhook('twilio', 'sms.incoming', messageSid, params);
  await markProcessed(messageSid);
  res.set('content-type', 'text/xml').status(200).send('<Response/>');
}
