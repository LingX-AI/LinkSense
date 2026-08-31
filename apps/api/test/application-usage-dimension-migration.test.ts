import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260826190000_add_application_usage_dimension/migration.sql",
  import.meta.url,
);

describe("application usage dimension migration", () => {
  it("adds paired application snapshots and safely backfills existing facts", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    for (const table of [
      "usage_activity_records",
      "token_usage_records",
      "model_usage_records",
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}"`);
      expect(sql).toContain(`UPDATE "${table}" AS "usage"`);
    }
    expect(sql).toContain('ADD COLUMN "application_id" UUID');
    expect(sql).toContain(
      'ADD COLUMN "application_name_snapshot" VARCHAR(160)',
    );
    expect(sql).toContain(
      '"application_id" IS NULL AND "application_name_snapshot" IS NULL',
    );
    expect(sql).toContain(
      '"application_id" IS NOT NULL AND "application_name_snapshot" IS NOT NULL',
    );
    expect(sql).not.toMatch(
      /\b(?:DELETE|TRUNCATE|DROP\s+(?:TABLE|COLUMN))\b/iu,
    );
  });
});
