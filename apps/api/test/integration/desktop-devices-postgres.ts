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
import { isDesktopRunActive } from "../../src/modules/desktop-credentials/run-authority.js";
import type { DesktopRunAuthorizationPhase } from "../../src/modules/desktop-credentials/run-leases.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { assertPairedDesktopDevice } from "../../src/modules/conversations/execution-target.js";
import { MemoryDesktopDeviceCoordinator } from "../desktop-devices.fixture.js";
import { verifyDesktopExecutionProjection } from "./desktop-execution-projection.js";

// Owns a temporary PostgreSQL cluster; never loads the application environment.
const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "linksense-desktop-pg-"));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20261117200000_add_desktop_devices";
const slotReleaseMigrationName = "20261119040000_add_desktop_turn_slot_releases";
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
  const beforeSlotRelease = join(root, "before-slot-release");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name < migrationName) {
      await cp(join(migrations, entry.name), join(historical, entry.name), { recursive: true });
    }
    if (!entry.isDirectory() || entry.name < slotReleaseMigrationName) {
      await cp(join(migrations, entry.name), join(beforeSlotRelease, entry.name), { recursive: true });
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
  await db.$executeRaw`INSERT INTO users (id, email, name, role, status, created_at, auth_valid_after, updated_at)
    VALUES (${owner}::uuid, 'desktop-owner@example.test', 'Owner', 'user', 'active',
      '2026-01-01T00:00:00.123456Z'::timestamptz, '2026-01-01T00:00:00.123456Z'::timestamptz, now()),
           (${other}::uuid, 'desktop-other@example.test', 'Other', 'user', 'active', now(), now(), now())`;
  await db.$executeRaw`INSERT INTO conversations
    (id, owner_id, title, title_source, archive_status, workspace_rel_path, codex_thread_id, runtime_generation, updated_at)
    VALUES (${conversation}::uuid, ${owner}::uuid, 'Existing task', 'manual', 'active',
      ${`${owner}/home/workspaces/${conversation}`}, ${thread}, ${randomUUID()}::uuid, now())`;
  const before = await db.$queryRaw<Array<{ row: Record<string, unknown> }>>`
    SELECT to_jsonb(c) AS row FROM conversations c WHERE id = ${conversation}::uuid`;
  const checksums = await db.$queryRaw`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  await migrate("desktop_upgrade", beforeSlotRelease);
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
  const coordinator = new MemoryDesktopDeviceCoordinator();
  const service = new DesktopDeviceService(repository, coordinator);
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
  // An authenticated reconnect refreshes the installed version, including a manual rollback.
  const firstConnection = await service.connect(stored);
  await service.refreshAppVersion(stored, firstConnection, "1.2.3");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).appVersion, "1.2.3");
  await service.refreshAppVersion(stored, firstConnection, "0.4.0");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).appVersion, "0.4.0");
  // A replaced connection cannot overwrite the version reported by the current one.
  const winningConnection = await service.connect(stored);
  await service.refreshAppVersion(stored, firstConnection, "9.9.9");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).appVersion, "0.4.0");
  await service.refreshAppVersion(stored, winningConnection, "2.0.0");
  const refreshed = await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } });
  assert.equal(refreshed.appVersion, "2.0.0");
  assert.equal(refreshed.name, "Mac");
  assert.equal(refreshed.tokenHash, stored.tokenHash);
  // Windows and older clients never take the macOS metadata path.
  const legacyConnection = await service.connect(legacyDevice);
  await service.refreshAppVersion(legacyDevice, legacyConnection, "7.7.7");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: legacyDevice.id } })).appVersion, "0.1.0");
  const localThread = randomUUID();
  const localConversation = await db.$transaction(async tx => {
    await assertPairedDesktopDevice(tx, owner, stored.id);
    return tx.conversation.create({ data: {
      ownerId: owner, title: "Local task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${owner}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: stored.id, codexThreadId: localThread,
    } });
  });
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: localConversation.id } })).executionTarget, "local");
  const scope = {
    ownerId: owner,
    deviceId: stored.id,
    connectionId: randomUUID(),
    conversationId: localConversation.id,
    turnId: randomUUID(),
    runtimeGeneration: localConversation.runtimeGeneration,
  };
  const authority = (binding = scope, phase: DesktopRunAuthorizationPhase = "use") => isDesktopRunActive(db, {
    isCurrentConnection: async (deviceId, connectionId) =>
      deviceId === scope.deviceId && connectionId === scope.connectionId,
  }, binding, phase);
  assert.equal(await authority(), false);
  await db.conversationTurnStartIntent.create({ data: {
    projectionTurnId: scope.turnId, ownerId: owner, conversationId: scope.conversationId,
    runtimeGeneration: scope.runtimeGeneration, capabilityGeneration: "0".repeat(64),
    inputText: "Isolated desktop fixture", capabilitiesJson: [], attachmentsJson: [],
    submitMode: "normal", runnerStatus: "prepared",
  } });
  assert.equal(await authority(scope, "issue"), true);
  assert.equal(await authority(scope, "transition"), true);
  assert.equal(await authority(), true);
  for (const binding of [
    { ...scope, ownerId: other },
    { ...scope, deviceId: legacyDevice.id },
    { ...scope, connectionId: randomUUID() },
    { ...scope, runtimeGeneration: randomUUID() },
    { ...scope, conversationId: conversation },
  ]) assert.equal(await authority(binding), false);
  await db.conversationTurnStartIntent.update({
    where: { projectionTurnId: scope.turnId }, data: { runnerStatus: "release_pending" },
  });
  assert.equal(await authority(), false);
  await db.$transaction([
    db.conversationTurnStartIntent.delete({ where: { projectionTurnId: scope.turnId } }),
    db.conversationTurn.create({ data: {
      id: scope.turnId, conversationId: scope.conversationId, sequenceNo: 1,
      submittedBy: owner, codexThreadId: localThread, codexTurnId: randomUUID(),
      status: "running", submitMode: "normal", capabilityGeneration: "0".repeat(64),
      capabilitiesJson: [], startedAt: new Date(),
    } }),
  ]);
  assert.equal(await authority(scope, "issue"), false);
  assert.equal(await authority(scope, "transition"), false);
  assert.equal(await authority(), true);
  await db.user.update({ where: { id: owner }, data: { status: "disabled" } });
  assert.equal(await authority(), false);
  await db.user.update({ where: { id: owner }, data: {
    status: "active", authValidAfter: new Date(sessionEpoch.getTime() + 1000),
  } });
  assert.equal(await authority(), false);
  // Restore the fixture's original epoch without truncating PostgreSQL's microseconds.
  await db.$executeRaw`UPDATE users SET auth_valid_after = created_at WHERE id = ${owner}::uuid`;
  assert.equal(await authority(), true);
  await db.conversationTurn.update({ where: { id: scope.turnId }, data: { interruptRequestedAt: new Date() } });
  assert.equal(await authority(), false);
  await db.conversationTurn.update({ where: { id: scope.turnId }, data: { interruptRequestedAt: null } });
  await db.conversation.update({ where: { id: scope.conversationId }, data: { desktopDeviceId: null } });
  assert.equal(await authority(), false);
  await db.conversation.update({ where: { id: scope.conversationId }, data: { desktopDeviceId: scope.deviceId } });
  assert.equal(await authority(), true);
  // Both of these grants predate the session and runtime binding columns.
  const legacyGrantId = randomUUID();
  await db.$executeRaw`INSERT INTO local_computer_sessions
    (id, owner_id, conversation_id, device_id, status, grant_scope, expires_at)
    VALUES (${randomUUID()}::uuid, ${owner}::uuid, ${scope.conversationId}::uuid, ${stored.id}::uuid, 'active', 'session', now() + interval '1 day')`;
  await db.$executeRaw`INSERT INTO computer_permission_grants
    (id, owner_id, conversation_id, device_id, capability, scope, target_json, expires_at)
    VALUES (${legacyGrantId}::uuid, ${owner}::uuid, ${scope.conversationId}::uuid, ${stored.id}::uuid,
      'computer.act', 'session', '{"bundle_id":"com.example.Legacy"}'::jsonb, now() + interval '1 day')`;
  const legacyArtifactId = randomUUID();
  const legacyArtifactContents = Buffer.from("Artifact saved before path mapping.\n");
  await db.$executeRaw`INSERT INTO conversation_files
    (id, conversation_id, turn_id, kind, source, status, filename, mime_type, size_bytes, checksum_sha256,
     storage_backend, minio_object_key, downloadable, download_card_event_id, updated_at)
    VALUES (${legacyArtifactId}::uuid, ${scope.conversationId}::uuid, ${scope.turnId}::uuid,
      'artifact', 'agent_generated', 'registered', 'legacy.txt', 'text/plain', ${legacyArtifactContents.length},
      ${sha256(legacyArtifactContents)}, 'minio', ${`fixtures/${legacyArtifactId}`}, true, ${randomUUID()}::uuid, now())`;
  await migrate("desktop_upgrade");
  assert.equal((await db.computerPermissionGrant.findUniqueOrThrow({ where: { id: legacyGrantId } })).sessionId, null);
  assert.equal(await authority(), true);
  await verifyDesktopExecutionProjection({
    prisma: db, ownerId: owner, deviceId: stored.id, token: issued.token,
    databaseUrl: databaseUrl("desktop_upgrade"), workspaceRoot: join(root, "workspaces"),
    otherOwnerId: other, legacyConversationId: scope.conversationId, cloudConversationId: conversation,
    legacyArtifact: { id: legacyArtifactId, contents: legacyArtifactContents },
  });
  const settledExistingTurn = await db.conversationTurn.findUniqueOrThrow({ where: { id: scope.turnId } });
  assert.equal(settledExistingTurn.status, "failed");
  assert.equal(settledExistingTurn.errorCode, "DESKTOP_DEVICE_REVOKED");
  await assert.rejects(service.revoke(other, issued.device.id), { code: "FORBIDDEN" });
  const local = await db.localComputerSession.create({
    data: { ownerId: owner, conversationId: conversation, deviceId: stored.id, status: "active", grantScope: "session" },
  });
  const grant = await db.computerPermissionGrant.create({
    data: { ownerId: owner, conversationId: conversation, deviceId: stored.id, capability: "local_execution", scope: "session" },
  });
  await Promise.all([service.revoke(owner, stored.id), service.revoke(owner, stored.id)]);
  assert.equal(await authority(), false);
  const revoked = await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } });
  await service.revoke(owner, stored.id);
  assert.deepEqual((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).revokedAt, revoked.revokedAt);
  await assert.rejects(service.rename(owner, stored.id, "Revoked device"), { code: "FORBIDDEN" });
  await assert.rejects(assertPairedDesktopDevice(db, owner, stored.id), { code: "FORBIDDEN" });
  assert.equal(await service.authenticate(issued.token), null);
  await service.refreshAppVersion(stored, winningConnection, "3.0.0");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: stored.id } })).appVersion, "2.0.0");
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
  // A stale owner epoch blocks the refresh even while the socket presence is current.
  const renewedRecord = await db.desktopDevice.findUniqueOrThrow({ where: { id: renewed.device.id } });
  const renewedConnection = await service.connect(renewedRecord);
  await service.refreshAppVersion(renewedRecord, renewedConnection, "5.5.5");
  assert.equal((await db.desktopDevice.findUniqueOrThrow({ where: { id: renewed.device.id } })).appVersion, "0.1.0");
  await migrate("desktop_fresh");
  const fresh = createPrismaClient(databaseUrl("desktop_fresh"));
  connections.push(fresh);
  assert.equal(await fresh.desktopDevice.count(), 0);
  assert.equal(await fresh.conversation.count(), 0);
  console.log("Desktop PostgreSQL whitebox passed: cloud upgrade, device lifecycle, bounded Mac grants, exact WebSocket scope, reconnect, and revoked-turn settlement.");
} finally {
  await Promise.all(connections.map(connection => connection.$disconnect()));
  if (started) await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 });
  await rm(root, { recursive: true, force: true });
}
