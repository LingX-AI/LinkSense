-- Additive, forward-only storage for mapping one LinkSense logical turn to
-- multiple native Codex turns. Existing rows are preserved and backfilled as
-- primary attempts; no tables, columns, indexes, or user data are removed.

BEGIN;

CREATE TABLE "conversation_turn_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "turn_id" UUID NOT NULL,
  "attempt_no" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "codex_thread_id" TEXT NOT NULL,
  "codex_turn_id" TEXT,
  "source_codex_turn_id" TEXT,
  "status" VARCHAR(32) NOT NULL,
  "continuation_context_json" JSONB,
  "error_code" VARCHAR(120),
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "conversation_turn_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_turn_attempts_codex_turn_id_key" UNIQUE ("codex_turn_id"),
  CONSTRAINT "conversation_turn_attempts_turn_attempt_key" UNIQUE ("turn_id", "attempt_no"),
  CONSTRAINT "conversation_turn_attempts_attempt_no_check" CHECK ("attempt_no" IN (1, 2)),
  CONSTRAINT "conversation_turn_attempts_kind_check" CHECK (
    "kind" IN ('primary', 'context_recovery')
  ),
  CONSTRAINT "conversation_turn_attempts_status_check" CHECK (
    "status" IN ('pending', 'running', 'completed', 'failed', 'interrupted')
  ),
  CONSTRAINT "conversation_turn_attempts_identity_check" CHECK (
    ("kind" = 'primary' AND "attempt_no" = 1 AND "source_codex_turn_id" IS NULL AND "codex_turn_id" IS NOT NULL)
    OR
    ("kind" = 'context_recovery' AND "attempt_no" = 2 AND "source_codex_turn_id" IS NOT NULL)
  )
);

CREATE INDEX "conversation_turn_attempts_turn_status_idx"
  ON "conversation_turn_attempts"("turn_id", "status", "attempt_no");
CREATE INDEX "conversation_turn_attempts_status_created_idx"
  ON "conversation_turn_attempts"("status", "created_at");

INSERT INTO "conversation_turn_attempts" (
  "turn_id",
  "attempt_no",
  "kind",
  "codex_thread_id",
  "codex_turn_id",
  "source_codex_turn_id",
  "status",
  "error_code",
  "error_message",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  1,
  'primary',
  "codex_thread_id",
  "codex_turn_id",
  NULL,
  "status",
  "error_code",
  "error_message",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at"
FROM "conversation_turns";

COMMIT;
