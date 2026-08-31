import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260728193000_allow_application_model_selection/migration.sql",
    import.meta.url,
  ),
);

describe("optional application model migration", () => {
  it("allows a null model pair without deleting or rewriting existing settings", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('ALTER COLUMN "model" DROP NOT NULL');
    expect(migration).toContain(
      'ALTER COLUMN "reasoning_effort" DROP NOT NULL',
    );
    expect(migration).toContain(
      'CONSTRAINT "applications_model_selection_pair_check"',
    );
    expect(migration).toContain(
      '("model" IS NULL AND "reasoning_effort" IS NULL)',
    );
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+(?:COLUMN|TABLE))\b/iu);
  });
});
