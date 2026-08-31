-- Forward-only repair for synchronization fields that were added after the
-- original knowledge-source migration had already been applied. This migration
-- does not delete or rewrite business rows.

BEGIN;

ALTER TABLE "knowledge_base_sources"
  ADD COLUMN "sync_lease_expires_at" TIMESTAMPTZ(6);

CREATE INDEX "knowledge_base_sources_sync_lease_idx"
  ON "knowledge_base_sources"("sync_status", "sync_lease_expires_at");

-- A document can be mapped to at most one external source item. PostgreSQL
-- permits multiple NULL values through the partial unique index.
DROP INDEX "knowledge_source_items_document_id_idx";
CREATE UNIQUE INDEX "knowledge_source_items_document_id_key"
  ON "knowledge_source_items"("document_id")
  WHERE "document_id" IS NOT NULL;

COMMIT;
