/**
 * Document upload + public collection-link endpoints.
 *
 * Uploads come in as raw bytes in the request body (Content-Type:
 * application/octet-stream), with metadata in query string. Avoids a
 * multer dep; works fine for typical immigration-file sizes (≤50 MB PDFs).
 *
 * Endpoints (all under /api/v1):
 *   POST /cases/:caseId/upload         (auth, staff)
 *   GET  /dc/:token                    (public preview)
 *   POST /dc/:token/upload             (public client upload)
 *   POST /dc/:token/submit             (public auto-lock)
 *
 * Re-upload supersede: when a non-superseded DocumentUpload already exists
 * for the same (collectionId, itemKey), we mark it superseded AND delete
 * the prior R2 object — per docs invariant "Document re-upload deletes
 * prior version on disk".
 */
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { uploadBuffer, deleteObject } from '@onsecboad/r2';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';
import { hashCollectionToken, type ChecklistItem } from '../lib/document-collection.js';

const env = loadEnv();

type FileMeta = { itemKey: string; fileName: string; contentType: string };

function parseQuery(req: Request): FileMeta | null {
  const itemKey = String(req.query.itemKey ?? '');
  const fileName = String(req.query.fileName ?? '');
  const contentType = String(req.query.contentType ?? 'application/octet-stream');
  if (!itemKey || !fileName) return null;
  return { itemKey, fileName, contentType };
}

function validateAgainstItem(
  meta: FileMeta,
  body: Buffer,
  item: ChecklistItem,
): string | null {
  if (item.maxSizeMb && body.length > item.maxSizeMb * 1024 * 1024) {
    return `File exceeds ${item.maxSizeMb} MB limit for ${item.label}`;
  }
  if (item.accept && item.accept.length > 0) {
    const ext = '.' + (meta.fileName.split('.').pop() ?? '').toLowerCase();
    const ok = item.accept.some((a) => {
      const al = a.toLowerCase();
      if (al.startsWith('.')) return al === ext;
      return al === meta.contentType.toLowerCase();
    });
    if (!ok) {
      return `${meta.fileName} doesn't match the accepted types for ${item.label}: ${item.accept.join(', ')}`;
    }
  }
  return null;
}

