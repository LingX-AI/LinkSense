import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260803120000_add_feedback/migration.sql",
    import.meta.url,
  ),
);

describe("feedback migration", () => {
  it("adds normalized feedback tables without destructive or foreign-key changes", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "feedbacks"');
    expect(migration).toContain('CREATE TABLE "feedback_images"');
    expect(migration).toContain("feedbacks_content_check");
    expect(migration).toContain("feedback_images_mime_type_check");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
  it("adds reply tables with constraints and leaves historical feedback untouched", async () => {
    const migration = await readFile(
      new URL(
        "../../../prisma/migrations/20260909120000_add_feedback_replies/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "feedback_replies"');
    expect(migration).toContain('CREATE TABLE "feedback_reply_images"');
    expect(migration).toContain("feedback_reply_images_size_check");
    expect(migration).toContain("feedback_reply_images_reply_order_key");
    expect(migration).not.toMatch(
      /\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/iu,
    );
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
