/**
 * Tenant logo: upload (auth, raw bytes) + public proxy (no auth, streams from R2).
 *
 * Why a proxy instead of returning the R2 URL directly:
 *  - R2 buckets default to private. Signed URLs expire — a logo URL in the
 *    branding column would silently rot.
 *  - The proxy keeps the URL stable (`/api/v1/tenant/:tenantId/logo`) and lets
 *    us swap R2 keys without rewriting the stored URL.
 *  - The route is public because the sign-in / invite pages render the logo
 *    before the user authenticates.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { uploadBuffer, getObject, isDryRun } from '@onsecboad/r2';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';

const env = loadEnv();

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const MAX_BYTES = 2 * 1024 * 1024;

export async function uploadLogoHandler(req: Request, res: Response): Promise<void> {
  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!auth) {
    res.status(401).json({ ok: false, error: 'Missing token' });
    return;
  }
  let claims;
  try {
    claims = await verifyAccessToken(auth, env.JWT_ACCESS_SECRET);
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return;
  }
  if (claims.scope !== 'firm' || !claims.tenantId) {
    res.status(403).json({ ok: false, error: 'Firm scope required' });
    return;
  }

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!ALLOWED.has(contentType)) {
    res.status(400).json({
      ok: false,
      error: `Unsupported type "${contentType}". Allowed: png, jpeg, svg, webp.`,
    });
    return;
  }

  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty body' });
    return;
  }
  if (body.length > MAX_BYTES) {
    res.status(413).json({ ok: false, error: `Logo exceeds ${MAX_BYTES / 1024 / 1024} MB` });
    return;
  }

  const ext =
    contentType === 'image/png'
      ? 'png'
      : contentType === 'image/svg+xml'
        ? 'svg'
        : contentType === 'image/webp'
          ? 'webp'
          : 'jpg';

  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tenantId } });
  const prevBranding = (tenant?.branding ?? {}) as Record<string, unknown>;

  // Without R2 configured we'd silently store a logoR2Key that the proxy
  // can never serve — the user uploads a logo and sees a broken image
  // forever. So when R2 is in dry-run, fall back to a data URL stored
  // directly in branding.logoUrl. Logos are small (≤2 MB) and the JSON
  // column handles it. Real-R2 deployments still use the proxy path.
  let proxyUrl: string;
  let r2Key: string | null = null;
  let bytes: number;
  if (isDryRun()) {
    proxyUrl = `data:${contentType};base64,${body.toString('base64')}`;
    bytes = body.length;
    logger.info(
      { tenantId: claims.tenantId, bytes },
      'logo upload: R2 not configured, storing as data URL',
    );
  } else {
    const key = `tenant/${claims.tenantId}/branding/logo-${Date.now()}.${ext}`;
    const upload = await uploadBuffer(key, body, contentType);
    r2Key = key;
    bytes = upload.bytes;
    proxyUrl = `${env.API_URL.replace(/\/$/, '')}/api/v1/tenant/${claims.tenantId}/logo`;
  }

  const newBranding = {
    ...prevBranding,
    logoUrl: proxyUrl,
    // Carry the key only for real-R2 mode; clear it on data-URL mode so
    // a stale key from a prior real-R2 run doesn't shadow the data URL.
    logoR2Key: r2Key,
  };
  await prisma.tenant.update({
    where: { id: claims.tenantId },
    data: { branding: newBranding },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: claims.tenantId,
      actorId: claims.sub,
      actorType: 'USER',
      action: 'tenant.logo.upload',
      targetType: 'Tenant',
      targetId: claims.tenantId,
      payload: { key: r2Key, bytes, contentType, mode: r2Key ? 'r2' : 'data-url' },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    },
  });

  res.json({ ok: true, url: proxyUrl, bytes });
}

export async function logoProxyHandler(req: Request, res: Response): Promise<void> {
  const tenantId = String(req.params.tenantId ?? '');
  if (!tenantId) {
    res.status(400).json({ ok: false, error: 'Missing tenantId' });
    return;
  }
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { branding: true, deletedAt: true },
  });
  if (!t || t.deletedAt) {
    logger.info({ tenantId }, 'logo proxy: tenant missing or deleted');
    res.status(404).end();
    return;
  }
  const branding = (t.branding ?? {}) as Record<string, unknown>;
  const key = typeof branding.logoR2Key === 'string' ? branding.logoR2Key : null;
  if (!key) {
    logger.info({ tenantId }, 'logo proxy: no logoR2Key set on branding');
    res.status(404).end();
    return;
  }
  if (isDryRun()) {
    // Bucket isn't reachable in dry-run; return a transparent 1×1 png so the
    // <img> tag doesn't show a broken icon during local dev.
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZptCRkAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    return;
  }
  let obj;
  try {
    obj = await getObject(key);
  } catch (e) {
    logger.warn({ err: e, tenantId, key }, 'logo proxy: R2 fetch threw');
    res.status(502).end();
    return;
  }
  if (!obj) {
    logger.warn({ tenantId, key }, 'logo proxy: R2 returned null (bucket misconfigured or object deleted)');
    res.status(404).end();
    return;
  }
  res.set('Content-Type', obj.contentType);
  res.set('Cache-Control', 'public, max-age=300'); // 5 min — short enough to refresh after a re-upload
  res.send(obj.body);
}

logger.debug({ enabled: !isDryRun() }, 'tenant-logo routes ready');
