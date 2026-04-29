/**
 * Case AI router. One row per case in CaseAiData. Run pulls every
 * non-superseded DocumentUpload + every IntakeSubmission for the case,
 * fetches each upload's bytes from R2, and ships them to Claude for
 * extraction. Result is persisted with provenance.
 *
 * Manual overrides are kept in `overridesJson` so re-running AI doesn't
 * blow away a lawyer's edit. The `get` endpoint returns the merged view
 * (overrides win when present).
 *
 * Permissions: gated on `ai.read` / `ai.write`. Defaults in seed grant
 * write/case to LAWYER, CONSULTANT, FILER, CASE_MANAGER.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { Prisma } from '@onsecboad/db';
import { signedUrl } from '@onsecboad/r2';
import { extractCaseData, aiMode } from '@onsecboad/ai';
import {
  AiBudgetExceeded,
  AiDisabled,
  assertAiAllowed,
  logAiUsage,
} from '../lib/ai-usage.js';
import { router } from '../trpc.js';
import { requirePermission } from '../lib/permissions.js';
import { logger } from '../logger.js';

const MAX_DOCUMENTS = 10;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB per file before we skip it

async function fetchUploadBytes(r2Key: string): Promise<Buffer> {
  // Even in real R2 mode we use the signed-GET URL to fetch — keeps a
  // single code path that also works in dry-run.
  const url = await signedUrl(r2Key, 600);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch upload from R2: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Merge overrides into data using flat dotted keys (e.g. 'applicant.firstName'). */
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
    if (typeof cur[k] !== 'object' || cur[k] === null) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export const caseAiRouter = router({
  // Returns the latest extracted data merged with overrides.
  get: requirePermission('ai', 'read')
    .input(z.object({ caseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, caseType: true },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
      const row = await ctx.prisma.caseAiData.findUnique({
        where: { caseId: c.id },
      });
      if (!row) {
        return {
          status: 'EMPTY' as const,
          caseType: c.caseType,
          data: {},
          provenance: {},
          overrides: {},
          merged: {},
          uploadsConsidered: 0,
          lastRunAt: null,
          lastError: null,
          lastMode: null,
        };
      }
      const data = (row.dataJson as Record<string, unknown>) ?? {};
      const provenance = (row.provenanceJson as Record<string, unknown>) ?? {};
      const overrides = (row.overridesJson as Record<string, unknown>) ?? {};
      return {
        status: row.status,
        caseType: row.caseType,
        data,
        provenance,
        overrides,
        merged: applyOverrides(data, overrides),
        uploadsConsidered: row.uploadsConsidered,
        lastRunAt: row.lastRunAt,
        lastError: row.lastError,
        lastMode: row.lastMode,
      };
    }),

  /**
   * Pulls every non-superseded upload + every intake submission for the
   * case and runs extraction. This can take 10-60 seconds with a real
   * model — Phase 6.1 keeps it synchronous because tRPC requests are OK
   * for that range; if it grows we'll move to BullMQ + SSE progress.
   */
  run: requirePermission('ai', 'write')
    .input(z.object({ caseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.case.findFirst({
        where: { id: input.caseId, tenantId: ctx.tenantId, deletedAt: null },
      });
      if (!c) throw new TRPCError({ code: 'NOT_FOUND' });

      // Phase 8.1 budget + kill-switch gate. Refuses BEFORE we mark
      // RUNNING so the UI can show a meaningful error.
      let settings;
      try {
        settings = await assertAiAllowed(ctx.prisma, ctx.tenantId, 'extract');
      } catch (e) {
        if (e instanceof AiDisabled) {
          throw new TRPCError({ code: 'FORBIDDEN', message: e.message });
        }
        if (e instanceof AiBudgetExceeded) {
          throw new TRPCError({ code: 'FORBIDDEN', message: e.message });
        }
        throw e;
      }

      // Mark RUNNING up front so the UI can poll-or-refetch and see progress.
      // upsert handles first-run.
      await ctx.prisma.caseAiData.upsert({
        where: { caseId: c.id },
        create: {
          tenantId: ctx.tenantId,
          caseId: c.id,
          caseType: c.caseType,
          status: 'RUNNING',
          dataJson: {} as Prisma.InputJsonValue,
          provenanceJson: {} as Prisma.InputJsonValue,
          overridesJson: {} as Prisma.InputJsonValue,
          lastRunById: ctx.session.sub,
          lastRunAt: new Date(),
        },
        update: {
          status: 'RUNNING',
          lastError: null,
          lastRunById: ctx.session.sub,
          lastRunAt: new Date(),
        },
      });

      try {
        // Gather inputs: uploads (non-superseded) + intake.
        const collection = await ctx.prisma.documentCollection.findUnique({
          where: { caseId: c.id },
        });
        const uploads = collection
          ? await ctx.prisma.documentUpload.findMany({
              where: {
                tenantId: ctx.tenantId,
                collectionId: collection.id,
                supersededAt: null,
              },
              orderBy: { createdAt: 'asc' },
              take: MAX_DOCUMENTS,
            })
          : [];

        // Fetch each file's bytes. Skip any that fail or are too big — we
        // log + continue rather than fail the whole job.
        const documents: Array<{ fileName: string; contentType: string; body: Buffer }> = [];
        for (const u of uploads) {
          if (u.sizeBytes > MAX_DOCUMENT_BYTES) {
            logger.info({ uploadId: u.id, sizeBytes: u.sizeBytes }, 'ai: skipping oversized upload');
            continue;
          }
          try {
            const body = await fetchUploadBytes(u.r2Key);
            documents.push({ fileName: u.fileName, contentType: u.contentType, body });
          } catch (e) {
            logger.warn({ err: e, uploadId: u.id }, 'ai: failed to fetch upload bytes');
          }
        }

        // Intake — flatten the most recent submission's fieldsJson.
        const intake = c.leadId
          ? await ctx.prisma.intakeSubmission.findFirst({
              where: { tenantId: ctx.tenantId, OR: [{ leadId: c.leadId }, { clientId: c.clientId }] },
              orderBy: { submittedAt: 'desc' },
            })
          : await ctx.prisma.intakeSubmission.findFirst({
              where: { tenantId: ctx.tenantId, clientId: c.clientId },
              orderBy: { submittedAt: 'desc' },
            });
        const intakeData = (intake?.fieldsJson as Record<string, unknown>) ?? {};

        const result = await extractCaseData({
          caseType: c.caseType,
          documents,
          intakeData,
          model: settings.preferredModel,
        });

        // Phase 8.1 usage logging — record tokens + cost on every call,
        // even in dry-run (so the dashboard renders without real keys).
        await logAiUsage(ctx.prisma, {
          tenantId: ctx.tenantId,
          feature: 'extract',
          model: result.usage.model,
          inputTokens: result.usage.inputTokens,
          cachedInputTokens: result.usage.cachedInputTokens,
          outputTokens: result.usage.outputTokens,
          costCents: result.usage.costCents,
          mode: result.mode,
          refType: 'Case',
          refId: c.id,
          createdById: ctx.session.sub,
        });

        const updated = await ctx.prisma.caseAiData.update({
          where: { caseId: c.id },
          data: {
            status: 'READY',
            dataJson: result.data as Prisma.InputJsonValue,
            provenanceJson: result.provenance as Prisma.InputJsonValue,
            uploadsConsidered: documents.length,
            lastError: null,
            lastMode: result.mode,
          },
        });

        await ctx.prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            actorId: ctx.session.sub,
            actorType: 'USER',
            action: 'caseAi.run',
            targetType: 'Case',
            targetId: c.id,
            payload: {
              uploadsConsidered: documents.length,
              mode: result.mode,
              fieldCount: Object.keys(result.provenance).length,
              costCents: result.usage.costCents,
              model: result.usage.model,
            },
            ip: ctx.ip,
            userAgent: ctx.userAgent ?? null,
          },
        });

        logger.info(
          { caseId: c.id, mode: result.mode, uploads: documents.length },
          'ai: extraction complete',
        );
        return {
          ok: true,
          mode: result.mode,
          status: updated.status,
          usage: result.usage,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI extraction failed';
        await ctx.prisma.caseAiData.update({
          where: { caseId: c.id },
          data: { status: 'FAILED', lastError: msg },
        });
        logger.error({ err: e, caseId: c.id }, 'ai: extraction failed');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: msg });
      }
    }),

  /** Manual override on a single dotted key — kept separate from extracted data. */
  setOverride: requirePermission('ai', 'write')
    .input(
      z.object({
        caseId: z.string().uuid(),
        key: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.[\]]+$/),
        // String form — UI converts dates/numbers as needed at render time.
        value: z.string().max(2000).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.caseAiData.findUnique({
        where: { caseId: input.caseId },
      });
      if (!row || row.tenantId !== ctx.tenantId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      const overrides = ((row.overridesJson as Record<string, unknown>) ?? {}) as Record<
        string,
        unknown
      >;
      if (input.value === null) {
        delete overrides[input.key];
      } else {
        overrides[input.key] = input.value;
      }
      const updated = await ctx.prisma.caseAiData.update({
        where: { caseId: row.caseId },
        data: { overridesJson: overrides as Prisma.InputJsonValue },
      });
      await ctx.prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          actorId: ctx.session.sub,
          actorType: 'USER',
          action: 'caseAi.setOverride',
          targetType: 'Case',
          targetId: row.caseId,
          payload: { key: input.key, valueSet: input.value !== null },
          ip: ctx.ip,
          userAgent: ctx.userAgent ?? null,
        },
      });
      return updated;
    }),

  config: requirePermission('ai', 'read').query(async () => {
    return { mode: aiMode };
  }),
});
