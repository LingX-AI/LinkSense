-- Preserve all historical rows and columns. Only preview-specific invariants
-- are added; existing attachment and artifact states keep their current rules.
BEGIN;

ALTER TABLE "conversation_files"
  DROP CONSTRAINT "conversation_files_kind_check",
  DROP CONSTRAINT "conversation_files_kind_status_check",
  ADD CONSTRAINT "conversation_files_kind_check" CHECK (
    "kind" IN ('attachment', 'artifact', 'image_preview')
  ),
  ADD CONSTRAINT "conversation_files_kind_status_check" CHECK (
    ("kind" = 'attachment' AND "status" IN ('staged', 'pending', 'bound'))
    OR ("kind" IN ('artifact', 'image_preview') AND "status" = 'registered')
  ),
  ADD CONSTRAINT "conversation_files_image_preview_binding_check" CHECK (
    "kind" <> 'image_preview' OR (
      "source" = 'system_generated'
      AND "status" = 'registered'
      AND "turn_id" IS NOT NULL
      AND "pending_request_id" IS NULL
      AND "storage_backend" = 'workspace'
      AND "workspace_relative_path" IS NOT NULL
      AND "workspace_root_rel_path" IS NOT NULL
      AND "minio_object_key" IS NULL
      AND "downloadable" = FALSE
      AND "download_card_event_id" IS NULL
      AND "checksum_sha256" IS NOT NULL
      AND "mime_type" IS NOT NULL
      AND "mime_type" IN ('image/png', 'image/jpeg', 'image/webp')
      AND "size_bytes" BETWEEN 1 AND 26214400
    )
  );

COMMIT;
