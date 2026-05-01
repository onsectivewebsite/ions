-- Stage 14.1: EmailLog deliverability tracking. Populated by the
-- generic email webhook (/api/v1/webhooks/email) when the SMTP
-- provider calls back with delivery / bounce / complaint events.

ALTER TABLE "EmailLog"
    ADD COLUMN "deliveredAt"  TIMESTAMP(3),
    ADD COLUMN "bouncedAt"    TIMESTAMP(3),
    ADD COLUMN "bounceType"   TEXT,
    ADD COLUMN "bounceReason" TEXT,
    ADD COLUMN "complainedAt" TIMESTAMP(3),
    ADD COLUMN "openedAt"     TIMESTAMP(3),
    ADD COLUMN "clickedAt"    TIMESTAMP(3);

CREATE INDEX "EmailLog_tenantId_status_createdAt_idx"
    ON "EmailLog"("tenantId", "status", "createdAt");
