import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds an optional image reference without changing historical data or foreign keys", async () => {
  const sql = await readFile(
    new URL(
      "../../../prisma/migrations/20260905160000_conversation_knowledge_image_snapshots/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(sql).toContain('ADD COLUMN "knowledge_asset_reference_id" UUID');
  expect(sql).toContain('("conversation_id", "knowledge_asset_reference_id")');
  expect(sql).not.toMatch(
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|REFERENCES)\b|NOT NULL/iu,
  );
});
