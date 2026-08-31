import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260809150000_add_conversation_plan_mode/migration.sql",
  import.meta.url,
);

describe("conversation Plan mode migration", () => {
  it("adds mode snapshots and native user input state without destructive SQL or foreign keys", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain(
      'ALTER TABLE "conversations"\n  ADD COLUMN "collaboration_mode"',
    );
    expect(sql).toContain(
      'ALTER TABLE "pending_requests"\n  ADD COLUMN "collaboration_mode"',
    );
    expect(sql).toContain(
      'ALTER TABLE "conversation_turns"\n  ADD COLUMN "collaboration_mode"',
    );
    expect(sql).toContain(
      'ALTER TABLE "conversation_turn_start_intents"\n  ADD COLUMN "collaboration_mode"',
    );
    expect(sql).toContain('CREATE TABLE "conversation_user_input_requests"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "conversation_user_input_requests_native_item_key"',
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });
});
