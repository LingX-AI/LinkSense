import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("task category migration", () => {
  it("adds nullable sorting without rewriting categories, tasks, or existing fields", async () => {
    const sql = await readFile(new URL("../../../prisma/migrations/20260909160000_add_task_category_sort_order/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('ADD COLUMN "sort_order" INTEGER;');
    expect(sql).toContain('CHECK ("sort_order" IS NULL OR "sort_order" >= 0)');
    expect(sql).toContain('("owner_id", "sort_order", "created_at", "id")');
    expect(sql).not.toMatch(/\b(?:TRUNCATE|DELETE|UPDATE|REFERENCES|FOREIGN KEY)\b|DROP\s+(?:TABLE|COLUMN)|SET\s+NOT\s+NULL/iu);
  });
  it("adds optional classification without changing existing data or adding foreign keys", async () => {
    const sql = await readFile(new URL("../../../prisma/migrations/20260909120000_add_task_categories/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('CREATE TABLE "task_categories"');
    expect(sql).toContain('ADD COLUMN "category_id" UUID;');
    expect(sql).toContain('"task_categories_owner_name_key"');
    expect(sql).toContain('"conversations_owner_category_archive_pin_order_idx"');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|REFERENCES|FOREIGN KEY)\b/iu);
  });
});
