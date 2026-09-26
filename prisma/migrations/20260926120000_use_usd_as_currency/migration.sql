-- Preserve every historical amount and credit value. Existing numeric prices
-- and costs are reinterpreted as USD without exchange-rate conversion.
ALTER TABLE "token_usage_records"
  RENAME COLUMN "input_cost_pico_cny" TO "input_cost_pico_usd";
ALTER TABLE "token_usage_records"
  RENAME COLUMN "cached_input_cost_pico_cny" TO "cached_input_cost_pico_usd";
ALTER TABLE "token_usage_records"
  RENAME COLUMN "output_cost_pico_cny" TO "output_cost_pico_usd";
ALTER TABLE "token_usage_records"
  RENAME COLUMN "total_cost_pico_cny" TO "total_cost_pico_usd";
ALTER TABLE "token_usage_records"
  RENAME COLUMN "credit_price_micros_cny" TO "credit_price_micros_usd";

ALTER TABLE "model_usage_records"
  RENAME COLUMN "input_cost_pico_cny" TO "input_cost_pico_usd";
ALTER TABLE "model_usage_records"
  RENAME COLUMN "cached_input_cost_pico_cny" TO "cached_input_cost_pico_usd";
ALTER TABLE "model_usage_records"
  RENAME COLUMN "output_cost_pico_cny" TO "output_cost_pico_usd";
ALTER TABLE "model_usage_records"
  RENAME COLUMN "total_cost_pico_cny" TO "total_cost_pico_usd";
ALTER TABLE "model_usage_records"
  RENAME COLUMN "credit_price_micros_cny" TO "credit_price_micros_usd";

ALTER TABLE "billing_statements"
  RENAME COLUMN "total_cost_pico_cny" TO "total_cost_pico_usd";
ALTER TABLE "billing_statements"
  ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "billing_statements"
SET "currency" = 'USD'
WHERE "currency" <> 'USD';

ALTER TABLE "billing_statement_lines"
  RENAME COLUMN "input_cost_pico_cny" TO "input_cost_pico_usd";
ALTER TABLE "billing_statement_lines"
  RENAME COLUMN "cached_input_cost_pico_cny" TO "cached_input_cost_pico_usd";
ALTER TABLE "billing_statement_lines"
  RENAME COLUMN "output_cost_pico_cny" TO "output_cost_pico_usd";
ALTER TABLE "billing_statement_lines"
  RENAME COLUMN "total_cost_pico_cny" TO "total_cost_pico_usd";

UPDATE "system_settings"
SET "settings_json" = jsonb_set(
  "settings_json",
  '{quota_settings}',
  (("settings_json" -> 'quota_settings') - 'credit_price_cny') ||
    jsonb_build_object(
      'credit_price_usd',
      "settings_json" #> '{quota_settings,credit_price_cny}'
    ),
  false
)
WHERE jsonb_typeof("settings_json" -> 'quota_settings') = 'object'
  AND ("settings_json" -> 'quota_settings') ? 'credit_price_cny';
