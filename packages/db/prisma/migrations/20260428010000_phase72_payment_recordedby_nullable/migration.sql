-- Phase 7.2: Stripe-webhook-driven CasePayment rows have no user actor.
-- Make recordedById nullable so the webhook can insert without forging a
-- synthetic actor. Manual / staff-driven payments still pass a real userId.

ALTER TABLE "CasePayment" ALTER COLUMN "recordedById" DROP NOT NULL;
