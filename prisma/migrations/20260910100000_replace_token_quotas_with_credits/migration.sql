-- DESTRUCTIVE: old personal token limits and registration quota settings are discarded.
-- Authorized by the user: no historical quota/data compatibility or conversion.
-- Historical token/cost facts stay available for analytics; their credit consumption starts at zero.
ALTER TABLE "users"
  DROP COLUMN "total_token_limit",
  DROP COLUMN "weekly_token_limit",
  DROP COLUMN "monthly_token_limit",
  ADD COLUMN "total_credit_limit_micros" bigint,
  ADD COLUMN "weekly_credit_limit_micros" bigint,
  ADD COLUMN "monthly_credit_limit_micros" bigint,
  ADD CONSTRAINT "users_total_credit_limit_micros_check" CHECK ("total_credit_limit_micros" IS NULL OR "total_credit_limit_micros" > 0),
  ADD CONSTRAINT "users_weekly_credit_limit_micros_check" CHECK ("weekly_credit_limit_micros" IS NULL OR "weekly_credit_limit_micros" > 0),
  ADD CONSTRAINT "users_monthly_credit_limit_micros_check" CHECK ("monthly_credit_limit_micros" IS NULL OR "monthly_credit_limit_micros" > 0);

ALTER TABLE "token_usage_records"
  ADD COLUMN "credit_price_micros_cny" bigint NOT NULL DEFAULT 10000,
  ADD COLUMN "used_credit_micros" bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT "token_usage_records_credit_price_check" CHECK ("credit_price_micros_cny" > 0),
  ADD CONSTRAINT "token_usage_records_used_credit_check" CHECK ("used_credit_micros" >= 0);

ALTER TABLE "model_usage_records"
  ADD COLUMN "credit_price_micros_cny" bigint NOT NULL DEFAULT 10000,
  ADD COLUMN "used_credit_micros" bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT "model_usage_records_credit_price_check" CHECK ("credit_price_micros_cny" > 0),
  ADD CONSTRAINT "model_usage_records_used_credit_check" CHECK ("used_credit_micros" >= 0);

UPDATE "system_settings"
SET "settings_json" = ("settings_json" #- '{self_registration,total_token_limit}') - 'quota_settings';
