-- Additive model-usage and price-snapshot migration. No existing usage rows
-- are deleted or repriced. Existing chat rows are explicitly marked as
-- unpriced because their historical unit prices cannot be recovered safely.

BEGIN;

ALTER TABLE "token_usage_records"
  ADD COLUMN "input_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "cached_input_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "output_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "cached_input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "output_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "total_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "unpriced_tokens" BIGINT NOT NULL DEFAULT 0;

UPDATE "token_usage_records"
SET "unpriced_tokens" = "total_tokens";

ALTER TABLE "token_usage_records"
  ADD CONSTRAINT "token_usage_records_costs_check" CHECK (
    "input_price_micros_per_million" >= 0
    AND "cached_input_price_micros_per_million" >= 0
    AND "output_price_micros_per_million" >= 0
    AND "input_cost_pico_cny" =
      ("input_tokens" - "cached_input_tokens") * "input_price_micros_per_million"
    AND "cached_input_cost_pico_cny" =
      "cached_input_tokens" * "cached_input_price_micros_per_million"
    AND "output_cost_pico_cny" =
      "output_tokens" * "output_price_micros_per_million"
    AND "total_cost_pico_cny" =
      "input_cost_pico_cny" + "cached_input_cost_pico_cny" + "output_cost_pico_cny"
    AND "unpriced_tokens" >= 0
    AND "unpriced_tokens" <= "total_tokens"
    AND (
      "unpriced_tokens" = 0
      OR (
        "unpriced_tokens" = "total_tokens"
        AND "input_price_micros_per_million" = 0
        AND "cached_input_price_micros_per_million" = 0
        AND "output_price_micros_per_million" = 0
        AND "total_cost_pico_cny" = 0
      )
    )
  );

CREATE TABLE "model_usage_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "conversation_id" UUID,
  "turn_id" UUID,
  "knowledge_base_id" UUID,
  "document_id" UUID,
  "document_version_id" UUID,
  "processing_generation" UUID,
  "operation" VARCHAR(32),
  "workload" VARCHAR(48) NOT NULL,
  "model_kind" VARCHAR(24) NOT NULL,
  "model" VARCHAR(240) NOT NULL,
  "measurement_method" VARCHAR(16) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 1,
  "total_tokens" BIGINT NOT NULL,
  "input_tokens" BIGINT NOT NULL,
  "cached_input_tokens" BIGINT NOT NULL DEFAULT 0,
  "output_tokens" BIGINT NOT NULL DEFAULT 0,
  "reasoning_output_tokens" BIGINT NOT NULL DEFAULT 0,
  "input_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  "cached_input_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  "output_price_micros_per_million" BIGINT NOT NULL DEFAULT 0,
  "input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  "cached_input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  "output_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  "total_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
  "unpriced_tokens" BIGINT NOT NULL DEFAULT 0,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "model_usage_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "model_usage_records_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "model_usage_records_workload_check" CHECK (
    "workload" IN (
      'document_embedding',
      'query_embedding',
      'rerank'
    )
  ),
  CONSTRAINT "model_usage_records_model_kind_check" CHECK (
    "model_kind" IN ('embedding', 'rerank')
    AND (
      ("workload" IN ('document_embedding', 'query_embedding') AND "model_kind" = 'embedding')
      OR ("workload" = 'rerank' AND "model_kind" = 'rerank')
    )
  ),
  CONSTRAINT "model_usage_records_measurement_method_check" CHECK (
    "measurement_method" IN ('provider', 'estimated')
  ),
  CONSTRAINT "model_usage_records_counts_check" CHECK (
    "request_count" > 0
    AND "total_tokens" >= 0
    AND "input_tokens" >= 0
    AND "cached_input_tokens" >= 0
    AND "output_tokens" >= 0
    AND "reasoning_output_tokens" >= 0
    AND "cached_input_tokens" <= "input_tokens"
    AND "reasoning_output_tokens" <= "output_tokens"
  ),
  CONSTRAINT "model_usage_records_costs_check" CHECK (
    "input_price_micros_per_million" >= 0
    AND "cached_input_price_micros_per_million" >= 0
    AND "output_price_micros_per_million" >= 0
    AND "input_cost_pico_cny" =
      ("input_tokens" - "cached_input_tokens") * "input_price_micros_per_million"
    AND "cached_input_cost_pico_cny" =
      "cached_input_tokens" * "cached_input_price_micros_per_million"
    AND "output_cost_pico_cny" =
      "output_tokens" * "output_price_micros_per_million"
    AND "total_cost_pico_cny" =
      "input_cost_pico_cny" + "cached_input_cost_pico_cny" + "output_cost_pico_cny"
    AND "unpriced_tokens" >= 0
    AND "unpriced_tokens" <= "total_tokens"
    AND (
      "unpriced_tokens" = 0
      OR (
        "unpriced_tokens" = "total_tokens"
        AND "input_price_micros_per_million" = 0
        AND "cached_input_price_micros_per_million" = 0
        AND "output_price_micros_per_million" = 0
        AND "total_cost_pico_cny" = 0
      )
    )
  )
);

CREATE INDEX "model_usage_records_owner_observed_idx"
  ON "model_usage_records"("owner_id", "observed_at" DESC);
CREATE INDEX "model_usage_records_model_observed_idx"
  ON "model_usage_records"("model", "observed_at" DESC);
CREATE INDEX "model_usage_records_workload_observed_idx"
  ON "model_usage_records"("workload", "observed_at" DESC);
CREATE INDEX "model_usage_records_observed_idx"
  ON "model_usage_records"("observed_at" DESC);
CREATE INDEX "model_usage_records_conversation_idx"
  ON "model_usage_records"("conversation_id");
CREATE INDEX "model_usage_records_turn_idx"
  ON "model_usage_records"("turn_id");
CREATE INDEX "model_usage_records_knowledge_base_idx"
  ON "model_usage_records"("knowledge_base_id");
CREATE INDEX "model_usage_records_document_idx"
  ON "model_usage_records"("document_id");

COMMIT;
