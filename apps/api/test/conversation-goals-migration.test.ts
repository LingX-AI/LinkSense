import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260806173000_add_conversation_goals/migration.sql",
    import.meta.url,
  ),
);

describe("conversation Goals migration", () => {
  it("adds Goal projection storage without deleting or rewriting historical data", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "conversation_goals"');
    expect(migration).toContain(
      'ADD COLUMN "task_kind" VARCHAR(32) NOT NULL DEFAULT \'turn\'',
    );
    expect(migration).toContain('ADD COLUMN "goal_objective" TEXT');
    expect(migration).toContain('ADD COLUMN "goal_token_budget" BIGINT');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "conversation_goals_codex_thread_id_key"',
    );
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
  });
});
