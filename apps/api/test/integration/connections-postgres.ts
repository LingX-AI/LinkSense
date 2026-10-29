import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { connectionProviderSchema, connectionSettingsStorage, microsoftFilesProviderSchema, type ConnectionConfiguration } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { encryptJson } from "../../src/lib/crypto.js";
import { ConnectionSettingsService } from "../../src/modules/connections/settings.js";
import { ConnectionService } from "../../src/modules/connections/service.js";
import { SocialSettingsService } from "../../src/modules/social-auth/settings.js";
import { connectionScopes, type ConnectionProtocol, type ConnectionToken } from "../../src/modules/connections/protocol.js";
import { testConfig } from "../test-config.js";
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
let migrationRuntime: string | undefined;

async function isolatedMigrationRuntime(): Promise<string> {
  if (migrationRuntime) return migrationRuntime;
  migrationRuntime = join(temporaryRoot, "migration-runtime");
  // Reproduce the migration image's ESM source layout, with local dependencies.
  for (const [source, destination] of [
    ["deploy/migration/package.json", "package.json"],
    ["prisma", "prisma"], ["prisma.config.ts", "prisma.config.ts"],
    ["apps/api/src/generated", "apps/api/src/generated"],
    ["apps/api/src/lib/crypto.ts", "apps/api/src/lib/crypto.ts"],
    ["packages/shared/src/connection-settings.ts", "packages/shared/src/connection-settings.ts"],
    ["packages/shared/src/connections.ts", "packages/shared/src/connections.ts"],
  ]) {
    assert(source && destination);
    const target = join(migrationRuntime, destination);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repositoryRoot, source), target, { recursive: true });
  }
  await symlink(join(repositoryRoot, "node_modules"), join(migrationRuntime, "node_modules"), "dir");
  return migrationRuntime;
}

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

