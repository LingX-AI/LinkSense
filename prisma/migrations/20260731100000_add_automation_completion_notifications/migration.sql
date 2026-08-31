ALTER TABLE "automation_runs"
    ADD COLUMN "completed_at" TIMESTAMPTZ(6),
    ADD COLUMN "completion_read_at" TIMESTAMPTZ(6);

CREATE INDEX "automation_runs_owner_completion_read_idx"
    ON "automation_runs"("owner_id", "completion_read_at", "completed_at" DESC);

-- Existing successful runs predate the notification surface. Preserve their
-- completion time for consistency, but treat them as already read so rollout
-- does not create a historical notification burst.
UPDATE "automation_runs" AS "automation_run"
SET
    "completed_at" = "turn"."completed_at",
    "completion_read_at" = "turn"."completed_at"
FROM "conversation_turns" AS "turn"
WHERE "turn"."status" = 'completed'
  AND "turn"."completed_at" IS NOT NULL
  AND "automation_run"."owner_id" = "turn"."submitted_by"
  AND "automation_run"."conversation_id" = "turn"."conversation_id"
  AND (
      "automation_run"."turn_id" = "turn"."id"
      OR (
          "turn"."idempotency_key" IS NOT NULL
          AND "automation_run"."idempotency_key" = "turn"."idempotency_key"
      )
  );

ALTER TABLE "automation_runs"
    ADD CONSTRAINT "automation_runs_completion_read_check" CHECK (
        "completion_read_at" IS NULL
        OR (
            "completed_at" IS NOT NULL
            AND "completion_read_at" >= "completed_at"
        )
    );
