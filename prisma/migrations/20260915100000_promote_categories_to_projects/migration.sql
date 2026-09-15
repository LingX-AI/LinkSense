BEGIN;

-- Preserve category IDs, ownership, names, ordering, and all task assignments.
ALTER TABLE "task_categories" RENAME TO "projects";
ALTER TABLE "projects" RENAME CONSTRAINT "task_categories_pkey" TO "projects_pkey";
ALTER TABLE "projects" RENAME CONSTRAINT "task_categories_name_check" TO "projects_name_check";
ALTER TABLE "projects" RENAME CONSTRAINT "task_categories_sort_order_check" TO "projects_sort_order_check";
ALTER INDEX "task_categories_owner_name_key" RENAME TO "projects_owner_name_key";
ALTER INDEX "task_categories_owner_order_idx" RENAME TO "projects_owner_order_idx";
ALTER TABLE "conversations" RENAME COLUMN "category_id" TO "project_id";
ALTER INDEX "conversations_owner_category_archive_pin_order_idx"
  RENAME TO "conversations_owner_project_archive_pin_order_idx";

-- Sharing a directory is intentional. This removes only the uniqueness rule;
-- existing paths remain available to the separate, backed-up file conversion.
DROP INDEX "conversations_workspace_rel_path_key";

-- A file keeps its original storage address when its task changes project.
ALTER TABLE "conversation_files" ADD COLUMN "workspace_root_rel_path" TEXT;
UPDATE "conversation_files" AS file
SET "workspace_root_rel_path" = conversation."workspace_rel_path"
FROM "conversations" AS conversation
WHERE file."conversation_id" = conversation."id" AND file."storage_backend" = 'workspace';
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_workspace_root_check"
  CHECK ("storage_backend" <> 'workspace' OR "workspace_root_rel_path" IS NOT NULL);

UPDATE "conversation_turn_start_intents" AS intent
SET "attachments_json" = COALESCE((
  SELECT jsonb_agg(attachment || jsonb_build_object(
    'workspaceRootRelPath', CASE WHEN attachment ->> 'storageBackend' = 'workspace'
      THEN conversation."workspace_rel_path" ELSE NULL END
  )) FROM jsonb_array_elements(intent."attachments_json") AS attachment
), '[]'::jsonb)
FROM "conversations" AS conversation
WHERE intent."conversation_id" = conversation."id";

-- Public task shares are frozen JSON documents, so convert their contract too.
UPDATE "conversation_shares"
SET "snapshot_json" = jsonb_set(
  "snapshot_json", '{conversation}',
  (("snapshot_json" -> 'conversation') - 'category_id') ||
    jsonb_build_object('project_id', "snapshot_json" -> 'conversation' -> 'category_id')
)
WHERE jsonb_typeof("snapshot_json" -> 'conversation') = 'object'
  AND ("snapshot_json" -> 'conversation') ? 'category_id';

COMMIT;
