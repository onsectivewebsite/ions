-- Stage 19.2: per-firm appointment reminder configuration.

ALTER TABLE "Tenant" ADD COLUMN "reminderConfig" JSONB;
