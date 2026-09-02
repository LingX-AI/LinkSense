import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260902120000_add_conversation_forks/migration.sql",
    import.meta.url,
  ),
);

describe("conversation fork migration", () => {
  it("adds fork metadata and scopes native turn uniqueness without deleting historical rows", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('ADD COLUMN "fork_root_id" UUID');
    expect(migration).toContain(
      'CREATE TABLE "conversation_fork_counters"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "conversation_turns_conversation_codex_turn_key"',
    );
    expect(migration).toContain(
      'DROP INDEX IF EXISTS "conversation_turns_codex_turn_id_key"',
    );
    expect(migration).not.toMatch(
      /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE|UPDATE)\b/iu,
    );
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
