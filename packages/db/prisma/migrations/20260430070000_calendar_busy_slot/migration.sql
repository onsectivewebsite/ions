-- Stage 16.2: external busy slots from connected calendars.

CREATE TABLE "CalendarBusySlot" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "summary" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarBusySlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarBusySlot_connectionId_externalEventId_key"
    ON "CalendarBusySlot"("connectionId", "externalEventId");

CREATE INDEX "CalendarBusySlot_connectionId_startsAt_endsAt_idx"
    ON "CalendarBusySlot"("connectionId", "startsAt", "endsAt");

ALTER TABLE "CalendarBusySlot"
    ADD CONSTRAINT "CalendarBusySlot_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
