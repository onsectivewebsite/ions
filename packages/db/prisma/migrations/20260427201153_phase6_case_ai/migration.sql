-- CreateEnum
CREATE TYPE "CaseAiStatus" AS ENUM ('EMPTY', 'RUNNING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "CaseAiData" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "caseType" TEXT NOT NULL,
    "status" "CaseAiStatus" NOT NULL DEFAULT 'EMPTY',
    "dataJson" JSONB NOT NULL,
    "provenanceJson" JSONB NOT NULL,
    "overridesJson" JSONB NOT NULL,
    "uploadsConsidered" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "lastRunById" UUID,
    "lastError" TEXT,
    "lastMode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseAiData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseAiData_caseId_key" ON "CaseAiData"("caseId");

-- AddForeignKey
ALTER TABLE "CaseAiData" ADD CONSTRAINT "CaseAiData_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
