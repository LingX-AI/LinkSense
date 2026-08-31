BEGIN;

ALTER TABLE "usage_activity_records"
  ADD COLUMN "application_id" UUID,
  ADD COLUMN "application_name_snapshot" VARCHAR(160);

ALTER TABLE "token_usage_records"
  ADD COLUMN "application_id" UUID,
  ADD COLUMN "application_name_snapshot" VARCHAR(160);

ALTER TABLE "model_usage_records"
  ADD COLUMN "application_id" UUID,
  ADD COLUMN "application_name_snapshot" VARCHAR(160);

UPDATE "usage_activity_records" AS "usage"
SET
  "application_id" = "conversation"."application_id",
  "application_name_snapshot" = "conversation"."application_name_snapshot"
FROM "conversations" AS "conversation"
WHERE "usage"."conversation_id" = "conversation"."id"
  AND "conversation"."application_id" IS NOT NULL;

UPDATE "token_usage_records" AS "usage"
SET
  "application_id" = "conversation"."application_id",
  "application_name_snapshot" = "conversation"."application_name_snapshot"
FROM "conversations" AS "conversation"
WHERE "usage"."conversation_id" = "conversation"."id"
  AND "conversation"."application_id" IS NOT NULL;

UPDATE "model_usage_records" AS "usage"
SET
  "application_id" = "conversation"."application_id",
  "application_name_snapshot" = "conversation"."application_name_snapshot"
FROM "conversations" AS "conversation"
WHERE "usage"."conversation_id" = "conversation"."id"
  AND "conversation"."application_id" IS NOT NULL;

ALTER TABLE "usage_activity_records"
  ADD CONSTRAINT "usage_activity_records_application_snapshot_check"
  CHECK (
    ("application_id" IS NULL AND "application_name_snapshot" IS NULL)
    OR
    ("application_id" IS NOT NULL AND "application_name_snapshot" IS NOT NULL)
  );

ALTER TABLE "token_usage_records"
  ADD CONSTRAINT "token_usage_records_application_snapshot_check"
  CHECK (
    ("application_id" IS NULL AND "application_name_snapshot" IS NULL)
    OR
    ("application_id" IS NOT NULL AND "application_name_snapshot" IS NOT NULL)
  );

ALTER TABLE "model_usage_records"
  ADD CONSTRAINT "model_usage_records_application_snapshot_check"
  CHECK (
    ("application_id" IS NULL AND "application_name_snapshot" IS NULL)
    OR
    ("application_id" IS NOT NULL AND "application_name_snapshot" IS NOT NULL)
  );

CREATE INDEX "usage_activity_records_application_occurred_idx"
  ON "usage_activity_records"("application_id", "occurred_at" DESC);

CREATE INDEX "token_usage_records_application_observed_idx"
  ON "token_usage_records"("application_id", "observed_at" DESC);

CREATE INDEX "model_usage_records_application_observed_idx"
  ON "model_usage_records"("application_id", "observed_at" DESC);

COMMIT;
