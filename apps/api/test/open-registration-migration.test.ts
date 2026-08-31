import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

const migrationUrl = new URL(
  "../../../prisma/migrations/20260831120000_add_open_registration/migration.sql",
  import.meta.url,
)

describe("open registration migration", () => {
  it("adds a separate one-time-token table without destructive or foreign-key changes", async () => {
    const sql = await readFile(migrationUrl, "utf8")

    expect(sql).toContain('CREATE TABLE "registration_tokens"')
    expect(sql).toContain('"email" CITEXT NOT NULL')
    expect(sql).toContain('"token_hash" TEXT NOT NULL')
    expect(sql).toContain('"expires_at" TIMESTAMPTZ(6) NOT NULL')
    expect(sql).toContain('"consumed_at" TIMESTAMPTZ(6)')
    expect(sql).toContain('CREATE UNIQUE INDEX "registration_tokens_token_hash_key"')
    expect(sql).toContain("CHECK (\"locale\" IN ('zh-CN', 'en-US'))")
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|ALTER\s+COLUMN)\b/iu)
    expect(sql).not.toMatch(/\b(?:FOREIGN\s+KEY|REFERENCES)\b/iu)
  })
})
