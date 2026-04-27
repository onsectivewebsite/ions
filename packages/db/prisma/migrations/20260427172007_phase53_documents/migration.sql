-- CreateEnum
CREATE TYPE "DocumentCollectionStatus" AS ENUM ('DRAFT', 'SENT', 'LOCKED', 'UNLOCKED');

-- CreateTable
CREATE TABLE "DocumentChecklistTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseType" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "itemsJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCollection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "templateId" UUID,
    "status" "DocumentCollectionStatus" NOT NULL DEFAULT 'DRAFT',
    "itemsJson" JSONB NOT NULL,
    "publicTokenHash" TEXT,
    "publicTokenExpiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "submittedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "unlockedAt" TIMESTAMP(3),
    "unlockedById" UUID,
    "unlockReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentUpload" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "collectionId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "itemKey" TEXT NOT NULL,
    "uploadedById" UUID,
    "uploadedByName" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "r2Key" TEXT NOT NULL,
    "sha256" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentChecklistTemplate_tenantId_caseType_isActive_idx" ON "DocumentChecklistTemplate"("tenantId", "caseType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCollection_caseId_key" ON "DocumentCollection"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCollection_publicTokenHash_key" ON "DocumentCollection"("publicTokenHash");

-- CreateIndex
CREATE INDEX "DocumentCollection_tenantId_status_idx" ON "DocumentCollection"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DocumentUpload_tenantId_caseId_itemKey_supersededAt_idx" ON "DocumentUpload"("tenantId", "caseId", "itemKey", "supersededAt");

-- CreateIndex
CREATE INDEX "DocumentUpload_collectionId_idx" ON "DocumentUpload"("collectionId");

-- AddForeignKey
ALTER TABLE "DocumentChecklistTemplate" ADD CONSTRAINT "DocumentChecklistTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCollection" ADD CONSTRAINT "DocumentCollection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCollection" ADD CONSTRAINT "DocumentCollection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentChecklistTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUpload" ADD CONSTRAINT "DocumentUpload_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentUpload" ADD CONSTRAINT "DocumentUpload_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DocumentCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
