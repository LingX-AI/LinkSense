import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260803160000_add_marketplace_install_count/migration.sql",
    import.meta.url,
  ),
);

describe("marketplace install count migration", () => {
  it("adds a cumulative counter and backfills current installations without destructive changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'ADD COLUMN "install_count" INTEGER NOT NULL DEFAULT 0',
    );
    expect(migration).toContain('UPDATE "marketplace_listings"');
    expect(migration).toContain('FROM "capabilities"');
    expect(migration).toContain(
      'CONSTRAINT "marketplace_listings_install_count_check"',
    );
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
