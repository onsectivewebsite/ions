-- Stage 6.1: IntakeRequest (staff-issued public form invitations) +
-- IntakeSubmission lock fields (admin/manager unlock to allow further edits).

-- Lock fields on IntakeSubmission. Existing submissions remain unlocked.
ALTER TABLE "IntakeSubmission"
    ADD COLUMN "lockedAt" TIMESTAMP(3),
    ADD COLUMN "unlockedBy" UUID,
    ADD COLUMN "unlockedAt" TIMESTAMP(3);

-- IntakeRequest table.
CREATE TABLE "IntakeRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "leadId" UUID,
    "clientId" UUID,
    "recipientName" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "sentVia" TEXT NOT NULL,
    "publicTokenHash" TEXT NOT NULL,
    "publicTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "filledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "submissionId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntakeRequest_publicTokenHash_key" ON "IntakeRequest"("publicTokenHash");
CREATE UNIQUE INDEX "IntakeRequest_submissionId_key" ON "IntakeRequest"("submissionId");
CREATE INDEX "IntakeRequest_tenantId_leadId_idx" ON "IntakeRequest"("tenantId", "leadId");
CREATE INDEX "IntakeRequest_tenantId_clientId_idx" ON "IntakeRequest"("tenantId", "clientId");
CREATE INDEX "IntakeRequest_tenantId_filledAt_idx" ON "IntakeRequest"("tenantId", "filledAt");

ALTER TABLE "IntakeRequest"
    ADD CONSTRAINT "IntakeRequest_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IntakeRequest"
    ADD CONSTRAINT "IntakeRequest_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "IntakeFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IntakeRequest"
    ADD CONSTRAINT "IntakeRequest_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IntakeRequest"
    ADD CONSTRAINT "IntakeRequest_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IntakeRequest"
    ADD CONSTRAINT "IntakeRequest_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "IntakeSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
