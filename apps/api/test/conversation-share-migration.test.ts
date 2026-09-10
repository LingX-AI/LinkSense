import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("immutable conversation share migration", () => {
  it("replaces task uniqueness with an index without changing stored snapshots or fields", async () => {
    const migration = await readFile(
      new URL(
        "../../../prisma/migrations/20260909130000_allow_multiple_conversation_share_snapshots/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      'CREATE INDEX "conversation_shares_conversation_id_idx"',
    );
    expect(migration).toContain(
      'DROP INDEX "conversation_shares_conversation_id_key"',
    );
    expect(migration).not.toMatch(
      /\b(?:DELETE|TRUNCATE|UPDATE|ALTER\s+TABLE|DROP\s+(?:TABLE|COLUMN)|CREATE\s+UNIQUE)\b/iu,
    );
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration.trim()).toMatch(/COMMIT;$/u);

    const schema = await readFile(
      new URL("../../../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const shareModel = schema.match(
      /model ConversationShare \{[\s\S]*?\n\}/u,
    )?.[0];
    expect(shareModel).toBeDefined();
    expect(shareModel).not.toContain("conversation_shares_conversation_id_key");
    expect(shareModel).toContain(
      '@@index([conversationId], map: "conversation_shares_conversation_id_idx")',
    );
    expect(shareModel).toContain(
      'snapshotJson   Json     @map("snapshot_json") @db.JsonB',
    );
  });
});
