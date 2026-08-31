ALTER TABLE "conversations"
ADD COLUMN "pinned_at" TIMESTAMPTZ(6);

CREATE INDEX "conversations_owner_archive_pinned_idx"
ON "conversations"("owner_id", "archive_status", "pinned_at" DESC);
