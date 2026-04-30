-- Stage 3.6: per-user notification preferences (email/SMS opt-ins, digest cadence).

ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;
