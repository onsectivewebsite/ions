-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" CITEXT,
    "phone" TEXT NOT NULL,
    "language" TEXT,
    "primaryLeadId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeFormTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fieldsJson" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntakeFormTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntakeSubmission" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "caseType" TEXT NOT NULL,
    "leadId" UUID,
    "clientId" UUID,
    "fieldsJson" JSONB NOT NULL,
    "submittedBy" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicTokenHash" TEXT,
    "publicTokenExpiresAt" TIMESTAMP(3),
    "publicSubmittedAt" TIMESTAMP(3),

    CONSTRAINT "IntakeSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_tenantId_lastName_idx" ON "Client"("tenantId", "lastName");

-- CreateIndex
CREATE INDEX "Client_tenantId_email_idx" ON "Client"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_phone_key" ON "Client"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "IntakeFormTemplate_tenantId_caseType_isActive_idx" ON "IntakeFormTemplate"("tenantId", "caseType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "IntakeSubmission_publicTokenHash_key" ON "IntakeSubmission"("publicTokenHash");

-- CreateIndex
CREATE INDEX "IntakeSubmission_tenantId_leadId_idx" ON "IntakeSubmission"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "IntakeSubmission_tenantId_clientId_submittedAt_idx" ON "IntakeSubmission"("tenantId", "clientId", "submittedAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeFormTemplate" ADD CONSTRAINT "IntakeFormTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSubmission" ADD CONSTRAINT "IntakeSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSubmission" ADD CONSTRAINT "IntakeSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "IntakeFormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntakeSubmission" ADD CONSTRAINT "IntakeSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
