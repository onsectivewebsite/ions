/**
 * CASL suppression helper — Phase 10.1.
 *
 * Single source of truth for "is this recipient on the firm's
 * do-not-send list?" Wired into Twilio sendSms + transactional email
 * paths so a single unsubscribe / complaint blocks every future send,
 * regardless of which surface initiated it (campaign, doc-collection
 * link, agent, manual reply).
 *
 * Keys are normalised at write-time: phone numbers stripped to E.164
 * digits-only, emails lower-cased.
 */
import type { PrismaClient } from '@onsecboad/db';

export type SuppressionChannel = 'sms' | 'email';

export function normalisePhone(raw: string): string {
  // Keep the leading '+' if present, drop everything else non-digit.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normaliseValue(channel: SuppressionChannel, raw: string): string {
  return channel === 'sms' ? normalisePhone(raw) : normaliseEmail(raw);
}

export async function isSuppressed(
  prisma: PrismaClient,
  tenantId: string,
  channel: SuppressionChannel,
  rawValue: string,
): Promise<boolean> {
  const value = normaliseValue(channel, rawValue);
  if (!value) return false;
  const row = await prisma.suppressionEntry.findUnique({
    where: { tenantId_channel_value: { tenantId, channel, value } },
  });
  return !!row;
}

export async function addSuppression(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    channel: SuppressionChannel;
    value: string;
    reason?: string | null;
    source?: 'unsubscribe' | 'complaint' | 'admin' | 'bounce';
    addedById?: string | null;
  },
): Promise<void> {
  const value = normaliseValue(args.channel, args.value);
  if (!value) return;
  await prisma.suppressionEntry.upsert({
    where: { tenantId_channel_value: { tenantId: args.tenantId, channel: args.channel, value } },
    create: {
      tenantId: args.tenantId,
      channel: args.channel,
      value,
      reason: args.reason ?? null,
      source: args.source ?? 'admin',
      addedById: args.addedById ?? null,
    },
    update: {
      // Re-applying suppression refreshes the source/reason if provided.
      reason: args.reason ?? undefined,
      source: args.source ?? undefined,
      addedAt: new Date(),
    },
  });
}

export async function removeSuppression(
  prisma: PrismaClient,
  tenantId: string,
  channel: SuppressionChannel,
  rawValue: string,
): Promise<void> {
  const value = normaliseValue(channel, rawValue);
  await prisma.suppressionEntry
    .delete({
      where: { tenantId_channel_value: { tenantId, channel, value } },
    })
    .catch(() => undefined);
}
