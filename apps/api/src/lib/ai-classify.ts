/**
 * Phase 8.2 — async document classification on upload.
 *
 * Fired-and-forgotten from every upload entry point (staff, public,
 * portal). Self-contained:
 *
 *   1. Read AiSettings; bail if disabled or `classifyAuto=false`.
 *   2. Pull the upload + its collection's checklist item list.
 *   3. Skip non-classifiable content types (e.g. .docx) or oversized files.
 *   4. Fetch bytes via R2 signedUrl.
 *   5. Call classifyDocument with the items as candidates.
 *   6. Persist category/confidence/timestamp on DocumentUpload.
 *   7. Log AiUsage (feature='classify', refType='DocumentUpload').
 *
 * Failures are logged + swallowed — classification is best-effort.
 *
 * The OnsecBoad-wide "default" model is Haiku for classify (cheap, fast).
 * Tenants can override via AiSettings.preferredModel; we honour it but
 * recommend Haiku for this feature.
 */
import { prisma, type PrismaClient } from '@onsecboad/db';
import { signedUrl } from '@onsecboad/r2';
import { classifyDocument, type ClassifyCandidate } from '@onsecboad/ai';
import { logger } from '../logger.js';
import { getAiSettings, logAiUsage, monthToDateCostCents } from './ai-usage.js';
import type { ChecklistItem } from './document-collection.js';

const MAX_BYTES = 8 * 1024 * 1024; // skip files > 8MB — Haiku doesn't need huge inputs

const CLASSIFIABLE_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

export async function classifyUploadAsync(
  prismaClient: PrismaClient,
  uploadId: string,
): Promise<void> {
  try {
    const upload = await prismaClient.documentUpload.findUnique({
      where: { id: uploadId },
    });
    if (!upload) return;
    if (upload.supersededAt) return; // skip stale rows
    if (!CLASSIFIABLE_TYPES.has(upload.contentType)) {
      logger.info({ uploadId, contentType: upload.contentType }, 'classify: unsupported type, skip');
      return;
    }
    if (upload.sizeBytes > MAX_BYTES) {
      logger.info({ uploadId, sizeBytes: upload.sizeBytes }, 'classify: oversized, skip');
      return;
    }

    const settings = await getAiSettings(prismaClient, upload.tenantId);
    if (!settings.enabled || !settings.classifyAuto) return;
    if (settings.monthlyBudgetCents > 0) {
      const mtd = await monthToDateCostCents(prismaClient, upload.tenantId);
      if (mtd >= settings.monthlyBudgetCents) {
        logger.info({ uploadId, mtd, cap: settings.monthlyBudgetCents }, 'classify: over budget, skip');
        return;
      }
    }

    // DocumentCollection has caseId but no `case` relation; chase
    // separately. The collection carries the items snapshot we use as
    // the candidate list.
    const collection = await prismaClient.documentCollection.findUnique({
      where: { id: upload.collectionId },
      select: { itemsJson: true, caseId: true },
    });
    const candidates: ClassifyCandidate[] = (
      (collection?.itemsJson as unknown as ChecklistItem[]) ?? []
    ).map((it) => ({ key: it.key, label: it.label }));

    const caseRow = collection
      ? await prismaClient.case.findUnique({
          where: { id: collection.caseId },
          select: { caseType: true },
        })
      : null;

    // Fetch bytes via signed URL (works in real and dry-run R2 modes).
    const url = await signedUrl(upload.r2Key, 600);
    const r = await fetch(url);
    if (!r.ok) {
      logger.warn({ uploadId, status: r.status }, 'classify: r2 fetch failed');
      return;
    }
    const body = Buffer.from(await r.arrayBuffer());

    const caseType = caseRow?.caseType ?? 'other';
    const result = await classifyDocument({
      caseType,
      candidates,
      // Allow firms to opt into a different model via settings, but the
      // default for classify is Haiku regardless of preferredModel — we
      // treat preferredModel as the extract-grade choice.
      model: settings.preferredModel?.startsWith('claude-haiku')
        ? settings.preferredModel
        : 'claude-haiku-4-5',
      document: { fileName: upload.fileName, contentType: upload.contentType, body },
    });

    await prismaClient.documentUpload.update({
      where: { id: upload.id },
      data: {
        aiCategory: result.category,
        aiCategoryLabel: result.categoryLabel,
        aiConfidence: result.confidence,
        aiClassifiedAt: new Date(),
        aiClassifyMode: result.mode,
      },
    });

    await logAiUsage(prismaClient, {
      tenantId: upload.tenantId,
      feature: 'classify',
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens,
      costCents: result.usage.costCents,
      mode: result.mode,
      refType: 'DocumentUpload',
      refId: upload.id,
    });
  } catch (err) {
    logger.warn({ err, uploadId }, 'classify: failed');
  }
}

/**
 * Trampoline that doesn't require the caller to import `prisma`. Kept
 * thin so it can be called from REST handlers via `void enqueue(uploadId)`.
 */
export function enqueueClassify(uploadId: string): void {
  void classifyUploadAsync(prisma, uploadId);
}
