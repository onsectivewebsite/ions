-- CreateEnum
CREATE TYPE "RetainerStatus" AS ENUM ('DRAFT', 'LAWYER_APPROVED', 'SIGNED', 'VOID');

-- CreateTable
CREATE TABLE "RetainerTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseType" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "contentMd" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetainerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetainerAgreement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "templateId" UUID,
    "status" "RetainerStatus" NOT NULL DEFAULT 'DRAFT',
    "contentMd" TEXT NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedIp" TEXT,
    "approvedUserAgent" TEXT,
    "signedName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "signatureSvg" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetainerAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetainerTemplate_tenantId_caseType_isActive_idx" ON "RetainerTemplate"("tenantId", "caseType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "RetainerAgreement_caseId_key" ON "RetainerAgreement"("caseId");

-- CreateIndex
CREATE INDEX "RetainerAgreement_tenantId_status_idx" ON "RetainerAgreement"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "RetainerTemplate" ADD CONSTRAINT "RetainerTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetainerAgreement" ADD CONSTRAINT "RetainerAgreement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetainerAgreement" ADD CONSTRAINT "RetainerAgreement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
