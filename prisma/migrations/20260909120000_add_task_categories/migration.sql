CREATE TABLE "task_categories" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "task_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_categories_name_check" CHECK (length(btrim("name")) > 0 AND "name" = btrim("name"))
);

CREATE UNIQUE INDEX "task_categories_owner_name_key" ON "task_categories"("owner_id", "name");
CREATE INDEX "task_categories_owner_created_idx" ON "task_categories"("owner_id", "created_at", "id");

ALTER TABLE "conversations" ADD COLUMN "category_id" UUID;
CREATE INDEX "conversations_owner_category_archive_pin_order_idx" ON "conversations"("owner_id", "category_id", "archive_status", "pinned_at", "sort_order");
