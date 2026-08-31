import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const directoryMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260730163000_add_knowledge_base_entries/migration.sql",
);
const uniquenessMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260730171000_scope_knowledge_document_uniqueness_to_directory/migration.sql",
);

test("stores knowledge-base directory entries and backfills active documents", async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(directoryMigrationPath, "utf8"),
  ]);

  assert.match(schema, /model KnowledgeBaseEntry \{/u);
  assert.match(schema, /parentEntryId\s+String\?/u);
  assert.match(schema, /documentId\s+String\?/u);
  assert.match(schema, /sourceItemId\s+String\?/u);
  assert.match(migration, /CREATE TABLE "knowledge_base_entries"/u);
  assert.match(migration, /knowledge_base_entries_root_name_key/u);
  assert.match(migration, /knowledge_base_entries_parent_name_key/u);
  assert.match(
    migration,
    /INSERT INTO "knowledge_base_entries"[\s\S]*FROM "knowledge_base_documents"[\s\S]*WHERE document\."status" <> 'deleted'/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/u);
});

test("keeps the applied directory migrations immutable", async () => {
  const [directoryMigration, uniquenessMigration] = await Promise.all([
    readFile(directoryMigrationPath),
    readFile(uniquenessMigrationPath),
  ]);

  assert.equal(
    createHash("sha256").update(directoryMigration).digest("hex"),
    "6671b006beddf8dd9e3b6ba3874ad6fdfaacf0a976a24a8d0ec451c853d3ba32",
  );
  assert.equal(
    createHash("sha256").update(uniquenessMigration).digest("hex"),
    "d99589428c8cde26a90fc25b7e19de61e05bbc75715ae741615cb418b8360c8f",
  );
});

test("relaxes only the legacy global document uniqueness indexes", async () => {
  const migration = await readFile(uniquenessMigrationPath, "utf8");

  assert.match(
    migration,
    /DROP INDEX IF EXISTS "knowledge_base_documents_active_name_key"/u,
  );
  assert.match(
    migration,
    /DROP INDEX IF EXISTS "knowledge_base_documents_active_sha_key"/u,
  );
  assert.doesNotMatch(
    migration,
    /DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN|ALTER COLUMN/u,
  );
});
