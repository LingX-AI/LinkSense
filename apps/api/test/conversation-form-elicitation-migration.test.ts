import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260814150000_add_conversation_form_elicitation/migration.sql",
    import.meta.url,
  ),
);

describe("conversation form elicitation migration", () => {
  it("extends the existing durable request table with a discriminated form shape", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const column of [
      "request_kind",
      "server_name",
      "message_text",
      "form_schema_json",
      "form_ui_hints_json",
      "resolved_action",
    ]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain(
      "ADD CONSTRAINT \"conversation_user_input_requests_form_shape_check\"",
    );
    expect(migration).toContain(
      "ADD CONSTRAINT \"conversation_user_input_requests_resolved_action_check\"",
    );
  });

  it("is additive and keeps the project no-foreign-key contract", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(migration).not.toMatch(/\bFOREIGN\s+KEY\b/iu);
    expect(migration).not.toMatch(/\bREFERENCES\b/iu);
  });
});
