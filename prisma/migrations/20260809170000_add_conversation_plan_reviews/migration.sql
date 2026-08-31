-- Additive durable client-side review state for completed native Codex Plan
-- items. Existing rows and migrations are left untouched; no historical Plan
-- output is backfilled.

BEGIN;

ALTER TABLE "conversation_turn_start_intents"
  ADD COLUMN "plan_review_id" UUID,
  ADD COLUMN "plan_review_action" VARCHAR(24),
  ADD CONSTRAINT "conversation_turn_start_intents_plan_review_check" CHECK (
    ("plan_review_id" IS NULL AND "plan_review_action" IS NULL)
    OR (
      "plan_review_id" IS NOT NULL
      AND "plan_review_action" IN ('implement', 'revise')
    )
  );

CREATE UNIQUE INDEX "conversation_turn_start_intents_plan_review_key"
  ON "conversation_turn_start_intents"("plan_review_id");

CREATE TABLE "conversation_plan_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "source_turn_id" UUID NOT NULL,
  "plan_message_id" UUID NOT NULL,
  "codex_item_id" TEXT NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "decision" VARCHAR(24),
  "follow_up_turn_id" UUID,
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_plan_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "conversation_plan_reviews_state_check" CHECK (
    (
      "status" IN ('preparing', 'pending')
      AND "decision" IS NULL
      AND "follow_up_turn_id" IS NULL
      AND "resolved_at" IS NULL
    )
    OR (
      "status" = 'cancelled'
      AND "decision" IS NULL
      AND "follow_up_turn_id" IS NULL
      AND "resolved_at" IS NOT NULL
    )
    OR (
      "status" = 'resolved'
      AND "decision" IN ('implement', 'revise')
      AND "follow_up_turn_id" IS NOT NULL
      AND "resolved_at" IS NOT NULL
    )
    OR (
      "status" = 'resolved'
      AND "decision" IN ('skip', 'exit')
      AND "follow_up_turn_id" IS NULL
      AND "resolved_at" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "conversation_plan_reviews_source_turn_key"
  ON "conversation_plan_reviews"("source_turn_id");

CREATE UNIQUE INDEX "conversation_plan_reviews_plan_message_key"
  ON "conversation_plan_reviews"("plan_message_id");

CREATE UNIQUE INDEX "conversation_plan_reviews_follow_up_turn_key"
  ON "conversation_plan_reviews"("follow_up_turn_id");

CREATE UNIQUE INDEX "conversation_plan_reviews_active_key"
  ON "conversation_plan_reviews"("conversation_id")
  WHERE "status" IN ('preparing', 'pending');

CREATE INDEX "conversation_plan_reviews_conversation_status_idx"
  ON "conversation_plan_reviews"("conversation_id", "status", "created_at");

CREATE INDEX "conversation_plan_reviews_owner_status_idx"
  ON "conversation_plan_reviews"("owner_id", "status");

COMMIT;
