import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

const migrationUrl = new URL(
  "../../../prisma/migrations/20260810130000_add_image_generation_usage/migration.sql",
  import.meta.url,
)

describe("image generation usage migration", () => {
  it("widens the usage constraints without deleting historical records", async () => {
    const sql = await readFile(migrationUrl, "utf8")

    expect(sql).toContain('DROP CONSTRAINT "model_usage_records_workload_check"')
    expect(sql).toContain('DROP CONSTRAINT "model_usage_records_model_kind_check"')
    expect(sql).toContain("'image_generation'")
    expect(sql).toContain("'image'")
    expect(sql).toContain(
      '("workload" = \'image_generation\' AND "model_kind" = \'image\')',
    )
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+(?:TABLE|COLUMN))\b/iu)
  })
})
