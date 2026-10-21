import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds optional side-chat metadata without rewriting existing conversations or introducing foreign keys", async () => {
  const sql = await readFile(new URL("../../../prisma/migrations/20261021090000_add_conversation_side_chat/migration.sql", import.meta.url), "utf8");
  expect(sql).toContain('ADD COLUMN "side_chat_parent_id" UUID');
  expect(sql).toContain('ADD COLUMN "side_chat_reference_json" JSONB');
  expect(sql).toContain('CREATE UNIQUE INDEX "conversations_side_chat_parent_key"');
  expect(sql).not.toMatch(/NOT NULL|REFERENCES|FOREIGN KEY|DROP|DELETE|TRUNCATE|UPDATE\s/iu);
});
