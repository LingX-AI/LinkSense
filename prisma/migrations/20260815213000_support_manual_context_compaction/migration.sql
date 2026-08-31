-- Forward-only constraint expansion for native manual context compaction.
-- Existing attempt rows are preserved; this migration only admits the new
-- single-attempt compact identity.

BEGIN;

ALTER TABLE "conversation_turn_attempts"
DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_kind_check",
DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_identity_check";

ALTER TABLE "conversation_turn_attempts"
ADD CONSTRAINT "conversation_turn_attempts_kind_check" CHECK (
  "kind" IN (
    'primary',
    'context_recovery',
    'goal_primary',
    'goal_continuation',
    'compact'
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
  OR
  (
    "kind" = 'compact'
    AND "attempt_no" = 1
    AND "source_codex_turn_id" IS NULL
    AND "codex_turn_id" IS NOT NULL
  )
);

COMMIT;
