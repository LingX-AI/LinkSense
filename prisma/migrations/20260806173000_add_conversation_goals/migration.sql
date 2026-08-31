ALTER TABLE "conversation_turns"
ADD COLUMN "task_kind" VARCHAR(32) NOT NULL DEFAULT 'turn';

ALTER TABLE "conversation_turn_start_intents"
ADD COLUMN "task_kind" VARCHAR(32) NOT NULL DEFAULT 'turn',
ADD COLUMN "goal_objective" TEXT,
ADD COLUMN "goal_token_budget" BIGINT;

CREATE TABLE "conversation_goals" (
    "conversation_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "codex_thread_id" TEXT NOT NULL,
    "active_turn_id" UUID,
    "objective" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "token_budget" BIGINT,
    "tokens_used" BIGINT NOT NULL DEFAULT 0,
    "time_used_seconds" BIGINT NOT NULL DEFAULT 0,
    "native_created_at" TIMESTAMPTZ(6) NOT NULL,
    "native_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_goals_pkey" PRIMARY KEY ("conversation_id")
);

CREATE UNIQUE INDEX "conversation_goals_codex_thread_id_key"
ON "conversation_goals"("codex_thread_id");

CREATE INDEX "conversation_goals_owner_status_idx"
ON "conversation_goals"("owner_id", "status");

CREATE INDEX "conversation_goals_active_turn_idx"
ON "conversation_goals"("active_turn_id");
