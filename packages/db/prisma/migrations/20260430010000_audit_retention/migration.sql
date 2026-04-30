-- Stage 5.2: per-tenant audit retention config (days). Default 730 matches
-- PIPEDA s.10.3 record-keeping (2 years).

ALTER TABLE "Tenant" ADD COLUMN "auditRetentionDays" INTEGER NOT NULL DEFAULT 730;
