-- Additive: preserves all existing users, passwords and business data.
CREATE TABLE "social_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "client_id" VARCHAR(512) NOT NULL,
  "subject" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_accounts_provider_check" CHECK ("provider" IN ('google', 'apple', 'microsoft', 'facebook'))
);
CREATE UNIQUE INDEX "social_accounts_identity_key" ON "social_accounts"("provider", "client_id", "subject");
CREATE UNIQUE INDEX "social_accounts_user_provider_key" ON "social_accounts"("user_id", "provider");
-- Widening this check does not invalidate existing rows. Old application versions
-- must not be deployed after a social login has written a new method value.
ALTER TABLE "users" DROP CONSTRAINT "users_last_login_method_check";
ALTER TABLE "users" ADD CONSTRAINT "users_last_login_method_check"
  CHECK ("last_login_method" IS NULL OR "last_login_method" IN ('password', 'oidc', 'teams', 'google', 'apple', 'microsoft', 'facebook'));
