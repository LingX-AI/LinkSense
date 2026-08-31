import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260728095000_add_application_dependency_snapshots/migration.sql",
    import.meta.url,
  ),
);

describe("application dependency snapshots migration", () => {
  it("safely adds and backfills every dependency snapshot", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "capability_name_snapshot" VARCHAR(160)',
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "capability_type_snapshot" VARCHAR(32)',
    );
    expect(migration).toContain(
      'ADD COLUMN IF NOT EXISTS "knowledge_base_name_snapshot" VARCHAR(160)',
    );
    expect(migration).toContain('FROM "capabilities" AS "capability"');
    expect(migration).toContain(
      'FROM "knowledge_bases" AS "knowledge_base"',
    );
    expect(migration).toContain(
      'ALTER COLUMN "capability_name_snapshot" SET NOT NULL',
    );
    expect(migration).toContain(
      'ALTER COLUMN "capability_type_snapshot" SET NOT NULL',
    );
    expect(migration).toContain(
      'ALTER COLUMN "knowledge_base_name_snapshot" SET NOT NULL',
    );
  });

  it("fails instead of leaving dirty snapshots and keeps the migration additive", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("IF EXISTS");
    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain("IF NOT EXISTS");
    expect(migration).toContain("application_capabilities_type_check");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
  });

  it("backfills before making snapshot columns required", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const capabilityBackfill = migration.indexOf(
      'UPDATE "application_capabilities"',
    );
    const knowledgeBaseBackfill = migration.indexOf(
      'UPDATE "application_knowledge_bases"',
    );
    const firstRequiredConstraint = migration.indexOf("SET NOT NULL");

    expect(capabilityBackfill).toBeGreaterThan(-1);
    expect(knowledgeBaseBackfill).toBeGreaterThan(-1);
    expect(firstRequiredConstraint).toBeGreaterThan(capabilityBackfill);
    expect(firstRequiredConstraint).toBeGreaterThan(knowledgeBaseBackfill);
  });
});
