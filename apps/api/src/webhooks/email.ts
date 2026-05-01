/**
 * Generic email-provider webhook. Accepts deliverability events from
 * Postmark / SendGrid / Resend / SES and updates the matching EmailLog
 * row by providerId. Each provider uses a slightly different shape so we
 * normalize before writing.
 *
 * URL: POST /api/v1/webhooks/email
 *
 * Auth: shared secret in `Authorization: Bearer <EMAIL_WEBHOOK_SECRET>`.
 * The provider needs the secret configured at their end. Any request
 * missing or wrong-secret is dropped.
 *
 * No tenant context — events are matched by EmailLog.providerId, which
 * the send code stamps in earlier. Unknown providerIds are logged and
 * dropped (likely a provider replay or a message we sent before this
 * webhook was wired).
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';

const env = loadEnv();

type NormalizedEvent = {
  providerId: string;
  type: 'delivered' | 'bounced' | 'complained' | 'opened' | 'clicked';
  bounceType?: 'hard' | 'soft' | 'undetermined';
  bounceReason?: string;
  at: Date;
};

function parsePostmark(body: unknown): NormalizedEvent[] {
  // Postmark posts a single object: { RecordType, MessageID, ... }.
  // Or an array if "Multiple events" is enabled.
  const arr = Array.isArray(body) ? body : [body];
  const out: NormalizedEvent[] = [];
  for (const e of arr) {
    if (typeof e !== 'object' || e === null) continue;
    const ev = e as Record<string, unknown>;
    const id = String(ev.MessageID ?? ev.messageId ?? '');
    if (!id) continue;
    const at = new Date(String(ev.DeliveredAt ?? ev.BouncedAt ?? ev.ReceivedAt ?? Date.now()));
    const rt = String(ev.RecordType ?? '');
    if (rt === 'Delivery') {
      out.push({ providerId: id, type: 'delivered', at });
    } else if (rt === 'Bounce') {
      const hard = String(ev.Type ?? '') === 'HardBounce';
      out.push({
        providerId: id,
        type: 'bounced',
        at,
        bounceType: hard ? 'hard' : 'soft',
        bounceReason: String(ev.Description ?? ev.Details ?? ''),
      });
    } else if (rt === 'SpamComplaint') {
      out.push({ providerId: id, type: 'complained', at });
    } else if (rt === 'Open') {
      out.push({ providerId: id, type: 'opened', at });
    } else if (rt === 'Click') {
      out.push({ providerId: id, type: 'clicked', at });
    }
  }
  return out;
}

function parseSendGrid(body: unknown): NormalizedEvent[] {
  // SendGrid: array of events with sg_message_id.
  if (!Array.isArray(body)) return [];
  const out: NormalizedEvent[] = [];
  for (const e of body) {
    if (typeof e !== 'object' || e === null) continue;
    const ev = e as Record<string, unknown>;
    const id = String(ev.sg_message_id ?? ev['smtp-id'] ?? '').split('.')[0] ?? '';
    if (!id) continue;
    const at = new Date(Number(ev.timestamp ?? Date.now() / 1000) * 1000);
    const event = String(ev.event ?? '');
    if (event === 'delivered') {
      out.push({ providerId: id, type: 'delivered', at });
    } else if (event === 'bounce') {
      out.push({
        providerId: id,
        type: 'bounced',
        at,
        bounceType: String(ev.type ?? '') === 'bounce' ? 'hard' : 'soft',
        bounceReason: String(ev.reason ?? ''),
      });
    } else if (event === 'spamreport' || event === 'complaint') {
      out.push({ providerId: id, type: 'complained', at });
    } else if (event === 'open') {
      out.push({ providerId: id, type: 'opened', at });
    } else if (event === 'click') {
      out.push({ providerId: id, type: 'clicked', at });
    }
  }
  return out;
}

function parseResend(body: unknown): NormalizedEvent[] {
  // Resend: { type, created_at, data: { email_id, ... } }
  if (typeof body !== 'object' || body === null) return [];
  const ev = body as Record<string, unknown>;
  const data = (ev.data as Record<string, unknown> | undefined) ?? {};
  const id = String(data.email_id ?? '');
  if (!id) return [];
  const at = new Date(String(ev.created_at ?? Date.now()));
  const t = String(ev.type ?? '');
  if (t === 'email.delivered') return [{ providerId: id, type: 'delivered', at }];
  if (t === 'email.bounced') {
    return [
      {
        providerId: id,
        type: 'bounced',
        at,
        bounceType: String((data.bounce as Record<string, unknown> | undefined)?.bounceType ?? 'undetermined') as
          | 'hard'
          | 'soft'
          | 'undetermined',
        bounceReason: String((data.bounce as Record<string, unknown> | undefined)?.message ?? ''),
      },
    ];
  }
  if (t === 'email.complained') return [{ providerId: id, type: 'complained', at }];
  if (t === 'email.opened') return [{ providerId: id, type: 'opened', at }];
  if (t === 'email.clicked') return [{ providerId: id, type: 'clicked', at }];
  return [];
}

function normalize(body: unknown): NormalizedEvent[] {
  // Try each shape in turn; first match wins.
  const postmark = parsePostmark(body);
  if (postmark.length) return postmark;
  const sendgrid = parseSendGrid(body);
  if (sendgrid.length) return sendgrid;
  const resend = parseResend(body);
  if (resend.length) return resend;
  return [];
}

export async function emailWebhookHandler(req: Request, res: Response): Promise<void> {
  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const expected = env.EMAIL_WEBHOOK_SECRET ?? '';
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Webhook not configured' });
    return;
  }
  if (auth !== expected) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const events = normalize(req.body);
  if (events.length === 0) {
    res.status(202).json({ ok: true, processed: 0, note: 'unrecognized payload' });
    return;
  }

  let updated = 0;
  for (const e of events) {
    const row = await prisma.emailLog.findUnique({ where: { providerId: e.providerId } });
    if (!row) continue;
    const data: Record<string, unknown> = {};
    if (e.type === 'delivered') {
      data.deliveredAt = e.at;
      if (row.status === 'sent') data.status = 'delivered';
    } else if (e.type === 'bounced') {
      data.bouncedAt = e.at;
      data.bounceType = e.bounceType ?? null;
      data.bounceReason = e.bounceReason ?? null;
      data.status = 'bounced';
    } else if (e.type === 'complained') {
      data.complainedAt = e.at;
      data.status = 'complained';
    } else if (e.type === 'opened') {
      if (!row.openedAt) data.openedAt = e.at;
      if (row.status === 'sent' || row.status === 'delivered') data.status = 'opened';
    } else if (e.type === 'clicked') {
      if (!row.clickedAt) data.clickedAt = e.at;
      data.status = 'clicked';
    }
    await prisma.emailLog.update({ where: { id: row.id }, data });
    updated++;
  }

  logger.info({ processed: events.length, updated }, 'email webhook');
  res.json({ ok: true, processed: events.length, updated });
}
