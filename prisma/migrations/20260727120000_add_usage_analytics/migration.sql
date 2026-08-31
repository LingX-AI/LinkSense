-- Additive usage analytics storage. This migration creates new tables,
-- constraints, indexes, and one singleton start marker only. It does not
-- delete, rewrite, or constrain existing application data and adds no foreign
-- keys, so it has no data-loss or historical-field compatibility risk.

CREATE TABLE "usage_analytics_state" (
    "id" UUID NOT NULL,
    "token_measurement_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_analytics_state_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_analytics_state_singleton_check" CHECK (
        "id" = '00000000-0000-4000-8000-000000000001'::uuid
    )
);

INSERT INTO "usage_analytics_state" ("id")
VALUES ('00000000-0000-4000-8000-000000000001'::uuid);

CREATE INDEX "conversations_created_at_idx"
    ON "conversations"("created_at" DESC);
CREATE INDEX "conversation_turns_started_at_idx"
    ON "conversation_turns"("started_at" DESC);

CREATE TABLE "codex_thread_token_usage_cursors" (
    "codex_thread_id" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "last_codex_turn_id" TEXT NOT NULL,
    "total_tokens" BIGINT NOT NULL,
    "input_tokens" BIGINT NOT NULL,
    "cached_input_tokens" BIGINT NOT NULL,
    "output_tokens" BIGINT NOT NULL,
    "reasoning_output_tokens" BIGINT NOT NULL,
    "model_context_window" BIGINT,
    "first_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "last_observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "codex_thread_token_usage_cursors_pkey" PRIMARY KEY ("codex_thread_id"),
    CONSTRAINT "codex_token_usage_cursors_counts_check" CHECK (
        "total_tokens" >= 0
        AND "input_tokens" >= 0
        AND "cached_input_tokens" >= 0
        AND "output_tokens" >= 0
        AND "reasoning_output_tokens" >= 0
        AND "cached_input_tokens" <= "input_tokens"
        AND "reasoning_output_tokens" <= "output_tokens"
        AND ("model_context_window" IS NULL OR "model_context_window" >= 0)
    ),
    CONSTRAINT "codex_token_usage_cursors_observed_check" CHECK (
        "last_observed_at" >= "first_observed_at"
    )
);

CREATE INDEX "codex_token_usage_cursors_owner_observed_idx"
    ON "codex_thread_token_usage_cursors"("owner_id", "last_observed_at" DESC);
CREATE INDEX "codex_token_usage_cursors_conversation_idx"
    ON "codex_thread_token_usage_cursors"("conversation_id");

CREATE TABLE "token_usage_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "snapshot_key" VARCHAR(64) NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "codex_thread_id" TEXT NOT NULL,
    "codex_turn_id" TEXT NOT NULL,
    "model" VARCHAR(240) NOT NULL,
    "total_tokens" BIGINT NOT NULL,
    "input_tokens" BIGINT NOT NULL,
    "cached_input_tokens" BIGINT NOT NULL,
    "output_tokens" BIGINT NOT NULL,
    "reasoning_output_tokens" BIGINT NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_usage_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "token_usage_records_snapshot_key_check" CHECK (
        "snapshot_key" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "token_usage_records_counts_check" CHECK (
        "total_tokens" >= 0
        AND "input_tokens" >= 0
        AND "cached_input_tokens" >= 0
        AND "output_tokens" >= 0
        AND "reasoning_output_tokens" >= 0
        AND "cached_input_tokens" <= "input_tokens"
        AND "reasoning_output_tokens" <= "output_tokens"
    )
);

CREATE UNIQUE INDEX "token_usage_records_snapshot_key_key"
    ON "token_usage_records"("snapshot_key");
CREATE INDEX "token_usage_records_owner_observed_idx"
    ON "token_usage_records"("owner_id", "observed_at" DESC);
CREATE INDEX "token_usage_records_model_observed_idx"
    ON "token_usage_records"("model", "observed_at" DESC);
CREATE INDEX "token_usage_records_observed_idx"
    ON "token_usage_records"("observed_at" DESC);
CREATE INDEX "token_usage_records_conversation_idx"
    ON "token_usage_records"("conversation_id");
CREATE INDEX "token_usage_records_turn_idx"
    ON "token_usage_records"("turn_id");
