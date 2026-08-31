import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260809200000_add_completion_notification_feed_index/migration.sql",
  import.meta.url,
);
const schemaUrl = new URL("../../../prisma/schema.prisma", import.meta.url);

describe("completion notification feed migration", () => {
  it("adds only the composite completion cursor index declared by Prisma", async () => {
    const [sql, schema] = await Promise.all([
      readFile(migrationUrl, "utf8"),
      readFile(schemaUrl, "utf8"),
    ]);

    expect(sql).toContain(
      'CREATE INDEX "conversation_turns_submitter_status_completed_idx"',
    );
    expect(sql).toContain(
      'ON "conversation_turns"("submitted_by", "status", "completed_at", "id")',
    );
    expect(schema).toContain(
      '@@index([submittedBy, status, completedAt, id], map: "conversation_turns_submitter_status_completed_idx")',
    );
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE)\b/iu);
  });
});
