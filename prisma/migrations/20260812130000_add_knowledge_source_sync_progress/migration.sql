-- Add persistent SharePoint synchronization progress and resumable checkpoints.
-- Existing source, item, document, and synchronization-run rows are preserved.

BEGIN;

ALTER TABLE "knowledge_source_items"
  ADD COLUMN "sync_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN "sync_action" VARCHAR(32),
  ADD COLUMN "sync_failure_phase" VARCHAR(32),
  ADD COLUMN "stable_error_code" VARCHAR(120),
  ADD COLUMN "last_sync_run_id" UUID;

UPDATE "knowledge_source_items"
SET "sync_status" = CASE
  WHEN "item_type" = 'folder' THEN 'synced'
  WHEN "deleted_at" IS NOT NULL AND "document_id" IS NULL THEN 'synced'
  WHEN "synced_etag" IS NOT DISTINCT FROM "etag"
    AND "synced_ctag" IS NOT DISTINCT FROM "ctag"
    AND "document_id" IS NOT NULL THEN 'synced'
  ELSE 'pending'
END;

ALTER TABLE "knowledge_source_items"
  ADD CONSTRAINT "knowledge_source_items_sync_status_check"
    CHECK ("sync_status" IN ('pending', 'processing', 'synced', 'failed')),
  ADD CONSTRAINT "knowledge_source_items_sync_action_check"
    CHECK (
      "sync_action" IS NULL
      OR "sync_action" IN ('create', 'update', 'delete', 'skip', 'retry')
    ),
  ADD CONSTRAINT "knowledge_source_items_sync_failure_phase_check"
    CHECK (
      "sync_failure_phase" IS NULL
      OR "sync_failure_phase" IN ('syncing', 'processing')
    ),
  ADD CONSTRAINT "knowledge_source_items_sync_shape_check"
    CHECK (
      ("sync_status" = 'processing'
        AND "sync_action" IS NOT NULL
        AND "last_sync_run_id" IS NOT NULL
        AND "sync_failure_phase" IS NULL
        AND "stable_error_code" IS NULL)
      OR ("sync_status" = 'failed'
        AND "sync_action" IS NULL
        AND "last_sync_run_id" IS NOT NULL
        AND "sync_failure_phase" IS NOT NULL
        AND "stable_error_code" IS NOT NULL)
      OR ("sync_status" IN ('pending', 'synced')
        AND "sync_action" IS NULL
        AND "sync_failure_phase" IS NULL
        AND "stable_error_code" IS NULL)
    );

CREATE INDEX "knowledge_source_items_source_sync_status_idx"
  ON "knowledge_source_items"("source_id", "sync_status");
CREATE INDEX "knowledge_source_items_run_sync_status_idx"
  ON "knowledge_source_items"("last_sync_run_id", "sync_status");

ALTER TABLE "knowledge_source_sync_runs"
  DROP CONSTRAINT "knowledge_source_sync_runs_trigger_check",
  DROP CONSTRAINT "knowledge_source_sync_runs_counts_check",
  ADD COLUMN "phase" VARCHAR(32) NOT NULL DEFAULT 'scanning',
  ADD COLUMN "failure_phase" VARCHAR(32),
  ADD COLUMN "retry_of_run_id" UUID,
  ADD COLUMN "scan_base_cursor" TEXT,
  ADD COLUMN "scan_cursor" TEXT,
  ADD COLUMN "scan_delta_link" TEXT,
  ADD COLUMN "total_count" INTEGER,
  ADD COLUMN "processed_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retried_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "knowledge_source_sync_runs"
SET "processed_count" =
  "created_count"
  + "updated_count"
  + "deleted_count"
  + "skipped_count"
  + "failed_count";

UPDATE "knowledge_source_sync_runs"
SET
  "phase" = 'completed',
  "total_count" = "processed_count",
  "completed_at" = COALESCE("completed_at", "updated_at", "started_at")
WHERE "status" <> 'running';

UPDATE "knowledge_source_sync_runs"
SET "completed_at" = NULL
WHERE "status" = 'running';

ALTER TABLE "knowledge_source_sync_runs"
  ADD CONSTRAINT "knowledge_source_sync_runs_trigger_check"
    CHECK ("trigger_type" IN ('initial', 'scheduled', 'manual', 'retry')),
  ADD CONSTRAINT "knowledge_source_sync_runs_phase_check"
    CHECK ("phase" IN ('scanning', 'syncing', 'processing', 'completed')),
  ADD CONSTRAINT "knowledge_source_sync_runs_failure_phase_check"
    CHECK (
      "failure_phase" IS NULL
      OR "failure_phase" IN ('scanning', 'syncing', 'processing')
    ),
  ADD CONSTRAINT "knowledge_source_sync_runs_counts_check" CHECK (
    "scanned_count" >= 0
    AND ("total_count" IS NULL OR "total_count" >= 0)
  ),
  ADD CONSTRAINT "knowledge_source_sync_runs_processed_counts_check" CHECK (
    "processed_count" >= 0
    AND "created_count" >= 0
    AND "updated_count" >= 0
    AND "deleted_count" >= 0
    AND "skipped_count" >= 0
    AND "retried_count" >= 0
    AND "failed_count" >= 0
    AND "processed_count" = (
      "created_count"
      + "updated_count"
      + "deleted_count"
      + "skipped_count"
      + "retried_count"
      + "failed_count"
    )
    AND ("total_count" IS NULL OR "processed_count" <= "total_count")
  ),
  ADD CONSTRAINT "knowledge_source_sync_runs_terminal_shape_check" CHECK (
    ("status" = 'running'
      AND "phase" IN ('scanning', 'syncing', 'processing')
      AND "completed_at" IS NULL)
    OR ("status" <> 'running'
      AND "phase" = 'completed'
      AND "completed_at" IS NOT NULL)
  );

CREATE INDEX "knowledge_source_sync_runs_retry_started_idx"
  ON "knowledge_source_sync_runs"("retry_of_run_id", "started_at");

COMMIT;
