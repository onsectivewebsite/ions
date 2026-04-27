/**
 * Per-tenant Twilio config — encrypted at rest in `Tenant.twilio` JSON.
 * Loaded by the call/sms procedures and webhook handlers each time;
 * cheap (single tenant fetch) and avoids cache-invalidation bugs.
 */
import type { PrismaClient } from '@onsecboad/db';
import {
  type TwilioCreds,
  type EncryptedTwilioConfig,
  decryptTwilioCreds,
} from '@onsecboad/twilio';

export async function getTwilioCreds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TwilioCreds | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { twilio: true },
  });
  if (!t?.twilio) return null;
  return decryptTwilioCreds(t.twilio as unknown as EncryptedTwilioConfig);
}
