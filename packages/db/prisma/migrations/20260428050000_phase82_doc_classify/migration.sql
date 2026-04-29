-- Phase 8.2: AI document classification — auto-tag uploads with the
-- checklist item key that best matches their content.

ALTER TABLE "DocumentUpload"
  ADD COLUMN "aiCategory" TEXT,
  ADD COLUMN "aiCategoryLabel" TEXT,
  ADD COLUMN "aiConfidence" DOUBLE PRECISION,
  ADD COLUMN "aiClassifiedAt" TIMESTAMP(3),
  ADD COLUMN "aiClassifyMode" TEXT;
