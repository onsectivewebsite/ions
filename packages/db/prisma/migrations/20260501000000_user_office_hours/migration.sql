-- Stage 18.4: per-user office hours for booking-window warnings.

ALTER TABLE "User" ADD COLUMN "officeHours" JSONB;
