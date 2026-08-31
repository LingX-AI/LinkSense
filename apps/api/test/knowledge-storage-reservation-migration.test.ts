import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const migrationPath = resolve(
  process.cwd(),
  "../../prisma/migrations/20260722190000_add_knowledge_storage_reservation_targets/migration.sql",
)

describe("knowledge storage reservation target migration", () => {
  it("backfills existing rows fail-closed and strengthens exact-key facts", async () => {
    const migration = await readFile(migrationPath, "utf8")

    expect(migration).toMatch(/\bBEGIN;/u)
    expect(migration).toMatch(/\bCOMMIT;/u)
    expect(migration).toContain('ADD COLUMN "document_id" UUID')
    expect(migration).toContain('ADD COLUMN "document_version_id" UUID')
    expect(migration).toContain("jsonb_array_elements_text")
    expect(migration).toContain("RAISE EXCEPTION")
    expect(migration).toContain("jsonb_path_exists")
    expect(migration).toContain('ALTER COLUMN "document_id" SET NOT NULL')
    expect(migration).toContain(
      'CREATE INDEX "knowledge_base_storage_reservations_target_idx"',
    )
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/iu)
  })
})
