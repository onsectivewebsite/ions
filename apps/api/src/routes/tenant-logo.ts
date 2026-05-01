/**
 * Tenant logo: upload (auth, raw bytes) + public proxy (no auth).
 *
 * Storage: logos are stored as data URLs directly inside tenant.branding.logoUrl.
 * They're capped at 2 MB and a typical firm logo is well under 100 KB, so the
 * JSON column handles them comfortably. This keeps logos independent of any
 * external object store (R2, S3, etc.) — the firm's branding belongs in our
 * own database, not a third-party blob store.
 *
 * The /api/v1/tenant/:tenantId/logo proxy route is preserved for backward
 * compatibility with logos uploaded under the old R2 flow (their branding
 * still has logoR2Key set). New uploads bypass the proxy entirely.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { getObject, isDryRun } from '@onsecboad/r2';
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

  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tenantId } });
  const prevBranding = (tenant?.branding ?? {}) as Record<string, unknown>;

  // Always store as data URL directly in branding.logoUrl. No external
  // object store — the firm's logo lives in our database where the rest
  // of their branding lives.
  const logoUrl = `data:${contentType};base64,${body.toString('base64')}`;
  const newBranding = {
    ...prevBranding,
    logoUrl,
    // Clear any legacy R2 key so the data URL takes precedence everywhere.
    logoR2Key: null,
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
      payload: { bytes: body.length, contentType, mode: 'data-url' },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    },
  });

  res.json({ ok: true, url: logoUrl, bytes: body.length });
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
