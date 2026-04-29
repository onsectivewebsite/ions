-- CreateTable
CREATE TABLE "AiAgentRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "skipReason" TEXT,
    "kickedOffById" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AiAgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAgentRun_tenantId_caseId_startedAt_idx" ON "AiAgentRun"("tenantId", "caseId", "startedAt");

-- CreateIndex
CREATE INDEX "AiAgentRun_tenantId_status_startedAt_idx" ON "AiAgentRun"("tenantId", "status", "startedAt");

-- AddForeignKey
ALTER TABLE "AiAgentRun" ADD CONSTRAINT "AiAgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentRun" ADD CONSTRAINT "AiAgentRun_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
