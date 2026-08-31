-- Destructive schedule replacement approved for this release. Historical
-- 15-minute/hourly interval values are intentionally discarded, while source,
-- item, document, and synchronization-run rows remain intact.

BEGIN;

ALTER TABLE "knowledge_base_sources"
  DROP CONSTRAINT "knowledge_base_sources_interval_check",
  ADD COLUMN "sync_frequency" VARCHAR(16) NOT NULL DEFAULT 'daily',
  ADD COLUMN "sync_time_of_day_minutes" INTEGER NOT NULL DEFAULT 540,
  ADD COLUMN "sync_time_zone" VARCHAR(120) NOT NULL DEFAULT 'Asia/Shanghai',
  ADD COLUMN "sync_weekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "sync_day_of_month" INTEGER;

-- Existing sources start from the explicitly approved clean default:
-- every day at 09:00 Asia/Shanghai. Old next-run times are not retained.
UPDATE "knowledge_base_sources"
SET
  "next_sync_at" = CASE
    WHEN (
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')
      + INTERVAL '9 hours'
    ) AT TIME ZONE 'Asia/Shanghai' > CURRENT_TIMESTAMP
    THEN (
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')
      + INTERVAL '9 hours'
    ) AT TIME ZONE 'Asia/Shanghai'
    ELSE (
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')
      + INTERVAL '1 day 9 hours'
    ) AT TIME ZONE 'Asia/Shanghai'
  END,
  "updated_at" = CURRENT_TIMESTAMP;

ALTER TABLE "knowledge_base_sources"
  DROP COLUMN "sync_interval_minutes",
  ADD CONSTRAINT "knowledge_base_sources_sync_frequency_check"
    CHECK ("sync_frequency" IN ('daily', 'weekly', 'monthly')),
  ADD CONSTRAINT "knowledge_base_sources_sync_time_of_day_check"
    CHECK ("sync_time_of_day_minutes" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "knowledge_base_sources_sync_time_zone_check"
    CHECK (
      char_length("sync_time_zone") BETWEEN 1 AND 120
      AND "sync_time_zone" !~ '[[:cntrl:]]'
    ),
  ADD CONSTRAINT "knowledge_base_sources_sync_weekdays_check"
    CHECK (
      cardinality("sync_weekdays") <= 7
      AND "sync_weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INTEGER[]
      AND cardinality(array_positions("sync_weekdays", 1)) <= 1
      AND cardinality(array_positions("sync_weekdays", 2)) <= 1
      AND cardinality(array_positions("sync_weekdays", 3)) <= 1
      AND cardinality(array_positions("sync_weekdays", 4)) <= 1
      AND cardinality(array_positions("sync_weekdays", 5)) <= 1
      AND cardinality(array_positions("sync_weekdays", 6)) <= 1
      AND cardinality(array_positions("sync_weekdays", 7)) <= 1
    ),
  ADD CONSTRAINT "knowledge_base_sources_sync_day_of_month_check"
    CHECK (
      "sync_day_of_month" IS NULL
      OR "sync_day_of_month" BETWEEN 1 AND 31
    ),
  ADD CONSTRAINT "knowledge_base_sources_sync_schedule_shape_check"
    CHECK (
      ("sync_frequency" = 'daily'
        AND cardinality("sync_weekdays") = 0
        AND "sync_day_of_month" IS NULL)
      OR ("sync_frequency" = 'weekly'
        AND cardinality("sync_weekdays") BETWEEN 1 AND 7
        AND "sync_day_of_month" IS NULL)
      OR ("sync_frequency" = 'monthly'
        AND cardinality("sync_weekdays") = 0
        AND "sync_day_of_month" IS NOT NULL)
    );

COMMIT;
