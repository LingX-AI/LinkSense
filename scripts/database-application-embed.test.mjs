import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const externalSessionMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260824120000_add_external_application_session_id/migration.sql",
);
const removeResumeSessionMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260825100000_remove_application_embed_resume_session_id/migration.sql",
);

function modelBody(schema, modelName) {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u"),
  );
  assert.ok(match, `Prisma model ${modelName} must exist`);
  return match[1];
}

test("external application session id uses final clean storage fields", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const session = modelBody(schema, "ApplicationExternalSession");
  const migration = await readFile(externalSessionMigrationPath, "utf8");

  assert.doesNotMatch(session, /externalApplicationUserId/u);
  assert.match(session, /externalApplicationSessionIdEncrypted\s+String\?/u);
  assert.match(
    session,
    /externalApplicationSessionIdEncryptionKeyId\s+String\?/u,
  );
  assert.doesNotMatch(migration, /external_application_user_id/u);
  assert.match(
    migration,
    /ADD COLUMN "external_application_session_id_encrypted"/u,
  );
});

test("resume_session_id is removed in one focused forward migration", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const ticket = modelBody(schema, "ApplicationEmbedTicket");
  const migration = await readFile(removeResumeSessionMigrationPath, "utf8");

  assert.doesNotMatch(ticket, /resumeSessionId|resume_session_id/u);
  assert.match(
    migration,
    /DROP INDEX IF EXISTS "application_embed_tickets_resume_session_idx"/u,
  );
  assert.match(migration, /DROP COLUMN "resume_session_id"/u);
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:TABLE|COLUMN)\s+"(?!resume_session_id")/iu,
  );
});
