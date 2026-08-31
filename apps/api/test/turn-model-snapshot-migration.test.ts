import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260726180000_persist_turn_model_snapshot/migration.sql",
    import.meta.url,
  ),
);

describe("turn model snapshot migration", () => {
  it("adds only a nullable model snapshot without destructive data changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toMatch(
      /ALTER TABLE conversation_turns\s+ADD COLUMN model varchar\(240\)/u,
    );
    expect(migration).not.toMatch(
      /\b(?:NOT\s+NULL|DELETE|TRUNCATE|DROP\s+(?:COLUMN|TABLE))\b/iu,
    );
  });
});
