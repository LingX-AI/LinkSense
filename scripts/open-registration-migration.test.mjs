import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const migrationPath = resolve(
  "prisma/migrations/20260831170000_apply_registration_quota_to_existing_users/migration.sql",
);
const schemaPath = resolve("prisma/schema.prisma");

test("open registration quota migration identifies and synchronizes historical users", async () => {
  const [migration, schema] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(schemaPath, "utf8"),
  ]);

  assert.match(
    schema,
    /selfRegisteredAt\s+DateTime\?\s+@map\("self_registered_at"\)/u,
  );
  assert.match(migration, /ADD COLUMN "self_registered_at" TIMESTAMPTZ\(6\)/u);
  assert.match(migration, /"action" = 'user_self_registered'/u);
  assert.match(migration, /SET "self_registered_at" =/u);
  assert.match(migration, /SET\s+"total_token_limit" =/u);
  assert.match(migration, /"user"\."self_registered_at" IS NOT NULL/u);
  assert.doesNotMatch(migration, /\b(?:DELETE|DROP|TRUNCATE)\b/iu);
});
