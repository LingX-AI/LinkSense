-- Additive constraint expansion: keeps all historical providers and login methods.
-- No rows, columns, tables, or indexes are removed or rewritten.
BEGIN;
ALTER TABLE "social_accounts" DROP CONSTRAINT "social_accounts_provider_check";
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_provider_check"
  CHECK ("provider" IN ('google', 'apple', 'microsoft', 'facebook', 'github'));
ALTER TABLE "users" DROP CONSTRAINT "users_last_login_method_check";
ALTER TABLE "users" ADD CONSTRAINT "users_last_login_method_check"
  CHECK ("last_login_method" IS NULL OR "last_login_method" IN ('password', 'oidc', 'teams', 'google', 'apple', 'microsoft', 'facebook', 'saml', 'github'));
COMMIT;
