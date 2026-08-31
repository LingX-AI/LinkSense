import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260812113000_add_conversation_sort_order/migration.sql",
  import.meta.url,
);

describe("conversation sort order migration", () => {
  it("adds nullable ordering metadata and an index without destructive SQL", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('ADD COLUMN "sort_order" INTEGER');
    expect(sql).toContain('CONSTRAINT "conversations_sort_order_check"');
    expect(sql).toContain(
      'CREATE INDEX "conversations_owner_archive_pin_order_idx"',
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/"sort_order"\s+INTEGER\s+NOT\s+NULL/iu);
  });
});
