-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('CLIENT', 'STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "caseId" UUID,
    "sender" "MessageSender" NOT NULL,
    "senderUserId" UUID,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "readByClient" TIMESTAMP(3),
    "readByStaff" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_tenantId_clientId_createdAt_idx" ON "Message"("tenantId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_caseId_createdAt_idx" ON "Message"("tenantId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_tenantId_sender_readByStaff_idx" ON "Message"("tenantId", "sender", "readByStaff");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;
