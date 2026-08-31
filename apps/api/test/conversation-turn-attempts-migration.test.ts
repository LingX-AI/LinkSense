import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260804120000_add_conversation_turn_attempts/migration.sql",
    import.meta.url,
  ),
);

describe("conversation turn attempts migration", () => {
  it("adds bounded native-attempt storage and backfills existing turns without destructive changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "conversation_turn_attempts"');
    expect(migration).toContain('CHECK ("attempt_no" IN (1, 2))');
    expect(migration).toContain("'primary',");
    expect(migration).toContain('FROM "conversation_turns"');
    expect(migration).toContain(
      'CONSTRAINT "conversation_turn_attempts_turn_attempt_key" UNIQUE ("turn_id", "attempt_no")',
    );
    expect(migration).toContain(
      'CONSTRAINT "conversation_turn_attempts_codex_turn_id_key" UNIQUE ("codex_turn_id")',
    );
    expect(migration).not.toContain('ALTER TABLE "conversation_turns"');
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
