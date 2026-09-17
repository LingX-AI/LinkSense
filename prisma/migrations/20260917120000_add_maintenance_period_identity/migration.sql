-- Preserve existing maintenance windows and all other system settings.
-- Run before deploying the API that requires an identity for active maintenance.
UPDATE "system_settings"
SET "settings_json" = jsonb_set(
    "settings_json",
    '{maintenance,maintenance_id}',
    to_jsonb(gen_random_uuid()::text)
)
WHERE jsonb_typeof("settings_json" -> 'maintenance') = 'object'
  AND ("settings_json" -> 'maintenance' ->> 'maintenance_id') IS NULL;
