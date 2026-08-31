-- Replace the previously published multi-weekday storage with the approved
-- single weekday model. Additional historical weekday selections are
-- intentionally discarded; the first selected weekday is retained.

BEGIN;

ALTER TABLE "knowledge_base_sources"
  DROP CONSTRAINT "knowledge_base_sources_sync_schedule_shape_check",
  DROP CONSTRAINT "knowledge_base_sources_sync_weekdays_check",
  ADD COLUMN "sync_weekday" INTEGER;

UPDATE "knowledge_base_sources"
SET "sync_weekday" = CASE
  WHEN "sync_frequency" = 'weekly' THEN "sync_weekdays"[1]
  ELSE NULL
END;

ALTER TABLE "knowledge_base_sources"
  DROP COLUMN "sync_weekdays",
  ADD CONSTRAINT "knowledge_base_sources_sync_weekday_check"
    CHECK ("sync_weekday" IS NULL OR "sync_weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "knowledge_base_sources_sync_schedule_shape_check"
    CHECK (
      ("sync_frequency" = 'daily'
        AND "sync_weekday" IS NULL
        AND "sync_day_of_month" IS NULL)
      OR ("sync_frequency" = 'weekly'
        AND "sync_weekday" IS NOT NULL
        AND "sync_day_of_month" IS NULL)
      OR ("sync_frequency" = 'monthly'
        AND "sync_weekday" IS NULL
        AND "sync_day_of_month" IS NOT NULL)
    );

COMMIT;
