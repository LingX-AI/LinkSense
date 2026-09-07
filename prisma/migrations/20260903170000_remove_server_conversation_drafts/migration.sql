-- Historical text drafts are intentionally discarded. Unsubmitted attachments
-- remain valid task-scoped staged files and no longer depend on a draft row.
BEGIN;

ALTER TABLE "conversation_files"
  DROP CONSTRAINT "conversation_files_draft_binding_check",
  DROP CONSTRAINT "conversation_files_pending_binding_check",
  DROP CONSTRAINT "conversation_files_bound_binding_check",
  DROP CONSTRAINT "conversation_files_artifact_binding_check",
  DROP CONSTRAINT "conversation_files_kind_status_check",
  DROP CONSTRAINT "conversation_files_status_check";

UPDATE "conversation_files"
SET "status" = 'staged'
WHERE "status" = 'draft';

DROP INDEX "conversation_files_draft_id_idx";

ALTER TABLE "conversation_files"
  DROP COLUMN "draft_id";

ALTER TABLE "conversation_files"
  ADD CONSTRAINT "conversation_files_status_check" CHECK (
    "status" IN ('staged', 'pending', 'bound', 'registered')
  ),
  ADD CONSTRAINT "conversation_files_kind_status_check" CHECK (
    ("kind" = 'attachment' AND "status" IN ('staged', 'pending', 'bound'))
    OR ("kind" = 'artifact' AND "status" = 'registered')
  ),
  ADD CONSTRAINT "conversation_files_staged_binding_check" CHECK (
    "kind" <> 'attachment' OR "status" <> 'staged'
    OR ("pending_request_id" IS NULL AND "turn_id" IS NULL)
  ),
  ADD CONSTRAINT "conversation_files_pending_binding_check" CHECK (
    "kind" <> 'attachment' OR "status" <> 'pending'
    OR ("pending_request_id" IS NOT NULL AND "turn_id" IS NULL)
  ),
  ADD CONSTRAINT "conversation_files_bound_binding_check" CHECK (
    "kind" <> 'attachment' OR "status" <> 'bound'
    OR ("pending_request_id" IS NULL AND "turn_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "conversation_files_artifact_binding_check" CHECK (
    "kind" <> 'artifact' OR "pending_request_id" IS NULL
  );

ALTER TABLE "conversation_turn_start_intents"
  RENAME COLUMN "preserves_draft" TO "preserves_staged_attachments";

DROP TABLE "conversation_drafts";

COMMIT;
