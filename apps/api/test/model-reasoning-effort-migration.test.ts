import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260725213000_expand_reasoning_effort_values/migration.sql",
    import.meta.url,
  ),
);

describe("model reasoning effort migration", () => {
  it("widens both persisted effort constraints without destructive data changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toMatch(/\bBEGIN;/u);
    expect(migration).toMatch(/\bCOMMIT;/u);
    expect(migration).toContain(
      "DROP CONSTRAINT users_preferred_reasoning_effort_check",
    );
    expect(migration).toContain(
      "DROP CONSTRAINT conversation_turn_start_intents_reasoning_effort_check",
    );
    expect(migration.match(/'max'/gu)).toHaveLength(2);
    expect(migration.match(/'ultra'/gu)).toHaveLength(2);
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/iu);
  });
});
