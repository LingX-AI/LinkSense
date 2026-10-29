import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("form waiting policy migration", () => {
  it("only adds nullable metadata and a deadline index without discarding pre-change form data", async () => {
    const sql = await readFile(new URL("../../../prisma/migrations/20261027090000_form_waiting_policy/migration.sql", import.meta.url), "utf8");
    expect(sql).toContain('ADD COLUMN "form_waiting_policy_json" JSONB');
    expect(sql).toContain('ADD COLUMN "response_source" VARCHAR(24)');
    expect(sql).toContain('("request_kind", "status", "auto_resolve_at")');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE|UPDATE|NOT NULL)\b/iu);
  });
});
