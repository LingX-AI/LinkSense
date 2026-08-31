import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260827143000_preserve_feishu_app_binding/migration.sql",
  import.meta.url,
);

describe("Feishu app binding migration", () => {
  it("retains existing app identifiers without copying credentials", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "feishu_app_bindings"');
    expect(sql).toContain('FROM "feishu_connections"');
    expect(sql).toContain('"app_id"');
    expect(sql).not.toContain('"encrypted_credentials"');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });
});
