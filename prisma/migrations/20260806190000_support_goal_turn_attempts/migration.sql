-- Forward-only constraint update for native Goal turns. This migration only
-- replaces CHECK constraints; it does not rewrite or remove existing rows.

BEGIN;

ALTER TABLE "conversation_turn_attempts"
DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_attempt_no_check",
DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_kind_check",
DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_identity_check";

ALTER TABLE "conversation_turn_attempts"
ADD CONSTRAINT "conversation_turn_attempts_attempt_no_check" CHECK (
  "attempt_no" > 0
),
ADD CONSTRAINT "conversation_turn_attempts_kind_check" CHECK (
  "kind" IN (
    'primary',
    'context_recovery',
    'goal_primary',
    'goal_continuation'
  )
),
ADD CONSTRAINT "conversation_turn_attempts_identity_check" CHECK (
  (
    "kind" = 'primary'
    AND "attempt_no" = 1
    AND "source_codex_turn_id" IS NULL
    AND "codex_turn_id" IS NOT NULL
  )
  OR
  (
    "kind" = 'context_recovery'
    AND "attempt_no" = 2
    AND "source_codex_turn_id" IS NOT NULL
  )
  OR
  (
    "kind" = 'goal_primary'
    AND "attempt_no" = 1
    AND "source_codex_turn_id" IS NULL
    AND "codex_turn_id" IS NOT NULL
  )
  OR
  (
    "kind" = 'goal_continuation'
    AND "attempt_no" > 1
    AND "source_codex_turn_id" IS NOT NULL
    AND "codex_turn_id" IS NOT NULL
  )
);

COMMIT;
