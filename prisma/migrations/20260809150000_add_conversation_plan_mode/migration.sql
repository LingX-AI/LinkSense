-- Additive Codex Plan-mode projection. Existing conversations and turns stay
-- in default mode; no rows, columns, constraints, or historical values are
-- deleted or rewritten.

BEGIN;

ALTER TABLE "conversations"
  ADD COLUMN "collaboration_mode" VARCHAR(24) NOT NULL DEFAULT 'default';

ALTER TABLE "pending_requests"
  ADD COLUMN "collaboration_mode" VARCHAR(24) NOT NULL DEFAULT 'default';

ALTER TABLE "conversation_turns"
  ADD COLUMN "collaboration_mode" VARCHAR(24) NOT NULL DEFAULT 'default';

ALTER TABLE "conversation_turn_start_intents"
  ADD COLUMN "collaboration_mode" VARCHAR(24) NOT NULL DEFAULT 'default';

CREATE TABLE "conversation_user_input_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "turn_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "codex_thread_id" TEXT NOT NULL,
  "codex_turn_id" TEXT NOT NULL,
  "codex_item_id" TEXT NOT NULL,
  "native_request_id" BIGINT NOT NULL,
  "questions_json" JSONB NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "auto_resolve_at" TIMESTAMPTZ(6),
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_user_input_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_user_input_requests_native_item_key"
  ON "conversation_user_input_requests"("codex_thread_id", "codex_turn_id", "codex_item_id");

CREATE INDEX "conversation_user_input_requests_conversation_status_idx"
  ON "conversation_user_input_requests"("conversation_id", "status", "created_at");

CREATE INDEX "conversation_user_input_requests_thread_request_idx"
  ON "conversation_user_input_requests"("codex_thread_id", "native_request_id");

CREATE INDEX "conversation_user_input_requests_turn_status_idx"
  ON "conversation_user_input_requests"("turn_id", "status");

COMMIT;
