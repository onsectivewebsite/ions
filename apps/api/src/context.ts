import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { verifyAccessToken, type AccessClaims } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { logger } from './logger.js';

const env = loadEnv();

export type Ctx = {
  prisma: typeof prisma;
  log: typeof logger;
  ip: string;
  userAgent: string | undefined;
  /**
   * ISO 3166-1 alpha-2 country code. Set in prod by Cloudflare via the
   * `cf-ipcountry` header; null on local dev or behind any proxy that
   * doesn't forward it. Anomaly detection skips country checks when null.
   */
  country: string | null;
  session: AccessClaims | null;
};

export async function createContext({ req }: CreateExpressContextOptions): Promise<Ctx> {
  const auth = req.header('authorization');
  let session: AccessClaims | null = null;
  if (auth?.startsWith('Bearer ')) {
    try {
      session = await verifyAccessToken(auth.slice(7), env.JWT_ACCESS_SECRET);
    } catch {
      session = null;
    }
  }
  // Reject sessions belonging to dead tenants OR disabled/deleted users —
  // even on shared procedures (user.me, auth.signOut, etc). The JWT is
  // technically valid but the underlying actor is no longer allowed in.
  // Catches:
  //   - tenant deleted / canceled / suspended  → "firm gone"
  //   - user disabled / deleted                → "you specifically gone"
  //
  // Without this, disabled users could keep using the app for up to the
  // access-token TTL (15 min default) on their existing JWT.
  if (session && session.scope === 'firm' && session.tenantId) {
    const [tenant, user] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { status: true, deletedAt: true },
      }),
      prisma.user.findUnique({
        where: { id: session.sub },
        select: { status: true, deletedAt: true },
      }),
    ]);
    const tenantDead =
      !tenant ||
      tenant.deletedAt ||
      tenant.status === 'CANCELED' ||
      tenant.status === 'SUSPENDED';
    const userDead = !user || user.deletedAt || user.status !== 'ACTIVE';
    if (tenantDead || userDead) {
      session = null;
    }
  }
  if (session && session.scope === 'platform') {
    // Platform users have no status field, but we still check existence
    // so a deleted PlatformUser row can't keep operating.
    const pu = await prisma.platformUser.findUnique({
      where: { id: session.sub },
      select: { id: true },
    });
    if (!pu) session = null;
  }
  // Client portal — same dead-tenant + dead-account guard as the firm
  // path. The JWT subject is the ClientPortalAccount.id; tenantId is in
  // the claim so we can verify the firm is still active.
  if (session && session.scope === 'client' && session.tenantId) {
    const [tenant, account] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { status: true, deletedAt: true },
      }),
      prisma.clientPortalAccount.findUnique({
        where: { id: session.sub },
        select: { status: true, clientId: true },
      }),
    ]);
    const tenantDead =
      !tenant ||
      tenant.deletedAt ||
      tenant.status === 'CANCELED' ||
      tenant.status === 'SUSPENDED';
    const accountDead = !account || account.status !== 'ACTIVE';
    if (tenantDead || accountDead) {
      session = null;
    }
  }
  const cfCountry = (req.header('cf-ipcountry') ?? '').toUpperCase().trim();
  // Cloudflare uses 'XX' / 'T1' / 'XX' for unknown / Tor / unidentified.
  const country =
    cfCountry && cfCountry !== 'XX' && cfCountry !== 'T1' && cfCountry.length === 2
      ? cfCountry
      : null;
  return {
    prisma,
    log: logger.child({ reqId: req.id ?? undefined }),
    ip: req.ip ?? '0.0.0.0',
    userAgent: req.header('user-agent'),
    country,
    session,
  };
}
