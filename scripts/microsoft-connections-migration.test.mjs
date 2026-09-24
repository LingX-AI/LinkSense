import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { connectionProviderSchema } from "../packages/shared/dist/index.js";

test("personal connections add only one table and its owner/provider index without modifying historical data", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260923090000_add_user_connections/migration.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--[^\n]*/gu, "").split(";").map(value => value.trim()).filter(Boolean);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^CREATE TABLE "user_connections"/u);
  assert.match(statements[1], /^CREATE UNIQUE INDEX "user_connections_owner_provider_key" ON "user_connections"\("owner_id", "provider"\)$/u);
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|ALTER|REFERENCES)\b/iu);
  assert.match(sql, /"owner_id" UUID NOT NULL/u);
  assert.match(sql, /"encrypted_payload" TEXT/u);
  assert.match(sql, /TIMESTAMPTZ\(6\)/u);
});

test("expanding connector providers preserves existing rows and matches the public provider contract", async () => {
  const sql = await readFile(new URL("../prisma/migrations/20260924040000_expand_user_connection_providers/migration.sql", import.meta.url), "utf8");
  const statements = sql.replace(/--[^\n]*/gu, "").split(";").map(value => value.trim()).filter(Boolean);
  assert.equal(statements.length, 3);
  assert.equal(statements[0], "BEGIN");
  assert.equal(statements[2], "COMMIT");
  assert.match(statements[1], /^ALTER TABLE "user_connections"\s+DROP CONSTRAINT "user_connections_provider_check",\s+ADD CONSTRAINT "user_connections_provider_check"\s+CHECK \("provider" IN \([^)]+\)\)$/u);
  const providers = [...statements[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
  assert.deepEqual(providers.toSorted(), connectionProviderSchema.options.toSorted());
});
