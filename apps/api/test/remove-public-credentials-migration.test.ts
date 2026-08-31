import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260730210000_remove_public_credentials/migration.sql",
    import.meta.url,
  ),
);

describe("remove public credentials migration", () => {
  it("deletes only legacy public credentials before removing their schema", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const bindingCleanup = migration.indexOf(
      'DELETE FROM "credential_bindings"',
    );
    const credentialCleanup = migration.indexOf(
      'DELETE FROM "credentials" WHERE "scope" = \'public\';',
    );

    expect(bindingCleanup).toBeGreaterThanOrEqual(0);
    expect(credentialCleanup).toBeGreaterThan(bindingCleanup);
    expect(migration).not.toContain('DELETE FROM "credentials";');
    expect(migration).toContain('DROP COLUMN "scope";');
    expect(migration).toContain('ALTER COLUMN "owner_id" SET NOT NULL');
    expect(migration).toContain('CREATE INDEX "credentials_owner_status_idx"');
    expect(migration).not.toContain(
      'CREATE INDEX "credentials_scope_owner_status_idx"',
    );
  });
});
