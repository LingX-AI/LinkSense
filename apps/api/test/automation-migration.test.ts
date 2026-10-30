import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260730220000_add_automations/migration.sql",
  import.meta.url,
);
const expirationMigrationUrl = new URL(
  "../../../prisma/migrations/20260809120000_add_automation_expiration/migration.sql",
  import.meta.url,
);

describe("automation migration", () => {
  it("keeps monitoring optional and retains existing scheduling constraints", async () => {
    const sql = await readFile(new URL("../../../prisma/migrations/20261023100000_add_automation_monitoring/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('ALTER TABLE "automations" ADD COLUMN "monitoring_json" JSONB');
    expect(sql).toContain('ALTER TABLE "automation_runs" ADD COLUMN "execution_context_json" JSONB');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|NOT\s+NULL|REFERENCES)\b/iu);
  });
  it("is additive, foreign-key free, and constrains every schedule shape", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "automations"');
    expect(sql).toContain('CREATE TABLE "automation_runs"');
    expect(sql).toContain('CONSTRAINT "automations_schedule_shape_check"');
    expect(sql).toContain('CONSTRAINT "automations_active_schedule_check"');
    expect(sql).toContain('CONSTRAINT "automation_runs_target_check"');
    expect(sql).toContain("\"frequency\" = 'hourly'");
    expect(sql).toContain("\"frequency\" = 'daily'");
    expect(sql).toContain("\"frequency\" = 'weekly'");
    expect(sql).toContain("\"frequency\" = 'monthly'");
    expect(sql).toContain("\"frequency\" = 'yearly'");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });

  it("adds the optional expiration timestamp without destructive changes", async () => {
    const sql = await readFile(expirationMigrationUrl, "utf8");

    expect(sql).toContain('ADD COLUMN "expires_at" TIMESTAMPTZ(6)');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
  });
});
