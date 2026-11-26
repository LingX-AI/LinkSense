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
import { projectWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";
import { listDesktopActivity } from "../../src/modules/audit/desktop-activity.js";
import { isDesktopRunActive } from "../../src/modules/desktop-credentials/run-authority.js";
import type { DesktopRunAuthorizationPhase } from "../../src/modules/desktop-credentials/run-leases.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { CreditLimitService } from "../../src/modules/usage/credit-limit.js";
import { UsageAnalyticsService } from "../../src/modules/usage/service.js";
import { MemoryDesktopDeviceCoordinator } from "../desktop-devices.fixture.js";
import { verifyDesktopExecutionProjection } from "./desktop-execution-projection.js";

type DesktopActivityReader = Parameters<typeof listDesktopActivity>[0];

const seededUuid = (bucket: number, index: number) =>
  `${bucket.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

// Exercises the real JSONB path filters and ordering against migrated PostgreSQL.
async function verifyDesktopActivity(
  prisma: DesktopActivityReader,
): Promise<void> {
  const actor = seededUuid(0x51, 1);
  const foreignActor = seededUuid(0x51, 2);
  const activityId = (index: number) => seededUuid(0x52, index);
  const targetId = seededUuid(0x54, 1);
  const base = Date.UTC(2026, 3, 1, 12, 0, 0);
  const at = (seconds: number) => new Date(base + seconds * 1000);
  // IDs 1-3 share the oldest timestamp; 4-21 run newest to oldest as the ID
  // rises, so only timestamp ordering plus the id tie-break yields this list.
  const validAt = (index: number) => at(index <= 3 ? 0 : 22 - index);
  const generic = (index: number) => ({
    id: activityId(index), actorId: actor, action: "desktop_device_paired",
    targetType: "desktop_device", targetId, result: "success",
    metadataJson: {}, createdAt: validAt(index),
  });
  await prisma.auditLog.createMany({
    data: [
      ...Array.from({ length: 18 }, (_, offset) => generic(offset + 1)),
      {
        id: activityId(19), actorId: actor, action: "desktop_approval_responded",
        targetType: "conversation_desktop_approval", targetId, result: "success",
        metadataJson: { delivery: "confirmed" }, createdAt: validAt(19),
      },
      {
        id: activityId(20), actorId: actor, action: "desktop_tool_requested",
        targetType: "local_computer", targetId, result: "success",
        metadataJson: {
          operation: "computer.execute", delivery: "confirmed",
          computer_request: "act", computer_action: "click",
        }, createdAt: validAt(20),
      },
      {
        id: activityId(21), actorId: actor, action: "desktop_tool_requested",
        targetType: "local_computer", targetId, result: "success",
        metadataJson: {
          operation: "computer.execute", typed_text: "synthetic-typed-secret",
          token: "synthetic-token-secret",
        }, createdAt: validAt(21),
      },
      // Newer rows that only a pre-limit actor/action/target/JSON filter removes.
      {
        id: activityId(22), actorId: foreignActor, action: "desktop_tool_requested",
        targetType: "local_computer", targetId, result: "success",
        metadataJson: { operation: "computer.execute" }, createdAt: at(60),
      },
      {
        id: activityId(23), actorId: actor, action: "desktop_device_paired",
        targetType: "local_computer", targetId, result: "success",
        metadataJson: {}, createdAt: at(61),
      },
      {
        id: activityId(24), actorId: actor, action: "desktop_tool_requested",
        targetType: "local_computer", targetId, result: "success",
        metadataJson: { operation: "shell.execute" }, createdAt: at(62),
      },
    ],
  });
  const activity = await listDesktopActivity(prisma, actor);
  const expectedIds = [
    ...Array.from({ length: 18 }, (_, offset) => activityId(4 + offset)),
    activityId(3), activityId(2),
  ];
  assert.equal(activity.items.length, 20);
  assert.deepEqual(activity.items.map(item => item.id), expectedIds);
  // The historical attempt stores raw values but no optional dimensions; none leak.
  assert.deepEqual(activity.items.find(item => item.id === activityId(21)), {
    id: activityId(21), created_at: validAt(21).toISOString(),
    action: "desktop_tool_requested", result: "success",
  });
  assert.equal(activity.items.find(item => item.id === activityId(20))?.delivery, undefined);
  assert.equal(activity.items.find(item => item.id === activityId(19))?.delivery, "confirmed");
}

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
      ${projectWorkspaceRelativePath(owner, null)}, ${thread}, ${randomUUID()}::uuid, now())`;
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
  const authority = (
    binding = scope,
    phase: DesktopRunAuthorizationPhase = "use",
    transitionThreadId?: string,
  ) => isDesktopRunActive(db, {
    isCurrentConnection: async (deviceId, connectionId) =>
      deviceId === scope.deviceId && connectionId === scope.connectionId,
  }, binding, phase, transitionThreadId);
  assert.equal(await authority(), false);
  // Exercise the old schema before applying the projection migration below.
  await db.$executeRaw`INSERT INTO conversation_turn_start_intents
    (projection_turn_id, owner_id, conversation_id, runtime_generation, capability_generation,
     input_text, capabilities_json, attachments_json, submit_mode, runner_status, updated_at)
    VALUES (${scope.turnId}::uuid, ${owner}::uuid, ${scope.conversationId}::uuid, ${scope.runtimeGeneration}::uuid,
      ${"0".repeat(64)}, 'Isolated desktop fixture', '[]'::jsonb, '[]'::jsonb, 'normal', 'prepared', now())`;
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
  await db.$executeRaw`UPDATE conversation_turn_start_intents SET runner_status = 'release_pending'
    WHERE projection_turn_id = ${scope.turnId}::uuid`;
  assert.equal(await authority(), false);
  await db.$transaction([
    db.$executeRaw`DELETE FROM conversation_turn_start_intents WHERE projection_turn_id = ${scope.turnId}::uuid`,
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
  // Native history written before the widening migration: the prior columns are
  // populated and must survive unchanged.
  const legacyUsageId = randomUUID();
  const legacySnapshotKey = sha256(`legacy-provider-usage:${legacyUsageId}`);
  await db.$executeRaw`INSERT INTO token_usage_records
    (id, snapshot_key, owner_id, conversation_id, turn_id, codex_thread_id, codex_turn_id, model,
     total_tokens, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
     input_price_micros_per_million, cached_input_price_micros_per_million, output_price_micros_per_million,
     input_cost_pico_usd, cached_input_cost_pico_usd, output_cost_pico_usd, total_cost_pico_usd,
     unpriced_tokens, credit_price_micros_usd, used_credit_micros, observed_at)
    VALUES (${legacyUsageId}::uuid, ${legacySnapshotKey}, ${owner}::uuid, ${scope.conversationId}::uuid,
      ${scope.turnId}::uuid, 'legacy-thread', 'legacy-turn', 'legacy-native',
      15, 10, 0, 5, 0,
      10000000, 2000000, 20000000,
      100000000, 0, 100000000, 200000000,
      0, 10000, 20000, now())`;
  const legacyUsageBefore = await db.tokenUsageRecord.findUniqueOrThrow({
    where: { id: legacyUsageId },
    select: {
      codexThreadId: true, codexTurnId: true, totalTokens: true,
      totalCostPicoUsd: true, usedCreditMicros: true,
    },
  });
  assert.deepEqual(legacyUsageBefore, {
    codexThreadId: "legacy-thread", codexTurnId: "legacy-turn", totalTokens: 15n,
    totalCostPicoUsd: 200_000_000n, usedCreditMicros: 20_000n,
  });
  const legacyStartId = randomUUID();
  await db.$executeRaw`INSERT INTO conversation_turn_start_intents
    (projection_turn_id, owner_id, conversation_id, runtime_generation, capability_generation,
     input_text, capabilities_json, attachments_json, submit_mode, runner_status, updated_at)
    VALUES (${legacyStartId}::uuid, ${owner}::uuid, ${scope.conversationId}::uuid, ${scope.runtimeGeneration}::uuid,
      ${"0".repeat(64)}, 'Pending before model-switch support', '[]'::jsonb, '[]'::jsonb, 'normal', 'prepared', now())`;
  await migrate("desktop_upgrade");
  const legacyStart = await db.conversationTurnStartIntent.findUniqueOrThrow({ where: { projectionTurnId: legacyStartId } });
  assert.equal(legacyStart.desktopTransitionSourceThreadId, null);
  assert.equal(legacyStart.runnerStatus, "prepared");
  assert.equal(legacyStart.inputText, "Pending before model-switch support");
  const legacyStartScope = { ...scope, turnId: legacyStartId };
  assert.equal(await authority(legacyStartScope, "issue", localThread), false);
  await db.conversationTurnStartIntent.update({
    where: { projectionTurnId: legacyStartId },
    data: { desktopTransitionSourceThreadId: localThread },
  });
  assert.equal(await authority(legacyStartScope, "issue", localThread), true);
  assert.equal(await authority(legacyStartScope, "issue", randomUUID()), false);
  await db.conversationTurnStartIntent.update({
    where: { projectionTurnId: legacyStartId },
    data: { desktopTransitionSourceThreadId: randomUUID() },
  });
  assert.equal(await authority(legacyStartScope, "issue", localThread), false);
  await db.conversationTurnStartIntent.delete({ where: { projectionTurnId: legacyStartId } });
  assert.equal((await db.computerPermissionGrant.findUniqueOrThrow({ where: { id: legacyGrantId } })).sessionId, null);
  assert.equal(await authority(), true);
  const legacyUsageAfter = await db.tokenUsageRecord.findUniqueOrThrow({
    where: { id: legacyUsageId },
    select: {
      codexThreadId: true, codexTurnId: true, totalTokens: true,
      totalCostPicoUsd: true, usedCreditMicros: true,
    },
  });
  assert.deepEqual(legacyUsageAfter, legacyUsageBefore,
    "the widening migration must preserve native history and its accounting");
  // Provider-authoritative usage recorded before turn projection keeps the
  // server-issued projection turn id and leaves native ids empty.
  const providerUsageId = randomUUID();
  const providerSnapshotKey = sha256(`provider-authoritative:${providerUsageId}`);
  await db.tokenUsageRecord.create({
    data: {
      id: providerUsageId,
      snapshotKey: providerSnapshotKey,
      ownerId: owner,
      conversationId: scope.conversationId,
      turnId: scope.turnId,
      codexThreadId: null,
      codexTurnId: null,
      model: "provider-authoritative",
      totalTokens: 6n,
      inputTokens: 4n,
      cachedInputTokens: 0n,
      outputTokens: 2n,
      reasoningOutputTokens: 0n,
      inputPriceMicrosPerMillion: 10_000_000n,
      cachedInputPriceMicrosPerMillion: 2_000_000n,
      outputPriceMicrosPerMillion: 20_000_000n,
      inputCostPicoUsd: 40_000_000n,
      cachedInputCostPicoUsd: 0n,
      outputCostPicoUsd: 40_000_000n,
      totalCostPicoUsd: 80_000_000n,
      unpricedTokens: 0n,
      creditPriceMicrosUsd: 10_000n,
      usedCreditMicros: 8_000n,
      observedAt: new Date(),
    },
  });
  const usageAnalytics = new UsageAnalyticsService(db);
  const usageReport = await usageAnalytics.report({ range: "all", time_zone: "UTC" });
  assert.equal(usageReport.totals.token_usage.total_tokens, "21");
  assert.equal(usageReport.totals.cost.total_cost, "0.00028");
  const assistantUsage = usageReport.workloads.find(
    workload => workload.workload === "assistant_response",
  );
  assert.equal(assistantUsage?.token_usage.total_tokens, "21");
  assert.deepEqual(assistantUsage?.measurement_methods, ["provider"]);
  assert.equal(usageReport.models.find(model => model.model_id === "legacy-native")
    ?.token_usage.total_tokens, "15");
  assert.equal(usageReport.models.find(model => model.model_id === "provider-authoritative")
    ?.token_usage.total_tokens, "6");
  const usageProfile = await usageAnalytics.personalProfile(owner, { time_zone: "UTC" });
  assert.equal(usageProfile.metrics.token_usage.total_tokens, "21");
  assert.equal(usageProfile.models.find(model => model.model_id === "provider-authoritative")
    ?.token_usage.total_tokens, "6");
  const usageQuota = await usageAnalytics.personalQuota(owner, { range: "7d", time_zone: "UTC" });
  assert.equal(usageQuota.tasks.find(task => task.id === scope.conversationId)?.credits, "0.028");
  const creditOverview = await new CreditLimitService(db, { timeZone: "UTC" }).personalOverview(owner);
  assert.equal(creditOverview.used, "0.028");
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
  // Insert audit rows only on the migrated fresh branch so the upgrade branch's
  // existing audit expectations remain untouched.
  await verifyDesktopActivity(fresh);
  console.log("Desktop PostgreSQL whitebox passed: cloud upgrade, device lifecycle, bounded Mac grants, exact WebSocket scope, reconnect, revoked-turn settlement, and account-scoped desktop activity.");
} finally {
  await Promise.all(connections.map(connection => connection.$disconnect()));
  if (started) await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 });
  await rm(root, { recursive: true, force: true });
}
