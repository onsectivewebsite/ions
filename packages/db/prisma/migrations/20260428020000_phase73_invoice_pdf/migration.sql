-- Phase 7.3: cache rendered invoice PDFs in R2 by key. Cleared on item
-- edits / void / paid-status flip; renderer regenerates on next request.

ALTER TABLE "CaseInvoice"
  ADD COLUMN "pdfR2Key" TEXT,
  ADD COLUMN "pdfRenderedAt" TIMESTAMP(3);
