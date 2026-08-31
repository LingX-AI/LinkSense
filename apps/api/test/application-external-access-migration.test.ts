import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260813190000_add_application_external_access/migration.sql",
    import.meta.url,
  ),
);

describe("application external access migration", () => {
  it("adds the external identity, MCP, credential, ticket, session, and rotating-token boundaries", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      'ADD COLUMN "account_type" VARCHAR(32) NOT NULL DEFAULT \'member\'',
    );
    for (const table of [
      "application_mcp_servers",
      "application_credential_bindings",
      "application_external_access",
      "application_embed_tickets",
      "application_external_sessions",
      "application_external_refresh_tokens",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('"app_secret_hash" VARCHAR(64)');
    expect(migration).not.toContain('"app_secret" VARCHAR');
    expect(migration).toContain('"encrypted_value" TEXT NOT NULL');
    expect(migration).toContain('"credential_version" INTEGER NOT NULL');
    expect(migration).toContain('"rotation_request_id" UUID');
  });

  it("is additive and follows the project no-foreign-key contract", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
    expect(migration).not.toMatch(/\bREFERENCES\b/iu);
  });
});
