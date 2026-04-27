/**
 * REST endpoint to upload a fillable PDF template. Same raw-bytes-in-body
 * pattern as document-upload.ts.
 *
 *   POST /api/v1/pdf-templates?name=<>&caseType=<>
 *   Headers: Authorization: Bearer <staff JWT>
 *   Body: raw PDF bytes (Content-Type: application/pdf)
 *
 * On success:
 *   201 { id, fields: [{name, type}] }
 *
 * Detected fields are persisted on the row so the mapping editor can
 * render the dropdowns without re-reading the PDF.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { uploadBuffer, deleteObject } from '@onsecboad/r2';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';
import { extractFields } from '../lib/pdf-fill.js';

const env = loadEnv();

export async function pdfTemplateUploadHandler(req: Request, res: Response): Promise<void> {
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

  const name = String(req.query.name ?? '').trim();
  const caseTypeRaw = String(req.query.caseType ?? '').trim();
  const caseType = caseTypeRaw || null;
  const replaceId = String(req.query.replaceId ?? '').trim() || null;
  const fileName = String(req.query.fileName ?? 'template.pdf').trim();
  const description = String(req.query.description ?? '').trim() || null;
  if (!name) {
    res.status(400).json({ ok: false, error: 'name query param required' });
    return;
  }
  if (caseType && !ALLOWED_CASE_TYPES.has(caseType)) {
    res.status(400).json({ ok: false, error: `Invalid caseType: ${caseType}` });
    return;
  }

  const body = req.body as Buffer;
  if (!body || body.length === 0) {
    res.status(400).json({ ok: false, error: 'Empty body' });
    return;
  }
  if (!body.slice(0, 5).toString('utf8').startsWith('%PDF-')) {
    res.status(400).json({ ok: false, error: 'Body is not a PDF' });
    return;
  }

  let fields;
  try {
    fields = await extractFields(body);
  } catch (e) {
    logger.warn({ err: e }, 'pdf: field extraction failed');
    res
      .status(400)
      .json({ ok: false, error: 'Could not read PDF form fields. Is this a fillable PDF?' });
    return;
  }

  const r2Key = `tenants/${claims.tenantId}/pdf-templates/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  await uploadBuffer(r2Key, body, 'application/pdf');

  try {
    if (replaceId) {
      // Replace existing template's PDF + refresh detected fields.
      const existing = await prisma.pdfFormTemplate.findFirst({
        where: { id: replaceId, tenantId: claims.tenantId },
      });
      if (!existing) {
        res.status(404).json({ ok: false, error: 'Replace target not found' });
        return;
      }
      const oldKey = existing.r2Key;
      const updated = await prisma.pdfFormTemplate.update({
        where: { id: existing.id },
        data: {
          name,
          caseType,
          description,
          r2Key,
          fileName,
          sizeBytes: body.length,
          detectedFieldsJson: fields as unknown as object,
        },
      });
      try {
        await deleteObject(oldKey);
      } catch (e) {
        logger.warn({ err: e, r2Key: oldKey }, 'r2: delete prior pdf template source failed');
      }
      res.status(200).json({ id: updated.id, fields });
      return;
    }
    const created = await prisma.pdfFormTemplate.create({
      data: {
        tenantId: claims.tenantId,
        name,
        caseType,
        description,
        r2Key,
        fileName,
        sizeBytes: body.length,
        detectedFieldsJson: fields as unknown as object,
        mappingJson: [] as unknown as object,
        isActive: true,
        createdBy: claims.sub,
      },
    });
    await prisma.auditLog.create({
      data: {
        tenantId: claims.tenantId,
        actorId: claims.sub,
        actorType: 'USER',
        action: 'pdfTemplate.create',
        targetType: 'PdfFormTemplate',
        targetId: created.id,
        payload: { name, caseType, fileName, fieldCount: fields.length, sizeBytes: body.length },
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
    });
    res.status(201).json({ id: created.id, fields });
  } catch (e) {
    logger.error({ err: e }, 'pdf: template upload failed');
    res.status(500).json({ ok: false, error: 'Upload failed' });
  }
}

const ALLOWED_CASE_TYPES = new Set([
  'work_permit',
  'study_permit',
  'pr',
  'visitor_visa',
  'citizenship',
  'lmia',
  'other',
]);
