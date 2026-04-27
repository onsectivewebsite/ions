-- CreateTable
CREATE TABLE "IrccCorrespondence" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "attachmentUploadId" UUID,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IrccCorrespondence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IrccCorrespondence_tenantId_caseId_occurredAt_idx" ON "IrccCorrespondence"("tenantId", "caseId", "occurredAt");

-- AddForeignKey
ALTER TABLE "IrccCorrespondence" ADD CONSTRAINT "IrccCorrespondence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
