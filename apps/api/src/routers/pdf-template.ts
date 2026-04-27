/**
 * PdfFormTemplate CRUD + per-case generation.
 *
 * The source PDF arrives via a separate REST endpoint (raw body) that
 * also runs field detection — the response carries the new template id.
 * The mapping editor + delete + activate flow live here.
 *
 * Generation pulls CaseAiData.merged (extracted + overrides) and runs
 * fillPdf against the source PDF, writes the result to R2, creates a
 * GeneratedDocument row. Re-running supersedes prior versions and
 * deletes their R2 objects (same pattern as DocumentUpload).
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { uploadBuffer, deleteObject, signedUrl } from '@onsecboad/r2';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { extractFields, fillPdf, type MappingRule } from '../lib/pdf-fill.js';
import { logger } from '../logger.js';

const CASE_TYPES = [
  'work_permit',
  'study_permit',
  'pr',
  'visitor_visa',
  'citizenship',
  'lmia',
  'other',
] as const;

const mappingRuleSchema = z.object({
  pdfField: z.string().min(1).max(200),
  dataPath: z.string().min(1).max(200),
  kind: z.enum(['text', 'checkbox', 'radio']).optional(),
  equals: z.string().max(200).optional(),
  radioOption: z.string().max(200).optional(),
  format: z.enum(['date_yyyymmdd', 'date_dd_mm_yyyy', 'phone_e164', 'upper', 'lower']).optional(),
});

async function fetchPdfBytes(r2Key: string): Promise<Buffer> {
  const url = await signedUrl(r2Key, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF from R2: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const pdfTemplateRouter = router({
  list: requirePermission('documents', 'read').query(async ({ ctx }) => {
    return ctx.prisma.pdfFormTemplate.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ caseType: 'asc' }, { name: 'asc' }],
    });
  }),

  get: requirePermission('documents', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.pdfFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!t) throw new TRPCError({ code: 'NOT_FOUND' });
      return t;
    }),

  // List templates available for a given case type, filtered to active
  // ones with at least one mapping rule. Used by the case page.
  listForCaseType: requirePermission('documents', 'read')
    .input(z.object({ caseType: z.string() }))
    .query(async ({ ctx, input }) => {
      const all = await ctx.prisma.pdfFormTemplate.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          OR: [{ caseType: input.caseType }, { caseType: null }],
        },
        orderBy: [{ caseType: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          caseType: true,
          fileName: true,
          mappingJson: true,
        },
      });
      return all.filter((t) => Array.isArray(t.mappingJson) && (t.mappingJson as unknown[]).length > 0);
    }),

  update: requirePermission('documents', 'write')
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        caseType: z.enum(CASE_TYPES).nullable().optional(),
        description: z.string().max(2000).nullable().optional(),
        mappingJson: z.array(mappingRuleSchema).max(500).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.pdfFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // Validate every pdfField in the mapping references a detected
      // field on the source PDF — catches typos before the lawyer hits
      // Generate.
      if (input.mappingJson) {
        const detected = (existing.detectedFieldsJson as Array<{ name: string }> | null) ?? [];
        const known = new Set(detected.map((d) => d.name));
        const unknown = input.mappingJson
          .map((m) => m.pdfField)
          .filter((f) => !known.has(f));
        if (unknown.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Mapping references unknown PDF fields: ${unknown.join(', ')}`,
          });
        }
      }
      const data: Prisma.PdfFormTemplateUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.caseType !== undefined) data.caseType = input.caseType;
      if (input.description !== undefined) data.description = input.description;
      if (input.mappingJson !== undefined)
        data.mappingJson = input.mappingJson as unknown as Prisma.InputJsonValue;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      const updated = await ctx.prisma.pdfFormTemplate.update({
        where: { id: input.id },
        data,
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'pdfTemplate.update',
          targetType: 'PdfFormTemplate',
          targetId: updated.id,
          payload: { changes: Object.keys(input).filter((k) => k !== 'id') },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  delete: requirePermission('documents', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const inUse = await ctx.prisma.generatedDocument.count({
        where: { tenantId: ctx.tenantId, templateId: input.id, supersededAt: null },
      });
      if (inUse > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot delete: ${inUse} active generated PDF(s) reference this template. Deactivate instead.`,
        });
      }
      const existing = await ctx.prisma.pdfFormTemplate.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      // Best-effort R2 cleanup of the source PDF.
      try {
        await deleteObject(existing.r2Key);
      } catch (e) {
        logger.warn({ err: e, r2Key: existing.r2Key }, 'r2: delete pdf template source failed');
      }
      await ctx.prisma.pdfFormTemplate.delete({ where: { id: input.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'pdfTemplate.delete',
          targetType: 'PdfFormTemplate',
          targetId: input.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),

  // ─── Per-case generation ─────────────────────────────────────────────

  /**
   * Fill the source PDF with CaseAiData.merged + overrides, save to R2,
   * create a GeneratedDocument row. Supersedes any prior non-superseded
   * generation for (case, template) and best-effort deletes the prior R2.
   */
  generate: requirePermission('documents', 'write')
    .input(z.object({ caseId: z.string().uuid(), templateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const tpl = await ctx.prisma.pdfFormTemplate.findFirst({
        where: { id: input.templateId, tenantId: ctx.tenantId, isActive: true },
      });
      if (!tpl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template inactive or missing' });

      const ai = await ctx.prisma.caseAiData.findUnique({ where: { caseId: c.id } });
      if (!ai || ai.status !== 'READY') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Run AI extraction first — no data to fill from.',
        });
      }
      // Build merged view (extracted + overrides).
      const data = (ai.dataJson as Record<string, unknown>) ?? {};
      const overrides = (ai.overridesJson as Record<string, unknown>) ?? {};
      const merged = applyOverrides(data, overrides);

      // Pull source bytes, fill.
      const sourceBuf = await fetchPdfBytes(tpl.r2Key);
      const mapping = (tpl.mappingJson as MappingRule[]) ?? [];
      const { buffer: filledBuf, report } = await fillPdf(sourceBuf, mapping, merged);

      const filledKey = `tenants/${ctx.tenantId}/cases/${c.id}/generated/${Date.now()}-${tpl.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      await uploadBuffer(filledKey, filledBuf, 'application/pdf');

      // Supersede priors for (case, template).
      const priors = await ctx.prisma.generatedDocument.findMany({
        where: {
          tenantId: ctx.tenantId,
          caseId: c.id,
          templateId: tpl.id,
          supersededAt: null,
        },
      });

      const created = await ctx.prisma.$transaction(async (tx) => {
        const inserted = await tx.generatedDocument.create({
          data: {
            tenantId: ctx.tenantId,
            caseId: c.id,
            templateId: tpl.id,
            fileName: tpl.fileName,
            r2Key: filledKey,
            sizeBytes: filledBuf.length,
            dataSnapshot: merged as unknown as Prisma.InputJsonValue,
            generatedById: ctx.session.sub,
          },
        });
        if (priors.length > 0) {
          await tx.generatedDocument.updateMany({
            where: { id: { in: priors.map((p) => p.id) } },
            data: { supersededAt: new Date(), supersededById: inserted.id },
          });
        }
        return inserted;
      });

      for (const p of priors) {
        try {
          await deleteObject(p.r2Key);
        } catch (e) {
          logger.warn({ err: e, r2Key: p.r2Key }, 'r2: delete prior generated pdf failed');
        }
      }

      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'pdfFill.generate',
          targetType: 'GeneratedDocument',
          targetId: created.id,
          payload: {
            caseId: c.id,
            templateId: tpl.id,
            templateName: tpl.name,
            ...report,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });

      logger.info(
        { caseId: c.id, templateId: tpl.id, generatedId: created.id, ...report },
        'pdf: generated',
      );
      return { id: created.id, fileName: tpl.fileName, sizeBytes: filledBuf.length, report };
    }),

  listGeneratedForCase: requirePermission('documents', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      return ctx.prisma.generatedDocument.findMany({
        where: { tenantId: ctx.tenantId, caseId: c.id, supersededAt: null },
        orderBy: { generatedAt: 'desc' },
        include: { template: { select: { id: true, name: true, caseType: true } } },
      });
    }),

  signedDownloadUrl: requirePermission('documents', 'read')
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const g = await ctx.prisma.generatedDocument.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' });
      const url = await signedUrl(g.r2Key, 3600);
      return { url, fileName: g.fileName };
    }),

  deleteGenerated: requirePermission('documents', 'delete')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const g = await ctx.prisma.generatedDocument.findFirst({
        where: { id: input.id, tenantId: ctx.tenantId },
      });
      if (!g) throw new TRPCError({ code: 'NOT_FOUND' });
      try {
        await deleteObject(g.r2Key);
      } catch (e) {
        logger.warn({ err: e, r2Key: g.r2Key }, 'r2: delete generated pdf failed');
      }
      await ctx.prisma.generatedDocument.delete({ where: { id: g.id } });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'pdfFill.deleteGenerated',
          targetType: 'GeneratedDocument',
          targetId: g.id,
          payload: { caseId: g.caseId, templateId: g.templateId },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return { ok: true };
    }),
});

function applyOverrides(
  data: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    setByPath(out, key, value);
  }
  return out;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
