import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "../../src/db.js";
import type { Prisma } from "../../src/generated/prisma/client.js";

// Disposable databases only: both upgrade paths must work with real CHECKs.
// Never load the application's .env or alter an existing database.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20260918230000_separate_development_turn_instructions";
const root = await mkdtemp(join(tmpdir(), "linksense-development-instructions-"));
const container = `linksense-development-instructions-${randomUUID()}`;
const migrations = join(repositoryRoot, "prisma/migrations");
const historical = join(root, "migrations");
const password = randomUUID();
const applicationConstraint = "conversation_turn_start_intents_application_check";
const developmentConstraint = "conversation_turn_start_intents_development_instructions_check";
let created = false;
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();

async function migrate(url: string, path: string): Promise<void> {
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: url, LINKSENSE_TEST_MIGRATIONS_PATH: path },
  });
}

type Database = ReturnType<typeof createPrismaClient>;
type Snapshot = Array<{ row: Prisma.JsonObject }>;
async function snapshot(db: Database): Promise<Snapshot> {
  return db.$queryRaw`SELECT to_jsonb(t) AS row FROM conversation_turn_start_intents t ORDER BY projection_turn_id`;
}

async function insertHistorical(db: Database, application: boolean, instructions: string | null): Promise<string> {
  const id = randomUUID();
  await db.$executeRaw`
    INSERT INTO conversation_turn_start_intents
      (projection_turn_id, owner_id, conversation_id, runtime_generation, capability_generation,
       input_text, submit_mode, application_id, application_updated_at, application_instructions)
    VALUES (${id}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid,
      ${"a".repeat(64)}, 'Keep the original user request', 'normal',
      ${application ? randomUUID() : null}::uuid,
      ${application ? new Date("2026-09-01T00:00:00.000Z") : null}, ${instructions})`;
  return id;
}

async function verifyCurrentWrites(db: Database): Promise<void> {
  const data = () => ({
    projectionTurnId: randomUUID(), ownerId: randomUUID(), conversationId: randomUUID(),
    runtimeGeneration: randomUUID(), capabilityGeneration: "b".repeat(64),
    inputText: "Improve the interface", submitMode: "normal",
  });
  const ordinary = await db.conversationTurnStartIntent.create({ data: data() });
  assert.equal(ordinary.applicationInstructions, null);
  assert.equal(ordinary.developmentInstructions, null);
  const development = await db.conversationTurnStartIntent.create({ data: {
    ...data(), developmentInstructions: "Edit the existing application project.",
  } });
  assert.equal(development.applicationId, null);
  assert.equal(development.applicationUpdatedAt, null);
  assert.equal(development.applicationInstructions, null);
  assert.equal(development.developmentInstructions, "Edit the existing application project.");
  const application = {
    applicationId: randomUUID(), applicationUpdatedAt: new Date(), applicationInstructions: "Published instructions",
  };
  const installed = await db.conversationTurnStartIntent.create({ data: { ...data(), ...application } });
  assert.equal(installed.developmentInstructions, null);
  for (const invalid of [{ applicationInstructions: "Unbound instructions" }, { applicationId: randomUUID() }]) {
    await assert.rejects(db.conversationTurnStartIntent.create({ data: { ...data(), ...invalid } }), new RegExp(applicationConstraint));
  }
  for (const invalid of [
    { ...application, developmentInstructions: "Mixed contexts" },
    { developmentInstructions: "" },
    { developmentInstructions: "x".repeat(20_001) },
  ]) {
    await assert.rejects(db.conversationTurnStartIntent.create({ data: { ...data(), ...invalid } }), new RegExp(developmentConstraint));
  }
}

try {
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName) {
      await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
    }
  }
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "--detach", "--name", container, "--publish", "127.0.0.1::5432", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  created = true;
  const port = Number((await docker("port", container, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  for (const mode of ["production_upgrade", "drifted_upgrade", "fresh_install"] as const) {
    await docker("exec", container, "createdb", "-U", "postgres", mode);
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/${mode}`;
    const db = createPrismaClient(url);
    try {
      if (mode !== "fresh_install") {
        await migrate(url, historical);
        await insertHistorical(db, false, null);
        await insertHistorical(db, true, "Keep installed application instructions");
        const originalConstraint = await db.$queryRaw<Array<{ definition: string }>>`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='conversation_turn_start_intents'::regclass AND conname=${applicationConstraint}`;
        assert.equal(originalConstraint.length, 1);
        // This is the exact shape rejected by 113 before the fix.
        await assert.rejects(insertHistorical(db, false, "Development instructions"), new RegExp(applicationConstraint));
        let legacyId: string | null = null;
        if (mode === "drifted_upgrade") {
          await db.$executeRaw`ALTER TABLE conversation_turn_start_intents DROP CONSTRAINT conversation_turn_start_intents_application_check`;
          legacyId = await insertHistorical(db, false, "Preserve accepted development instructions");
        }
        const before = await snapshot(db);
        const checksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
        await migrate(url, migrations);
        const after = await snapshot(db);
        assert.deepEqual(after.map(({ row }) => {
          const { development_instructions: development, ...previous } = row;
          if (previous.projection_turn_id === legacyId) {
            assert.equal(previous.application_instructions, null);
            assert.equal(development, "Preserve accepted development instructions");
            previous.application_instructions = development;
          } else assert.equal(development, null);
          return { row: previous };
        }), before);
        assert.deepEqual(await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`, checksums);
        assert.deepEqual(await db.$queryRaw`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='conversation_turn_start_intents'::regclass AND conname=${applicationConstraint}`, originalConstraint);
      } else await migrate(url, migrations);
      await verifyCurrentWrites(db);
      const beforeRepeat = await snapshot(db);
      await migrate(url, migrations);
      assert.deepEqual(await snapshot(db), beforeRepeat);
      console.log(`PASS ${mode}: ordinary/application/development requests, constraints, retained records and repeat deployment.`);
    } finally { await db.$disconnect(); }
  }
} finally {
  try { if (created) await docker("rm", "--force", "--volumes", container); }
  finally { await rm(root, { recursive: true, force: true }); }
}
