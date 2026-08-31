import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationUrl = new URL(
  "../prisma/migrations/20260825143000_add_interactive_applications/migration.sql",
  import.meta.url,
)

test("interactive application migration is additive and keeps historical application data", async () => {
  const sql = await readFile(migrationUrl, "utf8")

  assert.match(sql, /ADD COLUMN "kind" VARCHAR\(32\) NOT NULL DEFAULT 'standard'/u)
  assert.match(sql, /CREATE TABLE "interactive_application_packages"/u)
  assert.match(sql, /CREATE TABLE "interactive_application_assets"/u)
  assert.match(sql, /CREATE TABLE "interactive_application_runtime_tickets"/u)
  assert.match(sql, /ADD COLUMN "interactive_application_package_id" UUID/u)
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/iu)
})
