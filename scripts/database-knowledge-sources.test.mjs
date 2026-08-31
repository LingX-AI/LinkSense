import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260727190000_add_knowledge_sources/migration.sql",
);
const leaseMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260727191000_add_knowledge_source_sync_lease/migration.sql",
);
const scheduleMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812120000_replace_knowledge_source_sync_schedule/migration.sql",
);
const progressMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812130000_add_knowledge_source_sync_progress/migration.sql",
);
const singleWeekdayMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260812140000_replace_knowledge_source_weekdays_with_weekday/migration.sql",
);

test("keeps the already-published knowledge-source migration immutable", async () => {
  const migration = await readFile(originalMigrationPath);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "58f3af47daf477ca2777160440c207c97c81c091a156d4d8a42216937f35bc61",
  );
});

test("adds synchronization leases and the document mapping constraint in a forward migration", async () => {
  const migration = await readFile(leaseMigrationPath, "utf8");

  assert.match(
    migration,
    /ADD COLUMN "sync_lease_expires_at" TIMESTAMPTZ\(6\)/u,
  );
  assert.match(
    migration,
    /CREATE INDEX "knowledge_base_sources_sync_lease_idx"/u,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "knowledge_source_items_document_id_key"[\s\S]*WHERE "document_id" IS NOT NULL/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/u);
});

test("replaces legacy minute intervals with constrained calendar schedules", async () => {
  const migration = await readFile(scheduleMigrationPath);

  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "9ae4c70446bdd56852514ef0d2f1b33d7fe256a75b21a1dfec88310e28ab1737",
  );
  const sql = migration.toString("utf8");
  assert.match(sql, /DROP COLUMN "sync_interval_minutes"/u);
  assert.match(sql, /ADD COLUMN "sync_frequency" VARCHAR\(16\)/u);
  assert.match(
    sql,
    /ADD COLUMN "sync_time_of_day_minutes" INTEGER/u,
  );
  assert.match(sql, /ADD COLUMN "sync_time_zone" VARCHAR\(120\)/u);
  assert.match(sql, /ADD COLUMN "sync_weekdays" INTEGER\[\]/u);
  assert.match(sql, /ADD COLUMN "sync_day_of_month" INTEGER/u);
  assert.match(
    sql,
    /CONSTRAINT "knowledge_base_sources_sync_schedule_shape_check"/u,
  );
  assert.match(sql, /array_positions\("sync_weekdays", 7\)/u);
  assert.match(sql, /'daily', 'weekly', 'monthly'/u);
  assert.match(sql, /every day at 09:00 Asia\/Shanghai/u);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/u);
});

test("replaces the published multi-weekday field in a forward migration", async () => {
  const migration = await readFile(singleWeekdayMigrationPath, "utf8");

  assert.match(migration, /ADD COLUMN "sync_weekday" INTEGER/u);
  assert.match(
    migration,
    /WHEN "sync_frequency" = 'weekly' THEN "sync_weekdays"\[1\]/u,
  );
  assert.match(migration, /DROP COLUMN "sync_weekdays"/u);
  assert.match(
    migration,
    /CONSTRAINT "knowledge_base_sources_sync_weekday_check"/u,
  );
  assert.match(
    migration,
    /CONSTRAINT "knowledge_base_sources_sync_schedule_shape_check"/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/u);
});

test("adds resumable SharePoint synchronization checkpoints without deleting source data", async () => {
  const migration = await readFile(progressMigrationPath, "utf8");

  assert.match(migration, /ADD COLUMN "scan_cursor" TEXT/u);
  assert.match(migration, /ADD COLUMN "scan_delta_link" TEXT/u);
  assert.match(migration, /ADD COLUMN "last_sync_run_id" UUID/u);
  assert.match(migration, /ADD COLUMN "processed_count" INTEGER/u);
  assert.match(migration, /'initial', 'scheduled', 'manual', 'retry'/u);
  assert.match(
    migration,
    /CONSTRAINT "knowledge_source_items_sync_shape_check"/u,
  );
  assert.match(
    migration,
    /CONSTRAINT "knowledge_source_sync_runs_terminal_shape_check"/u,
  );
  assert.match(
    migration,
    /"processed_count" = \([\s\S]*"retried_count"[\s\S]*"failed_count"/u,
  );
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE TABLE|DROP TABLE/u);
});
