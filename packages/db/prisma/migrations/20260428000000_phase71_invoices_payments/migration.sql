-- CreateTable
CREATE TABLE "CaseInvoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseInvoiceItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasePayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "invoiceId" UUID,
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "reference" TEXT,
    "stripePaymentIntentId" TEXT,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseInvoice_tenantId_number_key" ON "CaseInvoice"("tenantId", "number");

-- CreateIndex
CREATE INDEX "CaseInvoice_tenantId_caseId_status_idx" ON "CaseInvoice"("tenantId", "caseId", "status");

-- CreateIndex
CREATE INDEX "CaseInvoice_tenantId_branchId_status_idx" ON "CaseInvoice"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "CaseInvoice_tenantId_status_dueDate_idx" ON "CaseInvoice"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "CaseInvoiceItem_invoiceId_sortOrder_idx" ON "CaseInvoiceItem"("invoiceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CasePayment_stripePaymentIntentId_key" ON "CasePayment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "CasePayment_tenantId_caseId_receivedAt_idx" ON "CasePayment"("tenantId", "caseId", "receivedAt");

-- CreateIndex
CREATE INDEX "CasePayment_tenantId_invoiceId_idx" ON "CasePayment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "CasePayment_tenantId_status_idx" ON "CasePayment"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "CaseInvoice" ADD CONSTRAINT "CaseInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseInvoice" ADD CONSTRAINT "CaseInvoice_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseInvoiceItem" ADD CONSTRAINT "CaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: turn existing Case.amountPaidCents into a synthetic ledger row
-- so the payment ledger is the source of truth from now on.
INSERT INTO "CasePayment" (
    "id", "tenantId", "caseId", "amountCents", "method", "status",
    "note", "receivedAt", "recordedById", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(),
    c."tenantId",
    c."id",
    c."amountPaidCents",
    'cash',
    'COMPLETED',
    'Phase 7.1 backfill — pre-ledger payment',
    COALESCE(c."retainerSignedAt", c."createdAt"),
    c."lawyerId",
    c."createdAt",
    NOW()
FROM "Case" c
WHERE c."amountPaidCents" > 0;