async function verifyConnectorSettings(
  prisma: ReturnType<typeof createPrismaClient>, databaseUrl: string, historical: boolean,
): Promise<void> {
  const config = testConfig();
  const ownerId = randomUUID();
  await prisma.user.create({ data: { id: ownerId, email: `${ownerId}@example.test`, name: "Fixture", role: "user", status: "active" } });
  const repository = new PrismaConnectionRepository(prisma);
  let now = Date.now();
  const configurations = new Map<string, ConnectionConfiguration>();
  const makeToken = (provider: (typeof connectionProviderSchema.options)[number], clientId: string): ConnectionToken => {
    const common = {
      clientId, accountId: "existing-account", accessToken: "synthetic-access", refreshToken: "synthetic-refresh",
      expiresAt: now + 30_000, scopes: connectionScopes[provider],
    };
    return provider === "gmail" || provider === "google_docs" ? common : { ...common, tenantId: randomUUID() };
  };
  const oldCiphertext = encryptJson({
    google: { revision: 4, enabled: false, client_id: "old-google-app", client_secret: "old-google-secret" },
    microsoft: { revision: 4, enabled: false, client_id: "old-microsoft-app", client_secret: "old-microsoft-secret" },
  }, config.credentialMasterKey, config.credentialKeyId, "linksense:social-authentication:v1");
  if (historical) {
    await prisma.systemSetting.create({ data: { id: connectionSettingsStorage.id, settingsJson: {
      system_initialized: true, organization_display_name: "Preserved organization", social_authentication_encrypted: oldCiphertext,
    } } });
    for (const provider of connectionProviderSchema.options) {
      const clientId = provider === "google_docs" || provider === "gmail" ? "old-google-app" : "old-microsoft-app";
      await repository.mutate(ownerId, provider, async () => ({
        ...disconnectedConnection(8), status: "connected", enabled: true, accountName: "existing@example.test",
        encryptedPayload: encryptJson(makeToken(provider, clientId), config.credentialMasterKey, config.credentialKeyId, `linksense:connections:v1:account:${ownerId}:${provider}`),
        encryptionKeyId: config.credentialKeyId, connectedAt: new Date(now - 86_400_000),
      }));
    }
  }
  const originalGrants = await repository.list(ownerId);
  const initialize = async () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_CREDENTIAL_MASTER_KEY: config.credentialMasterKey,
      LINKSENSE_CREDENTIAL_KEY_ID: config.credentialKeyId, DOTENV_CONFIG_PATH: join(temporaryRoot, "no-application-env") };
    const result = await execute("pnpm", ["exec", "tsx", "prisma/initialize-connection-settings.ts"], { cwd: repositoryRoot, timeout: 30_000, env });
    await execute("pnpm", ["db:migrate:deploy"], { cwd: await isolatedMigrationRuntime(), timeout: 30_000, env });
    return result;
  };
  const initialization = await initialize();
  assert(!initialization.stdout.includes("old-google-secret"));
  assert.deepEqual(await repository.list(ownerId), originalGrants);
  const settings = new ConnectionSettingsService(prisma, config);
  const metadata = { ipAddress: null, userAgent: null };
  for (const provider of connectionProviderSchema.options) {
    if (!historical) await settings.update(provider, {
      expected_revision: 0, client_id: `${provider}-app`, client_secret: `${provider}-secret`, acknowledge_reauthorization: false,
    }, ownerId, metadata);
    const configuration = await settings.resolve(provider);
    assert(configuration);
    configurations.set(provider, configuration);
  }
  if (historical) {
    const stored = await prisma.systemSetting.findUniqueOrThrow({ where: { id: connectionSettingsStorage.id } });
    assert.equal(JSON.parse(JSON.stringify(stored.settingsJson)).social_authentication_encrypted, oldCiphertext);
    const social = new SocialSettingsService(prisma, config);
    await social.update("microsoft", { expected_revision: 4, enabled: false, client_id: "different-login-app", client_secret: "different-login-secret" }, ownerId, metadata);
    assert.equal((await settings.resolve("onedrive"))?.client_id, "old-microsoft-app");
  }
  const protocol: ConnectionProtocol = {
    start: async (provider, configuration, checks) => {
      assert.deepEqual(configuration, configurations.get(provider));
      return `https://provider.example.test/authorize?state=${checks.state}`;
    },
    complete: async (provider, configuration) => ({ token: makeToken(provider, configuration.client_id), accountName: "existing@example.test" }),
    refresh: async (provider, configuration, token) => {
      assert.deepEqual(configuration, configurations.get(provider));
      assert.equal(token.clientId, configuration.client_id);
      return { ...token, accessToken: "refreshed-access", refreshToken: "refreshed-refresh", expiresAt: now + 300_000 };
    },
  };
  const states = new Map<string, unknown>();
  const service = new ConnectionService({
    repository: {
      list: repository.list.bind(repository), get: repository.get.bind(repository), mutate: repository.mutate.bind(repository),
      authVersion: repository.authVersion.bind(repository),
      // This check starts after task authorization, tested by the route/repository suites.
      assertTurn: async () => undefined,
    },
    settings, protocol,
    states: {
      put: async (key, value) => { states.set(key, value); },
      read: async (key, schema, consume) => { const value = states.get(key); if (consume) states.delete(key); return value === undefined ? null : schema.parse(value); },
      throttle: async () => true,
    },
    graph: { execute: async () => ({ result: { kind: "page", items: [], next_cursor: null }, nextLink: null }) },
    workspace: { execute: async () => ({ result: { kind: "workspace_data", data: [], next_cursor: null }, nextLink: null }) },
    audit: { write: async () => undefined }, masterKey: config.credentialMasterKey, keyId: config.credentialKeyId, now: () => now,
  });
  const authorize = async (provider: (typeof connectionProviderSchema.options)[number]) => {
    const url = await service.start(ownerId, provider, "test-browser");
    await service.complete(provider, { state: new URL(url).searchParams.get("state") ?? "", code: "synthetic-code" }, "test-browser");
  };
  const read = async (provider: (typeof connectionProviderSchema.options)[number]) => service.execute(ownerId, randomUUID(), randomUUID(),
    provider === "onedrive" || provider === "sharepoint" ? { operation: "list_drives", provider }
      : provider === "google_docs" ? { operation: "search_documents", provider, query: "report" }
        : { operation: "search_mail", provider, query: "report" },
  );
  for (const provider of connectionProviderSchema.options) {
    if (!historical) await authorize(provider);
    assert.equal((await service.list(ownerId)).find((item) => item.provider === provider)?.status, "connected");
    await read(provider);
  }
  const beforeRotation = await repository.list(ownerId);
  await Promise.all((["google_docs", "gmail"] as const).map(async (provider) => {
    const current = configurations.get(provider);
    assert(current);
    await settings.update(provider, { expected_revision: 1, client_id: current.client_id, client_secret: `rotated-${provider}-secret`, acknowledge_reauthorization: false }, ownerId, metadata);
    configurations.set(provider, { ...current, revision: 2, client_secret: `rotated-${provider}-secret` });
  }));
  for (const provider of ["google_docs", "gmail"] as const)
    assert.deepEqual(await settings.resolve(provider), configurations.get(provider));
  const oneDrive = configurations.get("onedrive");
  assert(oneDrive);
  await settings.update("onedrive", { expected_revision: 1, client_id: oneDrive.client_id, client_secret: "rotated-secret", acknowledge_reauthorization: false }, ownerId, metadata);
  assert.deepEqual(await repository.list(ownerId), beforeRotation);
  configurations.set("onedrive", { revision: 2, client_id: oneDrive.client_id, client_secret: "rotated-secret" });
  now += 270_000;
  await read("onedrive");
  await read("google_docs");
  await read("gmail");
  await assert.rejects(settings.update("onedrive", { expected_revision: 2, client_id: "replacement-app", client_secret: "replacement-secret", acknowledge_reauthorization: false }, ownerId, metadata), { code: "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION" });
  await settings.update("onedrive", { expected_revision: 2, client_id: "replacement-app", client_secret: "replacement-secret", acknowledge_reauthorization: true }, ownerId, metadata);
  configurations.set("onedrive", { revision: 3, client_id: "replacement-app", client_secret: "replacement-secret" });
  assert.equal((await service.list(ownerId)).find((item) => item.provider === "onedrive")?.status, "reconnect_required");
  await authorize("onedrive");
  await read("onedrive");
  const beforeRepeat = await prisma.systemSetting.findUniqueOrThrow({ where: { id: connectionSettingsStorage.id } });
  await initialize();
  assert.deepEqual(await prisma.systemSetting.findUniqueOrThrow({ where: { id: connectionSettingsStorage.id } }), beforeRepeat);
  assert.equal((await service.list(ownerId)).filter((item) => item.status === "connected").length, 5);
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
  await verifyConnectorSettings(database, databaseUrl, true);
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
  await verifyConnectorSettings(database, freshUrl.href, false);
  console.log("PASS: fresh install and upgrade accept all providers; existing rows, grants and migration checksums survive; isolation and other constraints remain enforced.");
} finally {
  await database?.$disconnect();
  if (containerStarted) await docker("rm", "--force", "--volumes", containerName);
  await rm(temporaryRoot, { recursive: true, force: true });
}
