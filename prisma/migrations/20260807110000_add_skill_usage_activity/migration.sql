-- Additive, forward-only storage for personal Skill usage analytics.
-- Existing task and turn usage rows are preserved. The backfill below only
-- copies Skill selections still present in operational turn attempt records;
-- already-deleted tasks cannot be reconstructed reliably.

BEGIN;

ALTER TABLE "usage_activity_records"
  DROP CONSTRAINT "usage_activity_records_activity_shape_check";

ALTER TABLE "usage_activity_records"
  ADD COLUMN "capability_id" VARCHAR(240),
  ADD COLUMN "capability_name" VARCHAR(160);

ALTER TABLE "usage_activity_records"
  ADD CONSTRAINT "usage_activity_records_activity_shape_check" CHECK (
    (
      "activity_type" = 'task_created'
      AND "source_id" = "conversation_id"
      AND "turn_id" IS NULL
      AND "model" IS NULL
      AND "capability_id" IS NULL
      AND "capability_name" IS NULL
    )
    OR (
      "activity_type" = 'turn_started'
      AND "turn_id" = "source_id"
      AND "capability_id" IS NULL
      AND "capability_name" IS NULL
    )
    OR (
      "activity_type" = 'skill_used'
      AND "turn_id" IS NOT NULL
      AND "model" IS NULL
      AND "capability_id" IS NOT NULL
      AND "capability_name" IS NOT NULL
    )
  );

CREATE INDEX "usage_activity_records_owner_type_capability_idx"
  ON "usage_activity_records"("owner_id", "activity_type", "capability_id");

WITH "built_in_skill_ids"("capability_id", "capability_name") AS (
  VALUES
    ('builtin:capability:linksense-browser', 'linksense-browser'),
    ('builtin:capability:linksense-docs', 'linksense-docs'),
    ('builtin:capability:linksense-file-service', 'linksense-file-service'),
    ('builtin:capability:linksense-knowledge-base', 'linksense-knowledge-base'),
    ('builtin:capability:linksense-skill-creator', 'linksense-skill-creator')
),
"selected_skills" AS (
  SELECT DISTINCT ON ("turns"."id", "selected"."capability_id")
    "turns"."id" AS "turn_id",
    "turns"."submitted_by" AS "owner_id",
    "turns"."conversation_id",
    "turns"."started_at" AS "occurred_at",
    "selected"."capability_id",
    COALESCE(
      "capabilities"."name",
      "built_in_skill_ids"."capability_name",
      "selected"."capability_id"
    ) AS "capability_name"
  FROM "conversation_turn_attempts" AS "attempts"
  JOIN "conversation_turns" AS "turns"
    ON "turns"."id" = "attempts"."turn_id"
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(
      "attempts"."continuation_context_json" -> 'priority_capability_ids',
      '[]'::jsonb
    )
  ) AS "selected"("capability_id")
  LEFT JOIN "capabilities"
    ON "capabilities"."id"::text = "selected"."capability_id"
    AND "capabilities"."type" = 'skill'
  LEFT JOIN "built_in_skill_ids"
    ON "built_in_skill_ids"."capability_id" = "selected"."capability_id"
  WHERE
    "attempts"."attempt_no" = 1
    AND (
      "capabilities"."id" IS NOT NULL
      OR "built_in_skill_ids"."capability_id" IS NOT NULL
    )
  ORDER BY "turns"."id", "selected"."capability_id"
)
INSERT INTO "usage_activity_records" (
  "activity_type",
  "source_id",
  "owner_id",
  "conversation_id",
  "turn_id",
  "capability_id",
  "capability_name",
  "occurred_at"
)
SELECT
  'skill_used',
  gen_random_uuid(),
  "owner_id",
  "conversation_id",
  "turn_id",
  "capability_id",
  "capability_name",
  "occurred_at"
FROM "selected_skills";

CREATE UNIQUE INDEX "usage_activity_records_type_turn_capability_key"
  ON "usage_activity_records"("activity_type", "turn_id", "capability_id");

COMMIT;
