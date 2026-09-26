import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { resolve } from "node:path"

const schemaPath = resolve("prisma/schema.prisma")
const migrationPath = resolve(
  "prisma/migrations/20260727120000_add_usage_analytics/migration.sql"
)
const costMigrationPath = resolve(
  "prisma/migrations/20260728150000_add_model_usage_costs/migration.sql"
)
const activityMigrationPath = resolve(
  "prisma/migrations/20260730190000_add_usage_activity_records/migration.sql"
)
const memoryGenerationMigrationPath = resolve(
  "prisma/migrations/20260731120000_add_memory_generation_usage/migration.sql"
)
const taskTitleGenerationMigrationPath = resolve(
  "prisma/migrations/20260804130000_add_task_title_generation_usage/migration.sql"
)

test("usage analytics schema stores an immutable start marker, cursors, and token facts", async () => {
  const schema = await readFile(schemaPath, "utf8")

  assert.match(schema, /model UsageAnalyticsState \{/u)
  assert.match(schema, /tokenMeasurementStartedAt DateTime/u)
  assert.match(schema, /model CodexThreadTokenUsageCursor \{/u)
  assert.match(schema, /codexThreadId\s+String\s+@id/u)
  assert.match(schema, /model TokenUsageRecord \{/u)
  assert.match(schema, /snapshotKey\s+String\s+@unique/u)
  assert.match(schema, /totalCostPicoUsd\s+BigInt/u)
  assert.match(schema, /unpricedTokens\s+BigInt/u)
  assert.match(schema, /model ModelUsageRecord \{/u)
  assert.match(schema, /requestId\s+String\s+@unique/u)
  assert.match(schema, /model_usage_records_workload_observed_idx/u)
  assert.match(schema, /token_usage_records_observed_idx/u)
  assert.match(schema, /conversations_created_at_idx/u)
  assert.match(schema, /conversation_turns_started_at_idx/u)
  assert.match(schema, /model UsageActivityRecord \{/u)
  assert.match(schema, /usage_activity_records_type_source_key/u)
  assert.match(schema, /usage_activity_records_type_occurred_idx/u)
})

test("usage analytics migration is additive and constrains deduplicated token counts", async () => {
  const migration = await readFile(migrationPath, "utf8")
  const executableMigration = migration.replace(/^--.*$/gmu, "")

  for (const table of [
    "usage_analytics_state",
    "codex_thread_token_usage_cursors",
    "token_usage_records",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"))
  }
  assert.doesNotMatch(
    executableMigration,
    /\b(?:DROP|TRUNCATE|DELETE)\b/iu
  )
  assert.doesNotMatch(
    executableMigration,
    /\b(?:FOREIGN KEY|REFERENCES)\b/iu
  )
  assert.match(migration, /token_usage_records_snapshot_key_key/u)
  assert.match(migration, /cached_input_tokens" <= "input_tokens/u)
  assert.match(migration, /reasoning_output_tokens" <= "output_tokens/u)
  assert.match(migration, /token_usage_records_observed_idx/u)
})

test("model usage and immutable cost snapshots are added without deleting history", async () => {
  const migration = await readFile(costMigrationPath, "utf8")
  const executableMigration = migration.replace(/^--.*$/gmu, "")

  assert.match(migration, /CREATE TABLE "model_usage_records"/u)
  assert.match(migration, /model_usage_records_request_id_key/u)
  assert.match(migration, /measurement_method.*provider.*estimated/su)
  assert.match(migration, /input_price_micros_per_million/u)
  assert.match(migration, /cached_input_price_micros_per_million/u)
  assert.match(migration, /output_price_micros_per_million/u)
  assert.match(migration, /total_cost_pico_cny/u)
  assert.match(migration, /SET "unpriced_tokens" = "total_tokens"/u)
  assert.match(
    migration,
    /"total_cost_pico_cny" =\s*"input_cost_pico_cny" \+ "cached_input_cost_pico_cny" \+ "output_cost_pico_cny"/u
  )
  assert.doesNotMatch(executableMigration, /\b(?:DROP|TRUNCATE|DELETE)\b/iu)
  assert.doesNotMatch(executableMigration, /\b(?:FOREIGN KEY|REFERENCES)\b/iu)
})

test("task and turn activity facts survive operational task deletion", async () => {
  const migration = await readFile(activityMigrationPath, "utf8")
  const executableMigration = migration.replace(/^--.*$/gmu, "")

  assert.match(migration, /CREATE TABLE "usage_activity_records"/u)
  assert.match(migration, /usage_activity_records_type_source_key/u)
  assert.match(migration, /activity_type" = 'task_created'/u)
  assert.match(migration, /activity_type" = 'turn_started'/u)
  assert.match(
    migration,
    /INSERT INTO "usage_activity_records"[\s\S]*FROM "conversations"/u
  )
  assert.match(
    migration,
    /INSERT INTO "usage_activity_records"[\s\S]*FROM "conversation_turns"/u
  )
  assert.doesNotMatch(executableMigration, /\b(?:DROP|TRUNCATE|DELETE)\b/iu)
  assert.doesNotMatch(executableMigration, /\b(?:FOREIGN KEY|REFERENCES)\b/iu)
})

test("memory generation widens model usage constraints without deleting history", async () => {
  const migration = await readFile(memoryGenerationMigrationPath, "utf8")
  const executableMigration = migration.replace(/^--.*$/gmu, "")

  assert.match(migration, /'memory_generation'/u)
  assert.match(migration, /'generation'/u)
  assert.match(
    migration,
    /"workload" = 'memory_generation' AND "model_kind" = 'generation'/u
  )
  assert.doesNotMatch(
    executableMigration,
    /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE)\b/iu
  )
  assert.doesNotMatch(
    executableMigration,
    /\b(?:FOREIGN KEY|REFERENCES)\b/iu
  )
})

test("task auto naming widens generation usage constraints without deleting history", async () => {
  const migration = await readFile(taskTitleGenerationMigrationPath, "utf8")
  const executableMigration = migration.replace(/^--.*$/gmu, "")

  assert.match(migration, /model_usage_records_workload_check/u)
  assert.match(migration, /model_usage_records_model_kind_check/u)
  assert.match(migration, /'task_title_generation'/u)
  assert.match(
    migration,
    /"workload" IN \('memory_generation', 'task_title_generation'\) AND "model_kind" = 'generation'/u
  )
  assert.doesNotMatch(
    executableMigration,
    /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE)\b/iu
  )
  assert.doesNotMatch(executableMigration, /\b(?:FOREIGN KEY|REFERENCES)\b/iu)
})
