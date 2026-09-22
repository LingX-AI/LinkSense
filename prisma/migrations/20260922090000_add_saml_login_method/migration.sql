-- Widen the allowed values without modifying existing rows or columns.
-- Once 'saml' is persisted, older application versions cannot read those users.
BEGIN;
ALTER TABLE "users" DROP CONSTRAINT "users_last_login_method_check";
ALTER TABLE "users" ADD CONSTRAINT "users_last_login_method_check"
  CHECK ("last_login_method" IS NULL OR "last_login_method" IN ('password', 'oidc', 'teams', 'google', 'apple', 'microsoft', 'facebook', 'saml'));
COMMIT;
