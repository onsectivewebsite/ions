-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('PENDING_RETAINER', 'PENDING_RETAINER_SIGNATURE', 'PENDING_DOCUMENTS', 'PREPARING', 'PENDING_LAWYER_APPROVAL', 'SUBMITTED_TO_IRCC', 'IN_REVIEW', 'COMPLETED', 'WITHDRAWN', 'ABANDONED');

-- CreateTable
CREATE TABLE "Case" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "clientId" UUID NOT NULL,
    "leadId" UUID,
    "appointmentId" UUID,
    "caseType" TEXT NOT NULL,
    "lawyerId" UUID NOT NULL,
    "filerId" UUID,
    "status" "CaseStatus" NOT NULL DEFAULT 'PENDING_RETAINER',
    "retainerFeeCents" INTEGER,
    "totalFeeCents" INTEGER,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "feesCleared" BOOLEAN NOT NULL DEFAULT false,
    "usiNumber" TEXT,
    "irccFileNumber" TEXT,
    "irccPortalDate" TIMESTAMP(3),
    "irccDecision" TEXT,
    "retainerApprovedAt" TIMESTAMP(3),
    "retainerSignedAt" TIMESTAMP(3),
    "documentsLockedAt" TIMESTAMP(3),
    "lawyerApprovedAt" TIMESTAMP(3),
    "submittedToIrccAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Case_tenantId_status_updatedAt_idx" ON "Case"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Case_tenantId_branchId_status_idx" ON "Case"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "Case_tenantId_clientId_idx" ON "Case"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "Case_tenantId_lawyerId_status_idx" ON "Case"("tenantId", "lawyerId", "status");

-- CreateIndex
CREATE INDEX "Case_tenantId_filerId_status_idx" ON "Case"("tenantId", "filerId", "status");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_filerId_fkey" FOREIGN KEY ("filerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
