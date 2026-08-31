-- DATA LOSS CONFIRMED: the product owner explicitly approved discarding all
-- existing conversation history and the legacy runtime cleanup outbox. This
-- removes the complete conversation graph before the mandatory owner routing
-- key is introduced, so no legacy or orphaned conversation records survive.
-- Existing MinIO objects and old Docker volumes are intentionally not handled
-- by SQL; the deployment upgrade procedure retires those storage resources.

BEGIN;

TRUNCATE TABLE
    "conversation_drafts",
    "pending_requests",
    "conversation_turns",
    "conversation_messages",
    "conversation_events",
    "conversation_files",
    "retained_artifacts",
    "runtime_cleanup_outbox",
    "conversations";

ALTER TABLE "runtime_cleanup_outbox"
    ADD COLUMN "owner_id" UUID NOT NULL;

CREATE INDEX "runtime_cleanup_outbox_owner_status_created_idx"
    ON "runtime_cleanup_outbox"("owner_id", "status", "created_at");

COMMIT;
