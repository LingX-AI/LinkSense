import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "../../src/db.js";
import { sha256 } from "../../src/lib/crypto.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { assertPairedDesktopDevice } from "../../src/modules/conversations/execution-target.js";
import { MemoryDesktopDeviceCoordinator } from "../desktop-devices.fixture.js";

// Owns a temporary PostgreSQL cluster; never loads the application environment.
const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "linksense-desktop-pg-"));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20261117200000_add_desktop_devices";
const data = join(root, "data");
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); reject(new Error("Missing test port")); return; }
    server.close(error => error ? reject(error) : resolve(address.port));
  });
});
const databaseUrl = (name: string) => {
  const url = new URL(`postgresql://127.0.0.1:${port}/${name}`);
  url.username = userInfo().username;
  return url.toString();
};
const connections: Array<{ $disconnect(): Promise<void> }> = [];
let started = false;
try {
  await execute("initdb", ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"], { timeout: 30_000 });
  await execute("pg_ctl", [
    "-D", data, "-l", join(root, "server.log"), "-w", "start",
    "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
  ], { timeout: 30_000 });
  started = true;
  const control = createPrismaClient(databaseUrl("postgres"));
  try {
    await control.$executeRawUnsafe("CREATE DATABASE desktop_upgrade");
    await control.$executeRawUnsafe("CREATE DATABASE desktop_fresh");
  } finally { await control.$disconnect(); }
  const migrations = join(repositoryRoot, "prisma/migrations");
  const historical = join(root, "migrations");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName) {
      await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
    }
  }
  const migrate = async (name: string, migrationsPath = migrations) => execute("pnpm", [
    "exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts",
  ], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl(name), LINKSENSE_TEST_MIGRATIONS_PATH: migrationsPath },
  });
  await migrate("desktop_upgrade", historical);
  const db = createPrismaClient(databaseUrl("desktop_upgrade"));
  connections.push(db);
  const owner = randomUUID(), other = randomUUID(), conversation = randomUUID(), thread = randomUUID();
  await db.$executeRaw`INSERT INTO users (id, email, name, role, status, updated_at)
    VALUES (${owner}::uuid, 'desktop-owner@example.test', 'Owner', 'user', 'active', now()),
           (${other}::uuid, 'desktop-other@example.test', 'Other', 'user', 'active', now())`;
  await db.$executeRaw`INSERT INTO conversations
    (id, owner_id, title, title_source, archive_status, workspace_rel_path, codex_thread_id, runtime_generation, updated_at)
    VALUES (${conversation}::uuid, ${owner}::uuid, 'Existing task', 'manual', 'active',
      ${`${owner}/home/workspaces/${conversation}`}, ${thread}, ${randomUUID()}::uuid, now())`;
  const before = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`
    SELECT to_jsonb(c) AS row FROM conversations c WHERE id = ${conversation}::uuid`;
  const checksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  await migrate("desktop_upgrade");
  const after = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`
    SELECT to_jsonb(c) AS row FROM conversations c WHERE id = ${conversation}::uuid`;
  assert.deepEqual(after[0]?.row, { ...before[0]!.row, execution_target: "cloud", desktop_device_id: null });
  assert.deepEqual(await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations
    WHERE migration_name < ${migrationName} ORDER BY migration_name`, checksums);
  const existing = await db.conversation.findUniqueOrThrow({ where: { id: conversation } });
  assert.equal(existing.codexThreadId, thread);
  assert.equal(existing.executionTarget, "cloud");
  await db.conversation.update({ where: { id: conversation }, data: { title: "Still editable" } });
  const repository = new PrismaDesktopDeviceRepository(db);
  const service = new DesktopDeviceService(repository, new MemoryDesktopDeviceCoordinator());
  const sessionEpoch = (await db.user.findUniqueOrThrow({ where: { id: owner } })).authValidAfter;
  const legacyToken = randomBytes(32).toString("hex");
  const legacyDevice = await db.desktopDevice.create({
    data: {
      ownerId: owner, tokenHash: sha256(legacyToken), authValidAfter: sessionEpoch,
      name: "Existing desktop", platform: "windows", arch: "amd64", appVersion: "0.1.0",
    },
  });
  await assert.rejects(service.rename(other, legacyDevice.id, "Foreign name"), { code: "FORBIDDEN" });
  assert.deepEqual(await service.rename(owner, legacyDevice.id, "Renamed desktop"), {
    id: legacyDevice.id, name: "Renamed desktop",
  });
  assert.equal((await service.authenticate(legacyToken))?.id, legacyDevice.id);
  assert.equal((await service.list(owner)).items.find(item => item.id === legacyDevice.id)?.name, "Renamed desktop");
  const pairing = await service.pairing(owner, sessionEpoch);
  const registration = { code: pairing.code, name: "Mac", platform: "darwin", arch: "arm64", app_version: "0.1.0" };
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => service.pair(registration)));
  const winners = attempts.filter(result => result.status === "fulfilled");
  assert.equal(winners.length, 1, "concurrent exchange must consume a code exactly once");
  const issued = winners[0]!.value;
  const stored = await db.desktopDevice.findUniqueOrThrow({ where: { id: issued.device.id } });
  assert.equal(stored.tokenHash, sha256(issued.token));
  assert.notEqual(stored.tokenHash, issued.token);
  assert.equal((await service.authenticate(issued.token))?.ownerId, owner);
  await assert.rejects(assertPairedDesktopDevice(db, other, stored.id), { code: "FORBIDDEN" });
  const localConversation = await db.$transaction(async tx => {
    await assertPairedDesktopDevice(tx, owner, stored.id);
    return tx.conversation.create({ data: {
      ownerId: owner, title: "Local task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${owner}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: stored.id,
    } });
  });
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: localConversation.id } })).executionTarget, "local");
  await assert.rejects(service.revoke(other, issued.device.id), { code: "FORBIDDEN" });
  const local = await db.localComputerSession.create({
    data: { ownerId: owner, conversationId: conversation, deviceId: stored.id, status: "active", grantScope: "session" },
  });
  const grant = await db.computerPermissionGrant.create({
    data: { ownerId: owner, conversationId: conversation, deviceId: stored.id, capability: "local_execution", scope: "session" },
  });
  await Promise.all([service.revoke(owner, stored.id), service.revoke(owner, stored.id)]);
  const revoked = await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } });
  await service.revoke(owner, stored.id);
  assert.deepEqual((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).revokedAt, revoked.revokedAt);
  await assert.rejects(service.rename(owner, stored.id, "Revoked device"), { code: "FORBIDDEN" });
  await assert.rejects(assertPairedDesktopDevice(db, owner, stored.id), { code: "FORBIDDEN" });
  assert.equal(await service.authenticate(issued.token), null);
  assert.deepEqual(await service.revokedIds([legacyDevice.id, stored.id]), new Set([stored.id]));
  assert.equal((await db.localComputerSession.findUniqueOrThrow({ where: { id: local.id } })).status, "ended");
  assert((await db.computerPermissionGrant.findUniqueOrThrow({ where: { id: grant.id } })).revokedAt);
  const audit = await db.auditLog.findMany({
    where: { targetType: "desktop_device", targetId: { in: [legacyDevice.id, stored.id] } },
    select: { action: true, actorId: true, targetId: true, result: true, metadataJson: true },
    orderBy: { action: "asc" },
  });
  assert.deepEqual(audit, [
    { action: "desktop_device_paired", actorId: owner, targetId: stored.id, result: "success", metadataJson: {} },
    { action: "desktop_device_renamed", actorId: owner, targetId: legacyDevice.id, result: "success", metadataJson: {} },
    { action: "desktop_device_revoked", actorId: owner, targetId: stored.id, result: "success", metadataJson: {} },
  ]);
  const pending = await service.pairing(owner, sessionEpoch);
  await db.user.update({ where: { id: owner }, data: { authValidAfter: new Date(Date.now() + 1000) } });
  await assert.rejects(service.pairing(owner, sessionEpoch), { code: "AUTH_SESSION_EXPIRED" });
  await assert.rejects(service.pair({ ...registration, code: pending.code }), { code: "AUTH_SESSION_EXPIRED" });
  const nextEpoch = (await db.user.findUniqueOrThrow({ where: { id: owner } })).authValidAfter;
  const renewed = await service.pair({ ...registration, code: (await service.pairing(owner, nextEpoch)).code });
  await db.user.update({ where: { id: owner }, data: { authValidAfter: new Date(Date.now() + 2000) } });
  assert.equal(await service.authenticate(renewed.token), null);
  await migrate("desktop_fresh");
  const fresh = createPrismaClient(databaseUrl("desktop_fresh"));
  connections.push(fresh);
  assert.equal(await fresh.desktopDevice.count(), 0);
  assert.equal(await fresh.conversation.count(), 0);
  console.log("Desktop PostgreSQL whitebox passed: fresh install, cloud history, existing device rename, concurrent pairing and revocation, redacted audit, ownership, and credential epoch.");
} finally {
  await Promise.all(connections.map(connection => connection.$disconnect()));
  if (started) await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 });
  await rm(root, { recursive: true, force: true });
}
