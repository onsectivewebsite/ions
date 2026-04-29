-- Phase 8.4: AI summaries for calls + consultations.

ALTER TABLE "CallLog"
  ADD COLUMN "transcript" TEXT,
  ADD COLUMN "transcriptSource" TEXT,
  ADD COLUMN "aiSummary" TEXT,
  ADD COLUMN "aiSummarizedAt" TIMESTAMP(3),
  ADD COLUMN "aiSummaryMode" TEXT;

ALTER TABLE "Appointment"
  ADD COLUMN "aiSummary" TEXT,
  ADD COLUMN "aiSummarizedAt" TIMESTAMP(3),
  ADD COLUMN "aiSummaryMode" TEXT;
