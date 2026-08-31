import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260727160000_add_internal_applications/migration.sql",
    import.meta.url,
  ),
);

describe("internal applications migration", () => {
  it("adds application storage and only nullable columns to existing tables", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const table of [
      "applications",
      "application_capabilities",
      "application_knowledge_bases",
      "application_grants",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('ADD COLUMN "application_id" UUID');
    expect(migration).toContain(
      'ADD COLUMN "application_name_snapshot" VARCHAR(160)',
    );
    expect(migration).toContain("conversations_application_snapshot_check");
    expect(migration).toContain(
      "conversation_turn_start_intents_application_check",
    );
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/iu);
  });

  it("stores only internal user and group grants, without public-link credentials", async () => {
    const migration = (await readFile(migrationPath, "utf8")).toLowerCase();

    expect(migration).toContain("'user_group'");
    expect(migration).toContain("'user'");
    expect(migration).not.toMatch(
      /\b(?:public_token|share_token|anonymous|external_link|access_password)\b/u,
    );
  });
});
