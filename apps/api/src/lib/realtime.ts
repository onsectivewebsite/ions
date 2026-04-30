/**
 * Real-time event fan-out — Redis pub/sub.
 *
 * One publisher (shared with the rest of the API) and per-connection
 * subscribers. Channels are scoped to (tenant, who) so subscribers only see
 * events meant for them:
 *
 *   tenant:<tenantId>                   — firm-wide announcements
 *   tenant:<tenantId>:branch:<branchId> — branch-wide
 *   tenant:<tenantId>:user:<userId>     — direct (e.g. lead just got assigned)
 *
 * Events use a small set of typed shapes so the web client can switch on
 * `type` without inventing new ones per call site.
 */
import Redis from 'ioredis';
import { loadEnv } from '@onsecboad/config';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const env = loadEnv();

export type RealtimeEvent =
  | { type: 'lead.assigned'; leadId: string; assignedToId: string; firstName?: string; lastName?: string; phone?: string }
  | { type: 'lead.created'; leadId: string; source: string; branchId: string | null }
  | { type: 'sms.received'; smsId: string; leadId: string | null; from: string; bodyPreview: string }
  | { type: 'call.status'; callId: string; status: string; agentId: string | null; leadId: string | null }
  | { type: 'appointment.created'; appointmentId: string; scheduledAt: string; providerId: string }
  | { type: 'appointment.outcome'; appointmentId: string; outcome: string; leadId: string | null }
  | { type: 'case.status'; caseId: string; status: string }
  | {
      type: 'message.new';
      messageId: string;
      clientId: string;
      caseId: string | null;
      sender: 'CLIENT' | 'STAFF' | 'SYSTEM';
      bodyPreview: string;
    }
  | {
      type: 'intake.filled';
      requestId: string;
      submissionId: string;
      leadId: string | null;
      clientId: string | null;
      templateName: string;
    }
  | { type: 'ping'; t: number };

export type EventTarget =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'branch'; tenantId: string; branchId: string }
  | { kind: 'user'; tenantId: string; userId: string };

function channelFor(target: EventTarget): string {
  if (target.kind === 'tenant') return `tenant:${target.tenantId}`;
  if (target.kind === 'branch') return `tenant:${target.tenantId}:branch:${target.branchId}`;
  return `tenant:${target.tenantId}:user:${target.userId}`;
}

export async function publishEvent(target: EventTarget, ev: RealtimeEvent): Promise<void> {
  try {
    await redis.publish(channelFor(target), JSON.stringify(ev));
  } catch (e) {
    // Realtime is best-effort — never fail the originating mutation
    // because Redis pub/sub hiccupped.
    logger.warn({ err: e, target, type: ev.type }, 'realtime publish failed');
  }
}

/**
 * Subscribe a single client to a list of channels. The caller (SSE handler)
 * passes a callback that gets invoked with each parsed event. Returns a
 * disposer that unsubscribes + closes the dedicated connection.
 *
 * We open a *new* ioredis connection per subscriber: ioredis puts a single
 * connection into pub/sub mode for its lifetime, blocking ordinary commands.
 */
export function subscribeChannels(
  channels: string[],
  onEvent: (ev: RealtimeEvent) => void,
): () => void {
  const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  void sub.subscribe(...channels);
  sub.on('message', (_chan, raw) => {
    try {
      onEvent(JSON.parse(raw) as RealtimeEvent);
    } catch {
      /* malformed payload — drop */
    }
  });
  sub.on('error', (err) => logger.warn({ err }, 'realtime subscriber error'));
  return () => {
    void sub.unsubscribe(...channels).catch(() => {});
    sub.disconnect();
  };
}

export function channelsForUser(input: {
  tenantId: string;
  userId: string;
  branchId: string | null;
}): string[] {
  const c = [
    channelFor({ kind: 'tenant', tenantId: input.tenantId }),
    channelFor({ kind: 'user', tenantId: input.tenantId, userId: input.userId }),
  ];
  if (input.branchId) {
    c.push(channelFor({ kind: 'branch', tenantId: input.tenantId, branchId: input.branchId }));
  }
  return c;
}
