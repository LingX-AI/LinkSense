-- Additive migration only. Existing local knowledge bases and documents are
-- preserved; no table, column, index, or historical row is removed.

BEGIN;

ALTER TABLE "knowledge_bases"
  ADD COLUMN "source_type" VARCHAR(32) NOT NULL DEFAULT 'local',
  ADD CONSTRAINT "knowledge_bases_source_type_check"
    CHECK ("source_type" IN ('local', 'sharepoint'));

CREATE TABLE "knowledge_base_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "knowledge_base_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "source_url" TEXT NOT NULL,
  "site_id" TEXT NOT NULL,
  "drive_id" TEXT NOT NULL,
  "root_item_id" TEXT NOT NULL,
  "site_name" VARCHAR(260) NOT NULL,
  "drive_name" VARCHAR(260) NOT NULL,
  "folder_name" VARCHAR(260) NOT NULL,
  "delta_link" TEXT,
  "sync_interval_minutes" INTEGER NOT NULL DEFAULT 60,
  "sync_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "stable_error_code" VARCHAR(120),
  "last_synced_at" TIMESTAMPTZ(6),
  "next_sync_at" TIMESTAMPTZ(6),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_base_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_base_sources_provider_check" CHECK ("provider" = 'sharepoint'),
  CONSTRAINT "knowledge_base_sources_sync_status_check" CHECK ("sync_status" IN ('pending', 'syncing', 'ready', 'failed')),
  CONSTRAINT "knowledge_base_sources_interval_check" CHECK ("sync_interval_minutes" BETWEEN 15 AND 1440)
);

CREATE UNIQUE INDEX "knowledge_base_sources_knowledge_base_id_key"
  ON "knowledge_base_sources"("knowledge_base_id");
CREATE UNIQUE INDEX "knowledge_base_sources_provider_root_key"
  ON "knowledge_base_sources"("provider", "site_id", "drive_id", "root_item_id");
CREATE INDEX "knowledge_base_sources_sync_due_idx"
  ON "knowledge_base_sources"("sync_status", "next_sync_at");
CREATE INDEX "knowledge_base_sources_created_by_idx"
  ON "knowledge_base_sources"("created_by");

CREATE TABLE "knowledge_source_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "external_item_id" TEXT NOT NULL,
  "parent_external_item_id" TEXT,
  "document_id" UUID,
  "item_type" VARCHAR(32) NOT NULL,
  "name" VARCHAR(260) NOT NULL,
  "mime_type" VARCHAR(160),
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "etag" TEXT,
  "ctag" TEXT,
  "synced_etag" TEXT,
  "synced_ctag" TEXT,
  "web_url" TEXT,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_source_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_source_items_type_check" CHECK ("item_type" IN ('file', 'folder')),
  CONSTRAINT "knowledge_source_items_size_check" CHECK ("size_bytes" >= 0)
);

CREATE UNIQUE INDEX "knowledge_source_items_source_external_key"
  ON "knowledge_source_items"("source_id", "external_item_id");
CREATE INDEX "knowledge_source_items_source_parent_idx"
  ON "knowledge_source_items"("source_id", "parent_external_item_id");
CREATE INDEX "knowledge_source_items_document_id_idx"
  ON "knowledge_source_items"("document_id");
CREATE INDEX "knowledge_source_items_source_deleted_idx"
  ON "knowledge_source_items"("source_id", "deleted_at");

CREATE TABLE "knowledge_source_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "source_id" UUID NOT NULL,
  "trigger_type" VARCHAR(32) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'running',
  "scanned_count" INTEGER NOT NULL DEFAULT 0,
  "created_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "deleted_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "stable_error_code" VARCHAR(120),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_source_sync_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "knowledge_source_sync_runs_trigger_check" CHECK ("trigger_type" IN ('initial', 'scheduled', 'manual')),
  CONSTRAINT "knowledge_source_sync_runs_status_check" CHECK ("status" IN ('running', 'completed', 'partial', 'failed')),
  CONSTRAINT "knowledge_source_sync_runs_counts_check" CHECK (
    "scanned_count" >= 0 AND "created_count" >= 0 AND "updated_count" >= 0
    AND "deleted_count" >= 0 AND "skipped_count" >= 0 AND "failed_count" >= 0
  )
);

CREATE INDEX "knowledge_source_sync_runs_source_started_idx"
  ON "knowledge_source_sync_runs"("source_id", "started_at" DESC);
CREATE INDEX "knowledge_source_sync_runs_status_started_idx"
  ON "knowledge_source_sync_runs"("status", "started_at");

COMMIT;
