ALTER TABLE "users"
  ADD COLUMN "self_registered_at" TIMESTAMPTZ(6);

WITH "self_registrations" AS (
  SELECT
    "target_id",
    MIN("created_at") AS "registered_at"
  FROM "audit_logs"
  WHERE "action" = 'user_self_registered'
    AND "target_type" = 'user'
    AND "result" = 'success'
    AND "target_id" IS NOT NULL
  GROUP BY "target_id"
)
UPDATE "users" AS "user"
SET "self_registered_at" = "registration"."registered_at"
FROM "self_registrations" AS "registration"
WHERE "user"."id"::TEXT = "registration"."target_id";

WITH "registration_policy" AS (
  SELECT CASE
    WHEN "settings_json"->'self_registration'->>'total_token_limit'
      ~ '^[1-9][0-9]{0,18}$'
    THEN CASE
      WHEN ("settings_json"->'self_registration'->>'total_token_limit')::NUMERIC
        <= 9223372036854775807
      THEN ("settings_json"->'self_registration'->>'total_token_limit')::BIGINT
      ELSE NULL
    END
    ELSE NULL
  END AS "total_token_limit"
  FROM "system_settings"
  WHERE "id" = '00000000-0000-4000-8000-000000000001'::UUID
)
UPDATE "users" AS "user"
SET
  "total_token_limit" = "policy"."total_token_limit",
  "updated_at" = CURRENT_TIMESTAMP
FROM "registration_policy" AS "policy"
WHERE "user"."self_registered_at" IS NOT NULL
  AND "policy"."total_token_limit" IS NOT NULL;

CREATE INDEX "users_self_registered_at_idx"
  ON "users"("self_registered_at");
