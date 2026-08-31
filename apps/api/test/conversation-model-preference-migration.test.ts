import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260726210000_scope_model_preference_by_conversation/migration.sql",
    import.meta.url,
  ),
);

describe("conversation model preference migration", () => {
  it("adds nullable task preference and turn effort snapshots without destructive data changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toMatch(
      /ALTER TABLE conversations\s+ADD COLUMN preferred_model varchar\(240\)/u,
    );
    expect(migration).toMatch(
      /ALTER TABLE conversation_turns\s+ADD COLUMN reasoning_effort varchar\(32\)/u,
    );
    expect(migration).toContain(
      "ADD CONSTRAINT conversation_turns_reasoning_effort_check",
    );
    expect(migration).not.toMatch(
      /\b(?:NOT\s+NULL|DELETE|TRUNCATE|DROP\s+(?:COLUMN|TABLE))\b/iu,
    );
  });
});
