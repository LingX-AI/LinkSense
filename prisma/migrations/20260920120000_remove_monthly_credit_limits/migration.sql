-- Monthly credit limits are no longer supported. Existing limit values are
-- intentionally discarded; credit usage and billing records remain unchanged.
ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_monthly_credit_limit_micros_check",
  DROP COLUMN "monthly_credit_limit_micros";

ALTER TABLE "application_external_sessions"
  DROP COLUMN "monthly_credit_limit_micros";

UPDATE "system_settings"
SET "settings_json" =
  ("settings_json" #- '{quota_settings,organization_members,monthly_credit_limit}')
  #- '{quota_settings,self_registered_users,monthly_credit_limit}'
WHERE
  "settings_json" #> '{quota_settings,organization_members,monthly_credit_limit}' IS NOT NULL
  OR "settings_json" #> '{quota_settings,self_registered_users,monthly_credit_limit}' IS NOT NULL;
