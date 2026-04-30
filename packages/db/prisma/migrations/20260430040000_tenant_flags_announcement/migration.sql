-- Stage 13.3 + 13.4: per-firm feature flags + active announcement.

ALTER TABLE "Tenant"
    ADD COLUMN "featureFlags" JSONB,
    ADD COLUMN "announcement" JSONB;