async function findCollectionByPublicToken(token: string) {
  if (!token) return null;
  const hash = hashCollectionToken(token);
  const c = await prisma.documentCollection.findUnique({
    where: { publicTokenHash: hash },
    include: {
      tenant: { select: { displayName: true, branding: true } },
      uploads: { where: { supersededAt: null }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!c) return null;
  if (c.publicTokenExpiresAt && c.publicTokenExpiresAt < new Date()) return null;
  return c;
}

async function persistUpload(args: {
  tenantId: string;
  caseId: string;
  collectionId: string;
  itemKey: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}): Promise<{ id: string; r2Key: string; sizeBytes: number; sha256: string }> {
  const sha256 = createHash('sha256').update(args.body).digest('hex');
  const r2Key = `tenants/${args.tenantId}/cases/${args.caseId}/${args.itemKey}/${Date.now()}-${args.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  // Re-upload supersede invariant: mark prior versions superseded AND delete
  // their R2 objects. Done in a single transaction so we never end up with
  // two non-superseded rows for the same item.
  const priors = await prisma.documentUpload.findMany({
    where: {
      tenantId: args.tenantId,
      collectionId: args.collectionId,
      itemKey: args.itemKey,
      supersededAt: null,
    },
  });

  await uploadBuffer(r2Key, args.body, args.contentType);

  const created = await prisma.$transaction(async (tx) => {
    const supersededAt = new Date();
    const inserted = await tx.documentUpload.create({
      data: {
        tenantId: args.tenantId,
        caseId: args.caseId,
        collectionId: args.collectionId,
        itemKey: args.itemKey,
        fileName: args.fileName,
        contentType: args.contentType,
        sizeBytes: args.body.length,
        r2Key,
        sha256,
        uploadedById: args.uploadedById ?? null,
        uploadedByName: args.uploadedByName ?? null,
      },
    });
    if (priors.length > 0) {
      await tx.documentUpload.updateMany({
        where: { id: { in: priors.map((p) => p.id) } },
        data: { supersededAt, supersededById: inserted.id },
      });
    }
    return inserted;
  });

  // Best-effort delete of R2 keys for prior versions (don't fail if R2 gripes).
  for (const p of priors) {
    try {
      await deleteObject(p.r2Key);
    } catch (e) {
      logger.warn({ err: e, r2Key: p.r2Key }, 'r2 delete prior version failed');
    }
  }

  return { id: created.id, r2Key, sizeBytes: args.body.length, sha256 };
}

// ─── Staff upload (auth required) ─────────────────────────────────────────

export async function staffUploadHandler(req: Request, res: Response): Promise<void> {
  const auth = req.header('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    res.status(401).json({ ok: false, error: 'Missing bearer token' });
    return;
  }
  let claims;
  try {
    claims = await verifyAccessToken(auth.slice(7), env.JWT_ACCESS_SECRET);
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return;
  }
  if (claims.scope !== 'firm' || !claims.tenantId) {
    res.status(403).json({ ok: false, error: 'Firm token required' });
    return;
  }
  const meta = parseQuery(req);
  if (!meta) {
    res.status(400).json({ ok: false, error: 'itemKey + fileName required' });
    return;
  }
  const caseId = String(req.params.caseId ?? '');
  if (!caseId) {
    res.status(400).json({ ok: false, error: 'caseId required' });
    return;
  }

  const c = await prisma.case.findFirst({
    where: { id: caseId, tenantId: claims.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!c) {
    res.status(404).json({ ok: false, error: 'Case not found' });
    return;
  }

  const collection = await prisma.documentCollection.findUnique({
    where: { caseId },
  });
  if (!collection) {
    res.status(409).json({
      ok: false,
      error: 'Collection not initialised. Open the case in the UI first.',
    });
    return;
  }
  if (collection.status === 'LOCKED') {
    res.status(409).json({ ok: false, error: 'Collection is LOCKED — unlock first.' });
    return;
  }
  const items = (collection.itemsJson as unknown as ChecklistItem[]) ?? [];
  const item = items.find((i) => i.key === meta.itemKey);
  if (!item) {
    res.status(400).json({ ok: false, error: `Unknown item key: ${meta.itemKey}` });
    return;
  }

  const body = req.body as Buffer;
  if (!body || body.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty body' });
    return;
  }
  const violation = validateAgainstItem(meta, body, item);
  if (violation) {
    res.status(400).json({ ok: false, error: violation });
    return;
  }

  try {
    const r = await persistUpload({
      tenantId: claims.tenantId,
      caseId,
      collectionId: collection.id,
      itemKey: meta.itemKey,
      fileName: meta.fileName,
      contentType: meta.contentType,
      body,
      uploadedById: claims.sub,
    });
    await prisma.auditLog.create({
      data: {
        tenantId: claims.tenantId,
        actorId: claims.sub,
        actorType: 'USER',
        action: 'document.upload',
        targetType: 'DocumentUpload',
        targetId: r.id,
        payload: {
          caseId,
          itemKey: meta.itemKey,
          fileName: meta.fileName,
          sizeBytes: r.sizeBytes,
          source: 'staff',
        },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
    });
    res.status(201).json({ ok: true, ...r });
  } catch (e) {
    logger.error({ err: e, caseId, itemKey: meta.itemKey }, 'staff upload failed');
    res.status(500).json({ ok: false, error: 'Upload failed' });
  }
}

// ─── Public collection link (no auth, token-based) ────────────────────────

export async function publicCollectionGetHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token ?? '');
  const c = await findCollectionByPublicToken(token);
  if (!c) {
    res.status(404).json({ ok: false, error: 'Link is invalid or has expired' });
    return;
  }
  if (c.status === 'LOCKED') {
    // Surface the locked state so the public page shows a friendly message.
    res.status(200).json({
      ok: true,
      locked: true,
      firm: { displayName: c.tenant.displayName, branding: c.tenant.branding },
      submittedAt: c.submittedAt,
    });
    return;
  }
  // Non-locked: render the items + which slots are filled.
  const items = (c.itemsJson as unknown as ChecklistItem[]) ?? [];
  const byKey = new Map<string, typeof c.uploads>();
  for (const u of c.uploads) {
    const list = byKey.get(u.itemKey) ?? [];
    list.push(u);
    byKey.set(u.itemKey, list);
  }
  res.status(200).json({
    ok: true,
    locked: false,
    firm: { displayName: c.tenant.displayName, branding: c.tenant.branding },
    items: items.map((i) => ({
      ...i,
      uploads: (byKey.get(i.key) ?? []).map((u) => ({
        id: u.id,
        fileName: u.fileName,
        sizeBytes: u.sizeBytes,
        uploadedAt: u.createdAt,
      })),
      complete: (byKey.get(i.key)?.length ?? 0) > 0,
    })),
    requiredCount: items.filter((i) => i.required).length,
    requiredDone: items.filter((i) => i.required && (byKey.get(i.key)?.length ?? 0) > 0).length,
  });
}

export async function publicCollectionUploadHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token ?? '');
  const c = await findCollectionByPublicToken(token);
  if (!c) {
    res.status(404).json({ ok: false, error: 'Link is invalid or has expired' });
    return;
  }
  if (c.status === 'LOCKED') {
    res.status(409).json({ ok: false, error: 'Collection is locked.' });
    return;
  }
  const meta = parseQuery(req);
  if (!meta) {
    res.status(400).json({ ok: false, error: 'itemKey + fileName required' });
    return;
  }
  const items = (c.itemsJson as unknown as ChecklistItem[]) ?? [];
  const item = items.find((i) => i.key === meta.itemKey);
  if (!item) {
    res.status(400).json({ ok: false, error: `Unknown item key` });
    return;
  }
  const body = req.body as Buffer;
  if (!body || body.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty body' });
    return;
  }
  const violation = validateAgainstItem(meta, body, item);
  if (violation) {
    res.status(400).json({ ok: false, error: violation });
    return;
  }
  try {
    // signedName from the public form (optional) — we'll just stash the raw
    // header value as a quick attribution.
    const uploadedByName = req.header('x-signer-name') ?? null;
    const r = await persistUpload({
      tenantId: c.tenantId,
      caseId: c.caseId,
      collectionId: c.id,
      itemKey: meta.itemKey,
      fileName: meta.fileName,
      contentType: meta.contentType,
      body,
      uploadedById: null,
      uploadedByName,
    });
    await prisma.auditLog.create({
      data: {
        tenantId: c.tenantId,
        actorId: '00000000-0000-0000-0000-000000000000',
        actorType: 'SYSTEM',
        action: 'document.upload',
        targetType: 'DocumentUpload',
        targetId: r.id,
        payload: {
          caseId: c.caseId,
          itemKey: meta.itemKey,
          fileName: meta.fileName,
          sizeBytes: r.sizeBytes,
          source: 'public',
          signerName: uploadedByName ?? null,
        },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
    });
    res.status(201).json({ ok: true, ...r });
  } catch (e) {
    logger.error({ err: e, caseId: c.caseId, itemKey: meta.itemKey }, 'public upload failed');
    res.status(500).json({ ok: false, error: 'Upload failed' });
  }
}

export async function publicCollectionSubmitHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.params.token ?? '');
  const c = await findCollectionByPublicToken(token);
  if (!c) {
    res.status(404).json({ ok: false, error: 'Link is invalid or has expired' });
    return;
  }
  if (c.status === 'LOCKED') {
    res.status(200).json({ ok: true, alreadyLocked: true });
    return;
  }
  const items = (c.itemsJson as unknown as ChecklistItem[]) ?? [];
  // Soft check: warn if required items are missing, but allow the client to
  // submit anyway (they may need to come back). Staff can unlock if needed.
  const missingRequired = items
    .filter((i) => i.required)
    .filter((i) => !c.uploads.some((u) => u.itemKey === i.key));

  const now = new Date();
  await prisma.documentCollection.update({
    where: { id: c.id },
    data: { status: 'LOCKED', submittedAt: now, lockedAt: now },
  });
  await prisma.auditLog.create({
    data: {
      tenantId: c.tenantId,
      actorId: '00000000-0000-0000-0000-000000000000',
      actorType: 'SYSTEM',
      action: 'documentCollection.submit',
      targetType: 'DocumentCollection',
      targetId: c.id,
      payload: {
        caseId: c.caseId,
        uploads: c.uploads.length,
        missingRequired: missingRequired.map((m) => m.key),
      },
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    },
  });
  res.status(200).json({
    ok: true,
    alreadyLocked: false,
    missingRequired: missingRequired.map((m) => m.label),
  });
}
