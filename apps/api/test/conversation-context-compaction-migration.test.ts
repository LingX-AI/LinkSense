import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260815213000_support_manual_context_compaction/migration.sql",
    import.meta.url,
  ),
);

describe("manual context compaction migration", () => {
  it("admits one compact native attempt without rewriting existing data", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_kind_check"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_identity_check"',
    );
    expect(migration).toContain("'compact'");
    expect(migration).toMatch(
      /"kind" = 'compact'[\s\S]*?"attempt_no" = 1[\s\S]*?"source_codex_turn_id" IS NULL[\s\S]*?"codex_turn_id" IS NOT NULL/u,
    );
    expect(migration).not.toMatch(
      /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE|UPDATE|INSERT)\b/iu,
    );
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
