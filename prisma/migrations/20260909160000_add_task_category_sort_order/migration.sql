BEGIN;

-- Existing categories keep their creation order until explicitly reordered.
ALTER TABLE "task_categories" ADD COLUMN "sort_order" INTEGER;
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_sort_order_check"
  CHECK ("sort_order" IS NULL OR "sort_order" >= 0);

CREATE INDEX "task_categories_owner_order_idx"
  ON "task_categories" ("owner_id", "sort_order", "created_at", "id");
DROP INDEX "task_categories_owner_created_idx";

COMMIT;
