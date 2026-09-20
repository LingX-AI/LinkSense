-- Total credit limits are no longer supported. Existing values are
-- intentionally discarded; weekly limits, credit usage, and billing remain.
ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_total_credit_limit_micros_check",
  DROP COLUMN "total_credit_limit_micros";

ALTER TABLE "application_external_sessions"
  DROP COLUMN "total_credit_limit_micros";

-- Preserve the former organization-member weekly limit as the single default
-- for all future members. The separate self-registration default is discarded.
UPDATE "system_settings"
SET "settings_json" = jsonb_set(
  "settings_json",
  '{quota_settings}',
  jsonb_build_object(
    'credit_price_cny',
    COALESCE(
      "settings_json" #> '{quota_settings,credit_price_cny}',
      '"0.01"'::jsonb
    ),
    'weekly_credit_limit',
    COALESCE(
      "settings_json" #> '{quota_settings,organization_members,weekly_credit_limit}',
      'null'::jsonb
    )
  ),
  true
)
WHERE "settings_json" ? 'quota_settings';
