-- Add a per-user accounting boundary without altering limits or historical usage facts.
ALTER TABLE "users" ADD COLUMN "credit_quota_reset_at" timestamptz(6);
