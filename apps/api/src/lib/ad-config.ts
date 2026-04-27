/**
 * Per-tenant Meta + TikTok config loaders. Mirrors twilio-config.ts.
 * Webhook handlers call these to resolve creds before signature verification.
 */
import type { PrismaClient } from '@onsecboad/db';
import {
  type MetaCreds,
  type EncryptedMetaConfig,
  decryptMetaCreds,
} from '@onsecboad/meta';
import {
  type TikTokCreds,
  type EncryptedTikTokConfig,
  decryptTikTokCreds,
} from '@onsecboad/tiktok';

export async function getMetaCreds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<MetaCreds | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { meta: true },
  });
  if (!t?.meta) return null;
  return decryptMetaCreds(t.meta as unknown as EncryptedMetaConfig);
}

export async function getTikTokCreds(
  prisma: PrismaClient,
  tenantId: string,
): Promise<TikTokCreds | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { tiktok: true },
  });
  if (!t?.tiktok) return null;
  return decryptTikTokCreds(t.tiktok as unknown as EncryptedTikTokConfig);
}

/**
 * Find the tenant whose Meta page id matches. Page id is stored plaintext in
 * the JSON (it's the routing key, not a secret).
 */
export async function findTenantByMetaPageId(
  prisma: PrismaClient,
  pageId: string,
): Promise<string | null> {
  const tenants = await prisma.tenant.findMany({
    where: { meta: { not: undefined as never }, deletedAt: null },
    select: { id: true, meta: true },
  });
  for (const t of tenants) {
    const cfg = t.meta as { pageId?: string } | null;
    if (cfg?.pageId === pageId) return t.id;
  }
  return null;
}

/**
 * Find tenant by TikTok advertiser id. Plaintext in the JSON.
 */
export async function findTenantByTikTokAdvertiser(
  prisma: PrismaClient,
  advertiserId: string,
): Promise<string | null> {
  const tenants = await prisma.tenant.findMany({
    where: { tiktok: { not: undefined as never }, deletedAt: null },
    select: { id: true, tiktok: true },
  });
  for (const t of tenants) {
    const cfg = t.tiktok as { advertiserId?: string } | null;
    if (cfg?.advertiserId === advertiserId) return t.id;
  }
  return null;
}
