CREATE TABLE "billing_statements" (
    "id" UUID NOT NULL,
    "statement_number" VARCHAR(40) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end_exclusive" TIMESTAMPTZ(6) NOT NULL,
    "time_zone" VARCHAR(120) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CNY',
    "status" VARCHAR(24) NOT NULL DEFAULT 'generated',
    "total_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
    "unpriced_tokens" BIGINT NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_statements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_statement_lines" (
    "id" UUID NOT NULL,
    "statement_id" UUID NOT NULL,
    "model" VARCHAR(240) NOT NULL,
    "display_name" VARCHAR(120),
    "total_tokens" BIGINT NOT NULL,
    "input_tokens" BIGINT NOT NULL,
    "cached_input_tokens" BIGINT NOT NULL,
    "output_tokens" BIGINT NOT NULL,
    "reasoning_output_tokens" BIGINT NOT NULL,
    "input_price_micros_per_million" BIGINT,
    "cached_input_price_micros_per_million" BIGINT,
    "output_price_micros_per_million" BIGINT,
    "mixed_pricing" BOOLEAN NOT NULL DEFAULT false,
    "input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
    "cached_input_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
    "output_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
    "total_cost_pico_cny" BIGINT NOT NULL DEFAULT 0,
    "unpriced_tokens" BIGINT NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_statement_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_statements_number_key" ON "billing_statements"("statement_number");
CREATE UNIQUE INDEX "billing_statements_period_timezone_key" ON "billing_statements"("period_start", "time_zone");
CREATE INDEX "billing_statements_generated_idx" ON "billing_statements"("generated_at" DESC);
CREATE UNIQUE INDEX "billing_statement_lines_statement_model_key" ON "billing_statement_lines"("statement_id", "model");
CREATE INDEX "billing_statement_lines_statement_order_idx" ON "billing_statement_lines"("statement_id", "sort_order");
