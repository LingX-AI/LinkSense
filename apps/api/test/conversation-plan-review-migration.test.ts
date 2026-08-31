import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260809170000_add_conversation_plan_reviews/migration.sql",
  import.meta.url,
);

describe("conversation Plan review migration", () => {
  it("adds durable review and start-intent state without destructive SQL or foreign keys", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "conversation_plan_reviews"');
    expect(sql).toContain('ADD COLUMN "plan_review_id" UUID');
    expect(sql).toContain('ADD COLUMN "plan_review_action" VARCHAR(24)');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "conversation_plan_reviews_active_key"',
    );
    expect(sql).toContain("WHERE \"status\" IN ('preparing', 'pending')");
    expect(sql).toContain(
      'CONSTRAINT "conversation_plan_reviews_state_check" CHECK',
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });
});
