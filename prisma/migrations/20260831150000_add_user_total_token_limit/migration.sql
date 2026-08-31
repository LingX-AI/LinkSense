ALTER TABLE "users"
  ADD COLUMN "total_token_limit" BIGINT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_total_token_limit_check"
    CHECK ("total_token_limit" IS NULL OR "total_token_limit" > 0);
