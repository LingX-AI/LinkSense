import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260818100000_remove_application_credential_bindings/migration.sql",
    import.meta.url,
  ),
);

describe("remove application credential bindings migration", () => {
  it("removes only the obsolete application credential table", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration.trim()).toBe(
      'DROP TABLE "application_credential_bindings";',
    );
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/iu);
    expect(migration).not.toMatch(/\bDROP\s+(?:COLUMN|INDEX)\b/iu);
  });
});
