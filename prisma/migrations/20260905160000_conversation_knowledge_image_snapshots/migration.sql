-- Additive only: historical attachments remain unchanged (NULL source id).
-- No image backfill, knowledge-data rewrite, foreign keys or cascading deletes.
ALTER TABLE "conversation_files" ADD COLUMN "knowledge_asset_reference_id" UUID;
CREATE UNIQUE INDEX "conversation_files_knowledge_asset_key"
ON "conversation_files" ("conversation_id", "knowledge_asset_reference_id");
