-- Stage 17.3: link OnsecBoad Appointments to mirrored events on
-- external calendars so update + cancel can also sync out.

CREATE TABLE "AppointmentExternalEvent" (
    "id" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentExternalEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentExternalEvent_appointmentId_connectionId_key"
    ON "AppointmentExternalEvent"("appointmentId", "connectionId");

CREATE INDEX "AppointmentExternalEvent_appointmentId_idx"
    ON "AppointmentExternalEvent"("appointmentId");

ALTER TABLE "AppointmentExternalEvent"
    ADD CONSTRAINT "AppointmentExternalEvent_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AppointmentExternalEvent"
    ADD CONSTRAINT "AppointmentExternalEvent_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
