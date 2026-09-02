ALTER TABLE "conversations"
ADD COLUMN "fork_root_id" UUID,
ADD COLUMN "fork_sequence" INTEGER,
ADD COLUMN "fork_source_conversation_id" UUID,
ADD COLUMN "fork_source_message_id" UUID,
ADD COLUMN "fork_idempotency_key" VARCHAR(120);

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_fork_sequence_check"
CHECK (
  ("fork_root_id" IS NULL AND "fork_sequence" IS NULL)
  OR ("fork_root_id" IS NOT NULL AND "fork_sequence" >= 2)
);

CREATE UNIQUE INDEX "conversations_owner_fork_idempotency_key"
ON "conversations"("owner_id", "fork_idempotency_key");

CREATE UNIQUE INDEX "conversations_fork_root_sequence_key"
ON "conversations"("fork_root_id", "fork_sequence");

CREATE INDEX "conversations_fork_source_message_idx"
ON "conversations"("fork_source_conversation_id", "fork_source_message_id");

CREATE TABLE "conversation_fork_counters" (
  "root_conversation_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "base_title" VARCHAR(240) NOT NULL,
  "next_sequence" INTEGER NOT NULL DEFAULT 3,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "conversation_fork_counters_pkey" PRIMARY KEY ("root_conversation_id"),
  CONSTRAINT "conversation_fork_counters_next_sequence_check" CHECK ("next_sequence" >= 3)
);

CREATE INDEX "conversation_fork_counters_owner_idx"
ON "conversation_fork_counters"("owner_id");

DROP INDEX IF EXISTS "conversation_turns_codex_turn_id_key";

CREATE UNIQUE INDEX "conversation_turns_conversation_codex_turn_key"
ON "conversation_turns"("conversation_id", "codex_turn_id");

CREATE INDEX "conversation_turns_codex_turn_idx"
ON "conversation_turns"("codex_turn_id");
