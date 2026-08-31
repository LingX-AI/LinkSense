import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

const migrationUrl = new URL(
  "../../../prisma/migrations/20260831150000_add_user_total_token_limit/migration.sql",
  import.meta.url,
)

describe("user total token limit migration", () => {
  it("adds an optional positive lifetime limit without changing historical data", async () => {
    const sql = await readFile(migrationUrl, "utf8")

    expect(sql).toContain('ADD COLUMN "total_token_limit" BIGINT')
    expect(sql).toContain('"total_token_limit" IS NULL')
    expect(sql).toContain('"total_token_limit" > 0')
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/iu)
    expect(sql).not.toMatch(/\bFOREIGN\s+KEY\b/iu)
  })
})
