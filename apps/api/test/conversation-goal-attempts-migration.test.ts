import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260806190000_support_goal_turn_attempts/migration.sql",
    import.meta.url,
  ),
);

describe("conversation Goal attempts migration", () => {
  it("replaces the bounded turn checks with Goal-aware attempt identities without changing data", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_attempt_no_check"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_kind_check"',
    );
    expect(migration).toContain(
      'DROP CONSTRAINT IF EXISTS "conversation_turn_attempts_identity_check"',
    );
    expect(migration).toContain('"attempt_no" > 0');
    expect(migration).toContain("'goal_primary'");
    expect(migration).toContain("'goal_continuation'");
    expect(migration).toMatch(
      /"kind" = 'goal_primary'[\s\S]*?"attempt_no" = 1[\s\S]*?"source_codex_turn_id" IS NULL/,
    );
    expect(migration).toMatch(
      /"kind" = 'goal_continuation'[\s\S]*?"attempt_no" > 1[\s\S]*?"source_codex_turn_id" IS NOT NULL/,
    );
    expect(migration).not.toMatch(
      /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE)\b/iu,
    );
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
