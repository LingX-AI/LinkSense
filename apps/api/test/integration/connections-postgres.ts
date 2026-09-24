import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectionProviderSchema, microsoftFilesProviderSchema } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import {
  disconnectedConnection,
  PrismaConnectionRepository,
} from "../../src/modules/connections/repository.js";

// Uses only disposable PostgreSQL databases; never loads application .env.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20260924040000_expand_user_connection_providers";
const temporaryRoot = await mkdtemp(join(tmpdir(), "linksense-connections-db-"));
const containerName = `linksense-connections-${randomUUID()}`;
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
const currentMigrations = join(repositoryRoot, "prisma/migrations");
let containerStarted = false;
let database: ReturnType<typeof createPrismaClient> | undefined;

async function migrate(databaseUrl: string, migrationsPath: string): Promise<void> {
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot,
    timeout: 120_000,
    maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: migrationsPath },
  });
}

async function verifyProviders(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const repository = new PrismaConnectionRepository(prisma);
  const ownerId = randomUUID();
  for (const provider of connectionProviderSchema.options) {
    // This is the persistence boundary used by authorization start and callback.
    const started = await repository.mutate(ownerId, provider, async () => disconnectedConnection(1));
    assert.equal(started.provider, provider);
    assert.equal(started.revision, 1);
    const connected = await repository.mutate(ownerId, provider, async () => ({
      ...disconnectedConnection(2),
      status: "connected",
      accountName: "fixture@example.test",
      encryptedPayload: "synthetic-encrypted-payload",
      encryptionKeyId: "test-key",
      connectedAt: new Date("2026-09-23T00:00:00Z"),
    }));
    assert.deepEqual(await repository.get(ownerId, provider), connected);
    assert.equal(await repository.get(randomUUID(), provider), null);
    // Reauthorization updates one record rather than creating a duplicate.
    await repository.mutate(ownerId, provider, async () => ({ ...connected, revision: 3 }));
  }
  assert.equal((await repository.list(ownerId)).length, connectionProviderSchema.options.length);
  assert.deepEqual(await repository.listAvailableProviders(ownerId), [...connectionProviderSchema.options].sort());
  for (const data of [
    { provider: "invalid-provider" },
    { provider: "onedrive", status: "invalid-status" },
    { provider: "onedrive", encryptedPayload: "missing-key-id" },
  ]) {
    await assert.rejects(prisma.userConnection.create({ data: { ownerId: randomUUID(), ...data } }));
  }
  await assert.rejects(prisma.userConnection.create({ data: { ownerId, provider: "onedrive" } }));
}

try {
  const password = randomUUID();
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "--detach", "--name", containerName,
    "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=connections_upgrade_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  containerStarted = true;
  const port = Number((await docker("port", containerName, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try {
      await docker("exec", containerName, "pg_isready", "-h", "127.0.0.1", "-U", "postgres");
      break;
    } catch (error) {
      if (attempt >= 50) throw error;
      await delay(100);
    }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/connections_upgrade_test`;
  const historicalMigrations = join(temporaryRoot, "migrations");
  for (const entry of await readdir(currentMigrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName)
      await cp(join(currentMigrations, entry.name), join(historicalMigrations, entry.name), { recursive: true });
  }
  await migrate(databaseUrl, historicalMigrations);
  database = createPrismaClient(databaseUrl);
  const ownerId = randomUUID();
  const repository = new PrismaConnectionRepository(database);
  for (const provider of microsoftFilesProviderSchema.options) {
    await repository.mutate(ownerId, provider, async () => ({
      ...disconnectedConnection(7), status: "connected", enabled: true,
      accountName: "existing@example.test", encryptedPayload: "historical-encrypted-payload",
      encryptionKeyId: "existing-key", connectedAt: new Date("2026-09-23T00:00:00Z"),
    }));
  }
  const before = await repository.list(ownerId);
  const checksums = await database.$queryRaw<Array<{ migration_name: string; checksum: string }>>`
    SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  for (const provider of ["google_docs", "gmail", "outlook"] as const)
    await assert.rejects(repository.mutate(ownerId, provider, async () => disconnectedConnection(1)), /user_connections_provider_check/u);
  console.log("Reproduced all three authorization persistence failures against the historical schema.");

  await migrate(databaseUrl, currentMigrations);
  assert.deepEqual(await repository.list(ownerId), before);
  assert.deepEqual(await database.$queryRaw`
    SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`, checksums);
  await verifyProviders(database);
  for (const row of before) {
    const provider = connectionProviderSchema.parse(row.provider);
    const updated = await repository.mutate(ownerId, provider, async () => ({ ...row, revision: row.revision + 1 }));
    assert.equal(updated.id, row.id);
    assert.equal(updated.encryptedPayload, row.encryptedPayload);
    assert.equal(updated.revision, row.revision + 1);
  }
  // Repeated deployment is idempotent and preserves all connection state.
  const after = await database.userConnection.findMany({ orderBy: { id: "asc" } });
  await migrate(databaseUrl, currentMigrations);
  assert.deepEqual(await database.userConnection.findMany({ orderBy: { id: "asc" } }), after);
  await database.$disconnect();

  await docker("exec", containerName, "createdb", "-U", "postgres", "connections_fresh_test");
  const freshUrl = new URL(databaseUrl);
  freshUrl.pathname = "/connections_fresh_test";
  await migrate(freshUrl.href, currentMigrations);
  database = createPrismaClient(freshUrl.href);
  await verifyProviders(database);
  console.log("PASS: fresh install and upgrade accept all providers; existing rows, grants and migration checksums survive; isolation and other constraints remain enforced.");
} finally {
  await database?.$disconnect();
  if (containerStarted) await docker("rm", "--force", "--volumes", containerName);
  await rm(temporaryRoot, { recursive: true, force: true });
}
