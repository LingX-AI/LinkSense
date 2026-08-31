-- Additive task ordering metadata. Existing tasks keep their current
-- timestamp-based order until the owner explicitly reorders a sidebar group.
ALTER TABLE "conversations"
ADD COLUMN "sort_order" INTEGER;

ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_sort_order_check"
CHECK ("sort_order" IS NULL OR "sort_order" >= 0);

CREATE INDEX "conversations_owner_archive_pin_order_idx"
ON "conversations"("owner_id", "archive_status", "pinned_at", "sort_order");
