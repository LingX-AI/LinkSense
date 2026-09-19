import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { INTERACTIVE_APPLICATION_FILE_SOURCE } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";

// Owns a disposable database; never reads or migrates the application's .env database.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20260918210000_allow_interactive_application_uploads";
const root = await mkdtemp(join(tmpdir(), "linksense-interactive-files-db-"));
const name = `linksense-interactive-files-test-${randomUUID()}`;
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let created = false;
let database: ReturnType<typeof createPrismaClient> | undefined;
try {
  const password = randomUUID();
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "--detach", "--name", name, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=interactive_files_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  created = true;
  const port = Number((await docker("port", name, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/interactive_files_test`;
  const migrations = join(repositoryRoot, "prisma/migrations");
  const historical = join(root, "migrations");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName) {
      await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
    }
  }
  const migrate = async (migrationsPath: string, url = databaseUrl): Promise<void> => {
    await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
      cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
      env: { ...process.env, DATABASE_URL: url, LINKSENSE_TEST_MIGRATIONS_PATH: migrationsPath },
    });
  };
  await migrate(historical);
  database = createPrismaClient(databaseUrl);
  const db = database;
  const conversationId = randomUUID();
  const existing = await db.conversationFile.create({ data: {
    conversationId, kind: "attachment", source: "user_upload", status: "staged",
    filename: "existing.txt", sizeBytes: 5n, storageBackend: "workspace",
    workspaceRelativePath: "attachments/existing.txt", workspaceRootRelPath: "test/home/workspace", downloadable: false,
  } });
  const attachmentData = { ...existing, id: randomUUID(), source: INTERACTIVE_APPLICATION_FILE_SOURCE };
  const artifacts = [];
  for (const source of ["agent_generated", "system_generated"]) {
    artifacts.push(await db.conversationFile.create({ data: {
      ...existing, id: randomUUID(), source, kind: "artifact", status: "registered", turnId: randomUUID(),
      storageBackend: "minio", workspaceRelativePath: null, minioObjectKey: `fixtures/${source}`, downloadable: true, downloadCardEventId: randomUUID(),
    } }));
  }
  const migrationChecksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  const columns = await db.$queryRaw`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversation_files' ORDER BY ordinal_position`;
  // Reproduce the pre-upgrade constraint failure before deploying the forward migration.
  await assert.rejects(db.conversationFile.create({ data: attachmentData }), /conversation_files_source_check/);
  await migrate(migrations);
  for (const file of [existing, ...artifacts]) {
    assert.deepEqual(await db.conversationFile.findUnique({ where: { id: file.id } }), file);
  }
  assert.deepEqual(await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`, migrationChecksums);
  assert.deepEqual(await db.$queryRaw`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversation_files' ORDER BY ordinal_position`, columns);
  const uploaded = await db.conversationFile.create({ data: attachmentData });
  const nativeFiles = await db.conversationFile.findMany({ where: {
    conversationId, status: "staged", source: { not: INTERACTIVE_APPLICATION_FILE_SOURCE },
  } });
  assert.deepEqual(nativeFiles.map((file) => file.id), [existing.id]);
  const applicationFiles = await db.conversationFile.findMany({ where: {
    conversationId, status: "staged", source: INTERACTIVE_APPLICATION_FILE_SOURCE, id: { in: [uploaded.id] },
  } });
  assert.deepEqual(applicationFiles.map((file) => file.id), [uploaded.id]);
  // Historical attachments remain usable: both origins can transition to a submitted turn.
  for (const file of [existing, uploaded]) {
    const bound = await db.conversationFile.update({ where: { id: file.id }, data: { status: "bound", turnId: randomUUID() } });
    assert.equal(bound.source, file.source);
    assert.equal(bound.status, "bound");
  }
  await assert.rejects(db.conversationFile.create({ data: { ...attachmentData, id: randomUUID(), source: "invalid_source" } }), /conversation_files_source_check/);
  // Repeated deployment must be harmless, and fresh installations must accept both upload origins.
  await migrate(migrations);
  await docker("exec", name, "createdb", "-U", "postgres", "interactive_files_fresh");
  const freshUrl = new URL(databaseUrl);
  freshUrl.pathname = "/interactive_files_fresh";
  await migrate(migrations, freshUrl.toString());
  const fresh = createPrismaClient(freshUrl.toString());
  try {
    for (const source of ["user_upload", INTERACTIVE_APPLICATION_FILE_SOURCE]) {
      for (const { filename, mimeType } of [{ filename: "invoice.png", mimeType: "image/png" }, { filename: "invoice.pdf", mimeType: "application/pdf" }]) {
        const file = await fresh.conversationFile.create({ data: { ...attachmentData, id: randomUUID(), source, filename, mimeType } });
        assert.equal(file.source, source);
        assert.equal(file.status, "staged");
      }
    }
    await assert.rejects(fresh.conversationFile.create({ data: { ...attachmentData, id: randomUUID(), source: "invalid_source" } }), /conversation_files_source_check/);
  } finally {
    await fresh.$disconnect();
  }
  console.log("Interactive attachment upgrade and fresh installation verified: historical files, columns and migration checksums preserved; both origins usable; selection isolated; invalid sources rejected.");
} finally {
  await database?.$disconnect();
  if (created) await docker("rm", "--force", "--volumes", name);
  await rm(root, { recursive: true, force: true });
}
