-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "address" JSONB,
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "taxIdType" TEXT;

