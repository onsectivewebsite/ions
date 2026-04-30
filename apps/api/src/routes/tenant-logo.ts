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
  const key = `tenant/${claims.tenantId}/branding/logo-${Date.now()}.${ext}`;
  const upload = await uploadBuffer(key, body, contentType);

  // The stored URL is a stable proxy URL. The actual R2 key lives in
  // branding.logoR2Key so the proxy can re-fetch.
  const proxyUrl = `${env.API_URL.replace(/\/$/, '')}/api/v1/tenant/${claims.tenantId}/logo`;
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tenantId } });
  const prevBranding = (tenant?.branding ?? {}) as Record<string, unknown>;
  const newBranding = {
    ...prevBranding,
    logoUrl: proxyUrl,
    logoR2Key: key,
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
      payload: { key, bytes: upload.bytes, contentType },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    },
  });

  res.json({ ok: true, url: proxyUrl, bytes: upload.bytes });
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
    res.status(404).end();
    return;
  }
  const branding = (t.branding ?? {}) as Record<string, unknown>;
  const key = typeof branding.logoR2Key === 'string' ? branding.logoR2Key : null;
  if (!key) {
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
  const obj = await getObject(key);
  if (!obj) {
    res.status(404).end();
    return;
  }
  res.set('Content-Type', obj.contentType);
  res.set('Cache-Control', 'public, max-age=300'); // 5 min — short enough to refresh after a re-upload
  res.send(obj.body);
}

logger.debug({ enabled: !isDryRun() }, 'tenant-logo routes ready');
