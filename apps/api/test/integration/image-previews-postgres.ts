import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MAX_IMAGE_PREVIEW_BYTES, imagePreviewMimeTypeSchema } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { forkImageFileBinding } from "../../src/modules/conversations/image-preview-files.js";

// Never loads or migrates the application's database. Both paths own disposable databases.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20261023090000_allow_conversation_image_previews";
const root = await mkdtemp(join(tmpdir(), "linksense-image-preview-db-"));
const container = `linksense-image-previews-test-${randomUUID()}`;
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let started = false;
let database: ReturnType<typeof createPrismaClient> | undefined;

try {
  const password = randomUUID();
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "--detach", "--name", container,
    "--publish", "127.0.0.1::5432", "--env", "POSTGRES_DB=image_previews_upgrade", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  started = true;
  const port = Number((await docker("port", container, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/image_previews_upgrade`;
  const current = join(repositoryRoot, "prisma/migrations");
  const historical = join(root, "migrations");
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName)
      await cp(join(current, entry.name), join(historical, entry.name), { recursive: true });
  }
  const migrate = async (migrations: string, url = databaseUrl): Promise<void> => {
    await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
      cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
      env: { ...process.env, DATABASE_URL: url, LINKSENSE_TEST_MIGRATIONS_PATH: migrations },
    });
  };
  await migrate(historical);
  database = createPrismaClient(databaseUrl);
  const db = database;
  const conversationId = randomUUID();
  const base = {
    conversationId, filename: "fixture.png", mimeType: "image/png", sizeBytes: 12n,
    checksumSha256: "a".repeat(64), workspaceRootRelPath: "fixture/home/workspace", downloadable: false,
  };
  const oldFiles = [];
  for (const source of ["user_upload", "interactive_application_upload"]) {
    for (const status of ["staged", "pending", "bound"]) {
      oldFiles.push(await db.conversationFile.create({ data: {
        ...base, kind: "attachment", source, status, storageBackend: "workspace",
        workspaceRelativePath: `attachments/${randomUUID()}.png`,
        ...(status === "pending" ? { pendingRequestId: randomUUID() } : {}),
        ...(status === "bound" ? { turnId: randomUUID() } : {}),
      } }));
    }
  }
  for (const source of ["agent_generated", "system_generated"]) {
    oldFiles.push(await db.conversationFile.create({ data: {
      ...base, kind: "artifact", source, status: "registered", turnId: randomUUID(),
      storageBackend: "minio", minioObjectKey: `fixtures/${randomUUID()}`,
      downloadable: true, downloadCardEventId: randomUUID(),
    } }));
  }
  const preview = {
    ...base, kind: "image_preview", source: "system_generated", status: "registered", turnId: randomUUID(),
    storageBackend: "workspace", workspaceRelativePath: ".linksense/image-previews/fixture/fixture.png",
  };
  const checksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  const columns = await db.$queryRaw`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversation_files' ORDER BY ordinal_position`;
  // This reproduces the production failure which mocked Prisma unit tests cannot detect.
  await assert.rejects(db.conversationFile.create({ data: preview }), /conversation_files_kind_check/);
  await migrate(current);
  for (const file of oldFiles) assert.deepEqual(await db.conversationFile.findUnique({ where: { id: file.id } }), file);
  assert.deepEqual(await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`, checksums);
  assert.deepEqual(await db.$queryRaw`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'conversation_files' ORDER BY ordinal_position`, columns);
  for (const file of oldFiles.filter(file => file.kind === "attachment" && file.status === "staged")) {
    const bound = await db.conversationFile.update({ where: { id: file.id }, data: { status: "bound", turnId: randomUUID() } });
    assert.equal(bound.status, "bound");
  }
  const historicalImage = oldFiles.find(file => file.kind === "attachment" && file.status === "bound");
  assert(historicalImage);
  const referencingTurnId = randomUUID(), copiedTurnId = randomUUID();
  const forkedImage = await db.conversationFile.create({ data: {
    ...historicalImage, id: randomUUID(), conversationId: randomUUID(),
    ...forkImageFileBinding(historicalImage, new Map([[referencingTurnId, copiedTurnId]]), new Map([[historicalImage.id, referencingTurnId]])),
  } });
  assert.equal(forkedImage.kind, "image_preview");
  assert.equal(forkedImage.turnId, copiedTurnId);
  await verifyPreviewConstraints(db);
  await migrate(current);
  await docker("exec", container, "createdb", "-U", "postgres", "image_previews_fresh");
  const freshUrl = new URL(databaseUrl);
  freshUrl.pathname = "/image_previews_fresh";
  await migrate(current, freshUrl.toString());
  const fresh = createPrismaClient(freshUrl.toString());
  try { await verifyPreviewConstraints(fresh); } finally { await fresh.$disconnect(); }
  console.log("Image previews PostgreSQL: upgrade and fresh install passed; historical attachments/artifacts, fields and migration checksums preserved; all three raster formats accepted; invalid preview states rejected; repeated deploy harmless.");

  async function verifyPreviewConstraints(client: ReturnType<typeof createPrismaClient>): Promise<void> {
    for (const mimeType of imagePreviewMimeTypeSchema.options) {
      const file = await client.conversationFile.create({ data: { ...preview, mimeType } });
      assert.equal(file.kind, "image_preview");
      assert.equal(file.downloadable, false);
    }
    const invalid = [
      { kind: "unknown_kind" }, { status: "staged" }, { source: "agent_generated" },
      { turnId: null }, { pendingRequestId: randomUUID() }, { checksumSha256: null },
      { mimeType: null }, { mimeType: "image/svg+xml" }, { sizeBytes: 0n },
      { sizeBytes: BigInt(MAX_IMAGE_PREVIEW_BYTES + 1) }, { downloadable: true },
      { downloadCardEventId: randomUUID() },
      { storageBackend: "minio", workspaceRelativePath: null, minioObjectKey: "forbidden" },
    ];
    for (const overrides of invalid)
      await assert.rejects(client.conversationFile.create({ data: { ...preview, ...overrides } }));
  }
} finally {
  await database?.$disconnect();
  if (started) await docker("rm", "--force", "--volumes", container);
  await rm(root, { recursive: true, force: true });
}
