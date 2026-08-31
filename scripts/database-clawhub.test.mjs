import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolve } from "node:path";

const migrationPath = resolve(
  "prisma/migrations/20260807150000_add_clawhub_skill_repository/migration.sql",
);
const stagingMigrationPath = resolve(
  "prisma/migrations/20260807160000_add_clawhub_sync_staging/migration.sql",
);
const installBlockMigrationPath = resolve(
  "prisma/migrations/20260807170000_add_clawhub_install_block_reason/migration.sql",
);
const starSortMigrationPath = resolve(
  "prisma/migrations/20260808142000_add_clawhub_star_sort_index/migration.sql",
);

test("ClawHub repository migration is additive and keeps publisher-qualified identity", async () => {
  const migration = await readFile(migrationPath, "utf8");

  for (const table of [
    "clawhub_sync_runs",
    "clawhub_skills",
    "clawhub_skill_installations",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"));
  }
  assert.match(
    migration,
    /CHECK \("source_type" IN \('local', 'url', 'marketplace', 'clawhub'\)\)/u,
  );
  assert.match(migration, /UNIQUE \("owner_handle", "slug"\)/u);
  assert.match(migration, /"source_metadata_json" JSONB NOT NULL/u);
  assert.match(migration, /"source_security_has_warnings" BOOLEAN NOT NULL/u);
  assert.match(migration, /clawhub_skills_search_text_trgm_idx/u);
  assert.doesNotMatch(
    migration,
    /DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN/u,
  );
  assert.doesNotMatch(migration, /FOREIGN KEY|REFERENCES/u);
});

test("ClawHub staging migration is additive and run-scoped", async () => {
  const migration = await readFile(stagingMigrationPath, "utf8");

  assert.match(
    migration,
    /CREATE TABLE "clawhub_skill_sync_staging"/u,
  );
  assert.match(
    migration,
    /PRIMARY KEY \("run_id", "owner_handle", "slug"\)/u,
  );
  assert.match(migration, /"source_metadata_json" JSONB NOT NULL/u);
  assert.match(migration, /"seen_at" TIMESTAMPTZ\(6\) NOT NULL/u);
  assert.match(
    migration,
    /CHECK \("security_status" IN \('clean', 'suspicious', 'malicious', 'unverified'\)\)/u,
  );
  assert.doesNotMatch(
    migration,
    /DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN|ALTER TABLE/u,
  );
  assert.doesNotMatch(migration, /FOREIGN KEY|REFERENCES/u);
});

test("ClawHub install-block migration adds constrained metadata to live and staging catalogs", async () => {
  const migration = await readFile(installBlockMigrationPath, "utf8");

  assert.match(migration, /ALTER TABLE "clawhub_skills"/u);
  assert.match(migration, /ALTER TABLE "clawhub_skill_sync_staging"/u);
  assert.equal(
    migration.match(/ADD COLUMN "install_block_reason" VARCHAR\(32\)/gu)
      ?.length,
    2,
  );
  for (const reason of [
    "files_unavailable",
    "manifest_too_large",
    "manifest_unsafe",
    "metadata_unavailable",
  ]) {
    assert.match(migration, new RegExp(`'${reason}'`, "u"));
  }
  assert.doesNotMatch(
    migration,
    /DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN/u,
  );
  assert.doesNotMatch(migration, /FOREIGN KEY|REFERENCES/u);
});

test("ClawHub star-sort migration adds only the catalog ordering index", async () => {
  const migration = await readFile(starSortMigrationPath, "utf8");

  assert.match(
    migration,
    /CREATE INDEX "clawhub_skills_available_star_slug_idx"/u,
  );
  assert.match(
    migration,
    /ON "clawhub_skills"\("available", "star_count" DESC, "slug"\)/u,
  );
  assert.doesNotMatch(
    migration,
    /DELETE FROM|TRUNCATE TABLE|DROP TABLE|DROP COLUMN|ALTER TABLE/u,
  );
});
