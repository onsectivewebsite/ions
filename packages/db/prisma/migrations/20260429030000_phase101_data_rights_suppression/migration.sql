-- Phase 10.1: PIPEDA right-to-deletion + CASL suppression list.

ALTER TABLE "Client"
  ADD COLUMN "purgeAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldUntil" TIMESTAMP(3),
  ADD COLUMN "deletionReason" TEXT;

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "addedById" UUID,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_tenantId_channel_value_key" ON "SuppressionEntry"("tenantId", "channel", "value");

-- CreateIndex
CREATE INDEX "SuppressionEntry_tenantId_channel_idx" ON "SuppressionEntry"("tenantId", "channel");

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
