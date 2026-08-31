import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const migrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260724120000_replace_conversation_runtime_layout/migration.sql",
);

function modelBody(schema, modelName) {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u"),
  );
  assert.ok(match, `Prisma model ${modelName} must exist`);
  return match[1];
}

test("Prisma schema stores one workspace path and persists the turn capability generation", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const conversation = modelBody(schema, "Conversation");
  const startIntent = modelBody(schema, "ConversationTurnStartIntent");

  assert.doesNotMatch(conversation, /codexHomeRelPath|codex_home_rel_path/u);
  assert.match(
    startIntent,
    /capabilityGeneration\s+String\s+@map\("capability_generation"\)\s+@db\.VarChar\(64\)/u,
  );
});

test("runtime-layout migration clears incompatible conversation and capability graphs before replacing legacy columns", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const truncateMatch = migration.match(/TRUNCATE TABLE([\s\S]*?);/u);
  assert.ok(truncateMatch, "migration must clear incompatible historical data");

  const truncatedTables = [
    ...truncateMatch[1].matchAll(/"([^"]+)"/gu),
  ].map((match) => match[1]);
  assert.deepEqual(new Set(truncatedTables), new Set([
    "conversation_message_knowledge_citation_anchors",
    "conversation_message_knowledge_citations",
    "conversation_turn_knowledge_bases",
    "conversation_turn_start_intents",
    "conversation_drafts",
    "pending_requests",
    "conversation_messages",
    "conversation_events",
    "conversation_files",
    "conversation_turns",
    "retained_artifacts",
    "runtime_cleanup_outbox",
    "conversations",
    "capability_share_requests",
    "capability_user_preferences",
    "capability_grants",
    "credential_bindings",
    "capabilities",
  ]));

  const truncateAt = migration.indexOf("TRUNCATE TABLE");
  const dropIndexAt = migration.indexOf(
    'DROP INDEX "conversations_codex_home_rel_path_key"',
  );
  const dropColumnAt = migration.indexOf('DROP COLUMN "codex_home_rel_path"');
  const addGenerationAt = migration.indexOf(
    'ADD COLUMN "capability_generation" VARCHAR(64) NOT NULL',
  );

  assert.ok(truncateAt >= 0 && truncateAt < dropIndexAt);
  assert.ok(dropIndexAt < dropColumnAt);
  assert.ok(dropColumnAt < addGenerationAt);
  assert.match(
    migration,
    /CHECK \("capability_generation" ~ '\^\[0-9a-f\]\{64\}\$'\)/u,
  );
  assert.doesNotMatch(migration, /CREATE TABLE|RENAME TO/u);
});
