-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "planId" UUID,
ADD COLUMN     "setupTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "setupTokenHash" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pricePerSeatCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "stripePriceId" TEXT NOT NULL,
    "limits" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "hostedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "payload" JSONB,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripePriceId_key" ON "Plan"("stripePriceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_stripeInvoiceId_key" ON "SubscriptionInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_tenantId_createdAt_idx" ON "SubscriptionInvoice"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_source_type_idx" ON "WebhookEvent"("source", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_setupTokenHash_key" ON "Tenant"("setupTokenHash");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

