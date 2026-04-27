-- CreateTable
CREATE TABLE "PdfFormTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseType" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "r2Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "detectedFieldsJson" JSONB NOT NULL,
    "mappingJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "dataSnapshot" JSONB NOT NULL,
    "generatedById" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" UUID,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfFormTemplate_tenantId_caseType_isActive_idx" ON "PdfFormTemplate"("tenantId", "caseType", "isActive");

-- CreateIndex
CREATE INDEX "GeneratedDocument_tenantId_caseId_supersededAt_idx" ON "GeneratedDocument"("tenantId", "caseId", "supersededAt");

-- CreateIndex
CREATE INDEX "GeneratedDocument_templateId_idx" ON "GeneratedDocument"("templateId");

-- AddForeignKey
ALTER TABLE "PdfFormTemplate" ADD CONSTRAINT "PdfFormTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "PdfFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
