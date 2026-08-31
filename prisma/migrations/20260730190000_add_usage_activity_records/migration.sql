CREATE TABLE "usage_activity_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "activity_type" VARCHAR(32) NOT NULL,
    "source_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "model" VARCHAR(240),
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_activity_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_activity_records_activity_shape_check" CHECK (
        (
            "activity_type" = 'task_created'
            AND "source_id" = "conversation_id"
            AND "turn_id" IS NULL
            AND "model" IS NULL
        )
        OR (
            "activity_type" = 'turn_started'
            AND "turn_id" = "source_id"
        )
    )
);

CREATE UNIQUE INDEX "usage_activity_records_type_source_key"
    ON "usage_activity_records"("activity_type", "source_id");
CREATE INDEX "usage_activity_records_type_occurred_idx"
    ON "usage_activity_records"("activity_type", "occurred_at" DESC);
CREATE INDEX "usage_activity_records_owner_occurred_idx"
    ON "usage_activity_records"("owner_id", "occurred_at" DESC);
CREATE INDEX "usage_activity_records_model_occurred_idx"
    ON "usage_activity_records"("model", "occurred_at" DESC);
CREATE INDEX "usage_activity_records_conversation_idx"
    ON "usage_activity_records"("conversation_id");
CREATE INDEX "usage_activity_records_turn_idx"
    ON "usage_activity_records"("turn_id");

-- Backfill only exact facts still present in the operational tables. Previously
-- deleted tasks and turns cannot be reconstructed reliably without a backup.
INSERT INTO "usage_activity_records" (
    "activity_type",
    "source_id",
    "owner_id",
    "conversation_id",
    "occurred_at"
)
SELECT
    'task_created',
    "id",
    "owner_id",
    "id",
    "created_at"
FROM "conversations";

INSERT INTO "usage_activity_records" (
    "activity_type",
    "source_id",
    "owner_id",
    "conversation_id",
    "turn_id",
    "model",
    "occurred_at"
)
SELECT
    'turn_started',
    "id",
    "submitted_by",
    "conversation_id",
    "id",
    "model",
    "started_at"
FROM "conversation_turns";
