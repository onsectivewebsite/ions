-- CreateEnum
CREATE TYPE "ClientAccountStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "ClientPortalAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "ClientAccountStatus" NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "setupTokenHash" TEXT,
    "setupTokenExpiresAt" TIMESTAMP(3),
    "invitedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPortalSession" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ClientPortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalAccount_clientId_key" ON "ClientPortalAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalAccount_setupTokenHash_key" ON "ClientPortalAccount"("setupTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalAccount_tenantId_email_key" ON "ClientPortalAccount"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPortalSession_refreshTokenHash_key" ON "ClientPortalSession"("refreshTokenHash");

-- AddForeignKey
ALTER TABLE "ClientPortalAccount" ADD CONSTRAINT "ClientPortalAccount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalAccount" ADD CONSTRAINT "ClientPortalAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPortalSession" ADD CONSTRAINT "ClientPortalSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClientPortalAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
