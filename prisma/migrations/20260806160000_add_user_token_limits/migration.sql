ALTER TABLE "users"
  ADD COLUMN "weekly_token_limit" bigint,
  ADD COLUMN "monthly_token_limit" bigint;

ALTER TABLE "users"
  ADD CONSTRAINT "users_weekly_token_limit_check"
    CHECK ("weekly_token_limit" IS NULL OR "weekly_token_limit" > 0),
  ADD CONSTRAINT "users_monthly_token_limit_check"
    CHECK ("monthly_token_limit" IS NULL OR "monthly_token_limit" > 0);
