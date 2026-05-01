-- Stage 15.5: external calendar OAuth connections (Google, Outlook).

CREATE TABLE "CalendarConnection" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccount" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "calendarId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarConnection_userId_provider_externalAccount_key"
    ON "CalendarConnection"("userId", "provider", "externalAccount");

CREATE INDEX "CalendarConnection_userId_status_idx"
    ON "CalendarConnection"("userId", "status");

ALTER TABLE "CalendarConnection"
    ADD CONSTRAINT "CalendarConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
