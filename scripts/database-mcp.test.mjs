import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(repositoryRoot, "prisma/schema.prisma");
const migrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260729143000_add_personal_http_mcp_servers/migration.sql",
);
const stdioMigrationPath = resolve(
  repositoryRoot,
  "prisma/migrations/20260730110000_add_stdio_mcp_servers/migration.sql",
);

const emptyGeneration =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function modelBody(schema, modelName) {
  const match = schema.match(
    new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "u"),
  );
  assert.ok(match, `Prisma model ${modelName} must exist`);
  return match[1];
}

test("Prisma schema stores standalone personal MCP records and immutable turn snapshots", async () => {
  const schema = await readFile(schemaPath, "utf8");
  const server = modelBody(schema, "McpServer");
  const turn = modelBody(schema, "ConversationTurn");
  const intent = modelBody(schema, "ConversationTurnStartIntent");

  assert.match(server, /ownerId\s+String\s+@map\("owner_id"\)\s+@db\.Uuid/u);
  assert.match(server, /encryptedCredential\s+String\?/u);
  assert.match(server, /transport\s+String/u);
  assert.match(server, /command\s+String\?/u);
  assert.match(server, /argsJson\s+Json/u);
  assert.match(server, /encryptedEnvironment\s+String\?/u);
  assert.match(server, /environmentKeysJson\s+Json/u);
  assert.match(server, /insecureHttpAcknowledged\s+Boolean/u);
  assert.match(server, /@@unique\(\[ownerId, serverKey\]/u);
  assert.doesNotMatch(server, /capabilityId|pluginId|credentialId/u);

  for (const model of [turn, intent]) {
    assert.match(model, /mcpGeneration\s+String/u);
    assert.match(model, /mcpServersJson\s+Json/u);
    assert.match(model, new RegExp(emptyGeneration, "u"));
  }
  assert.match(intent, /mcpCredentialUsageReceiptsJson\s+Json/u);
});

test("STDIO MCP migration extends existing rows without deleting data", async () => {
  const migration = await readFile(stdioMigrationPath, "utf8");

  for (const column of [
    "transport",
    "command",
    "args_json",
    "encrypted_environment",
    "environment_keys_json",
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN "${column}"`, "u"));
  }
  assert.match(migration, /ALTER COLUMN "url" DROP NOT NULL/u);
  assert.match(migration, /mcp_servers_transport_check/u);
  assert.match(migration, /mcp_servers_transport_fields_check/u);
  assert.match(migration, /"transport" = 'streamable_http'/u);
  assert.match(migration, /"transport" = 'stdio'/u);
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+COLUMN\s+[^;]+\s+TYPE\s|FOREIGN\s+KEY/iu,
  );
});

test("personal MCP migration is additive and preserves existing rows", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /CREATE TABLE "mcp_servers"/u);
  assert.match(
    migration,
    /ALTER TABLE "conversation_turns"[\s\S]*ADD COLUMN "mcp_generation"[\s\S]*ADD COLUMN "mcp_servers_json"/u,
  );
  assert.match(
    migration,
    /ALTER TABLE "conversation_turn_start_intents"[\s\S]*ADD COLUMN "mcp_credential_usage_receipts_json"/u,
  );
  assert.match(migration, new RegExp(emptyGeneration, "u"));
  assert.doesNotMatch(
    migration,
    /DROP\s+(?:TABLE|COLUMN|INDEX)|TRUNCATE\s+TABLE|DELETE\s+FROM|ALTER\s+COLUMN|FOREIGN\s+KEY/iu,
  );
});
