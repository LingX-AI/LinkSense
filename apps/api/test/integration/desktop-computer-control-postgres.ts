import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pLimit from "p-limit";
import { PrismaPg } from "@prisma/adapter-pg";
import { createPrismaClient } from "../../src/db.js";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { sha256 } from "../../src/lib/crypto.js";
import {
  DesktopComputerControl,
  DesktopComputerRedisSelection,
  PrismaDesktopComputerControl,
  createDesktopComputerPauseAuditClient,
  desktopComputerPauseAuditId,
  desktopComputerPauseAuditPoolConfig,
  desktopComputerSelectionKey,
  recordDesktopComputerPauseAudit,
  type DesktopComputerControlHost,
  type DesktopComputerPauseReceipt,
  type DesktopComputerResumeReceipt,
  type DesktopComputerSelection,
} from "../../src/modules/desktop-devices/computer-control.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import {
  desktopRunLeaseKey,
  DesktopRunLeases,
  type DesktopRunScope,
} from "../../src/modules/desktop-credentials/run-leases.js";
import {
  authorizeLocalComputerAction,
  verifyLocalComputerDispatch,
} from "../../src/modules/local-computer/authorization.js";
import type { DesktopComputerReadPublication } from "../../src/modules/desktop-devices/computer-admission.js";
import { LocalComputerGuiOccupancy, localComputerGuiOccupancyKey } from "../../src/modules/local-computer/occupancy.js";
import { LocalComputerService } from "../../src/modules/local-computer/service.js";
import {
  desktopExecutionResultSchema,
  desktopToolRequestSchema,
  type DesktopComputerControlResult,
} from "@linksense/shared";
import { createRedisFixture } from "../fixtures/redis.js";

/**
 * Disposable PostgreSQL/Redis white-box for the product M1b selection authority.
 * It owns a temporary cluster and never loads the application environment.
 */
const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "linksense-computer-pg-"));
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const data = join(root, "data");
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Missing test port"));
      return;
    }
    server.close(error => error ? reject(error) : resolve(address.port));
  });
});
const databaseUrl = (name: string) => {
  const url = new URL(`postgresql://127.0.0.1:${port}/${name}`);
  url.username = userInfo().username;
  return url.toString();
};

/** Polls a real observable condition; the interval is only retry spacing. */
const waitUntil = async (label: string, deadlineMs: number, predicate: () => Promise<boolean>) => {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
};

/**
 * Loopback TCP proxy in front of the disposable PostgreSQL cluster. It
 * forwards both directions until the test drops only server -> client bytes,
 * leaving a fully connected real backend that never answers the client while
 * requests keep reaching it. The exact in-flight query is confirmed through
 * pg_stat_activity before responses are lost. It can also withhold only the
 * first connection's responses once its real BEGIN query was forwarded, so
 * that one backend stays open while every later connection is untouched.
 */
async function createAuditTransportProxy(upstreamPort: number) {
  type Pair = {
    client: Socket; upstream: Socket;
    withholdServerBytes: boolean;
    pending: Buffer;
    startupDone: boolean;
  };
  // Complete simple-query frame for BEGIN: type Q, length 10, "BEGIN\0".
  const beginQuery = Buffer.from("\x51\x00\x00\x00\x0aBEGIN\x00", "latin1");
  const pairs = new Set<Pair>();
  let dropServerBytes = false;
  let anyClientClosed = false;
  let stallFirstBegin = false;
  let firstBeginForwarded = false;
  const closeWaiters = new Set<() => void>();
  const observeClientBytes = (pair: Pair, chunk: Buffer) => {
    if (!stallFirstBegin || firstBeginForwarded) return;
    pair.pending = pair.pending.length ? Buffer.concat([pair.pending, chunk]) : chunk;
    if (!pair.startupDone) {
      if (pair.pending.length < 4) return;
      const startupLength = pair.pending.readUInt32BE(0);
      // Consume the whole length-prefixed startup packet first, so its payload
      // can never be mistaken for a query and BEGIN is only seen after the
      // connection was established.
      if (startupLength < 8 || pair.pending.length < startupLength) return;
      pair.pending = pair.pending.subarray(startupLength);
      pair.startupDone = true;
    }
    if (!pair.pending.includes(beginQuery)) {
      const keep = beginQuery.length - 1;
      if (pair.pending.length > keep) pair.pending = pair.pending.subarray(pair.pending.length - keep);
      return;
    }
    // The BEGIN frame was already written upstream by the caller; withhold
    // only this connection's responses so the real backend remains in BEGIN.
    pair.withholdServerBytes = true;
    firstBeginForwarded = true;
  };
  const server = createServer(client => {
    const upstream = connect(upstreamPort, "127.0.0.1");
    const pair: Pair = { client, upstream, withholdServerBytes: false, pending: Buffer.alloc(0), startupDone: false };
    pairs.add(pair);
    client.on("data", (chunk: Buffer) => {
      if (upstream.writable) upstream.write(chunk);
      observeClientBytes(pair, chunk);
    });
    upstream.on("data", (chunk: Buffer) => {
      if (!dropServerBytes && !pair.withholdServerBytes && client.writable) client.write(chunk);
    });
    client.on("error", () => { upstream.destroy(); client.destroy(); });
    upstream.on("error", () => { client.destroy(); upstream.destroy(); });
    upstream.on("close", () => { pairs.delete(pair); client.destroy(); });
    client.on("close", () => {
      pairs.delete(pair);
      upstream.destroy();
      anyClientClosed = true;
      for (const resolve of closeWaiters) resolve();
      closeWaiters.clear();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing audit transport proxy port");
  const destroyConnections = () => {
    for (const pair of [...pairs]) {
      pairs.delete(pair);
      pair.client.destroy();
      pair.upstream.destroy();
    }
  };
  return {
    port: address.port,
    url: (name: string) => {
      const url = new URL(`postgresql://127.0.0.1:${address.port}/${name}`);
      url.username = userInfo().username;
      return url.toString();
    },
    waitForClientClose: () => anyClientClosed
      ? Promise.resolve()
      : new Promise<void>(resolve => { closeWaiters.add(resolve); }),
    dropServerBytes: () => { dropServerBytes = true; },
    stallFirstBegin: () => { stallFirstBegin = true; },
    firstBeginForwarded: () => firstBeginForwarded,
    destroyConnections,
    activeConnections: () => pairs.size,
    close: async () => {
      destroyConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
let pgStarted = false;
const redis = await createRedisFixture();
let db: ReturnType<typeof createPrismaClient> | undefined;
let auditDb: ReturnType<typeof createPrismaClient> | undefined;
try {
  await execute("initdb", ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"], { timeout: 30_000 });
  await execute("pg_ctl", [
    "-D", data, "-l", join(root, "server.log"), "-w", "start",
    "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
  ], { timeout: 30_000 });
  pgStarted = true;
  const control = createPrismaClient(databaseUrl("postgres"));
  try {
    await control.$executeRawUnsafe("CREATE DATABASE computer_control");
  } finally {
    await control.$disconnect();
  }
  await execute("pnpm", [
    "exec", "prisma", "migrate", "deploy",
    "--config", "apps/api/test/integration/prisma.config.ts",
  ], {
    cwd: repositoryRoot, timeout: 180_000, maxBuffer: 8_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl("computer_control") },
  });
  db = createPrismaClient(databaseUrl("computer_control"));
  auditDb = createDesktopComputerPauseAuditClient(databaseUrl("computer_control"));

  const owner = await db.user.create({
    data: { email: "computer-owner@example.test", name: "Owner", role: "user", status: "active" },
  });
  const other = await db.user.create({
    data: { email: "computer-other@example.test", name: "Other", role: "user", status: "active" },
  });
  const device = await db.desktopDevice.create({
    data: {
      ownerId: owner.id, tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: owner.authValidAfter, name: "Mac", platform: "darwin", arch: "arm64",
      appVersion: "0.1.0",
    },
  });
  const otherDevice = await db.desktopDevice.create({
    data: {
      ownerId: other.id, tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: other.authValidAfter, name: "Other Mac", platform: "darwin", arch: "arm64",
      appVersion: "0.1.0",
    },
  });
  const thread = randomUUID();
  const generation = randomUUID();
  const createConversation = (input: {
    ownerId: string; deviceId: string | null; executionTarget: "local" | "cloud"; codexThreadId?: string;
  }) => db!.conversation.create({
    data: {
      ownerId: input.ownerId, title: "Computer control fixture", titleSource: "manual",
      archiveStatus: "active", workspaceRelPath: `${input.ownerId}/home/workspaces/${randomUUID()}`,
      codexThreadId: input.codexThreadId ?? randomUUID(),
      runtimeGeneration: input.executionTarget === "local" ? generation : randomUUID(),
      executionTarget: input.executionTarget, desktopDeviceId: input.deviceId,
    },
  });
  const local = await createConversation({ ownerId: owner.id, deviceId: device.id, executionTarget: "local", codexThreadId: thread });
  const cloud = await createConversation({ ownerId: owner.id, deviceId: null, executionTarget: "cloud" });
  const foreign = await createConversation({
    ownerId: other.id, deviceId: otherDevice.id, executionTarget: "local", codexThreadId: randomUUID(),
  });
  const turn = await db.conversationTurn.create({
    data: {
      conversationId: local.id, sequenceNo: 1, submittedBy: owner.id,
      codexThreadId: thread, codexTurnId: randomUUID(), status: "running",
      submitMode: "normal", capabilityGeneration: "0".repeat(64), capabilitiesJson: [], startedAt: new Date(),
    },
  });
  const foreignTurn = await db.conversationTurn.create({
    data: {
      conversationId: foreign.id, sequenceNo: 1, submittedBy: other.id,
      codexThreadId: foreign.codexThreadId!, codexTurnId: randomUUID(), status: "running",
      submitMode: "normal", capabilityGeneration: "0".repeat(64), capabilitiesJson: [], startedAt: new Date(),
    },
  });

  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const connectionId = randomUUID();
  await coordinator.connect(device.id, connectionId);
  const leases = new DesktopRunLeases(redis.client, async () => true);
  const bindRun = async (scope: DesktopRunScope) => {
    const credentials = await leases.issue(
      { deviceId: scope.deviceId, connectionId: scope.connectionId },
      {
        ownerId: scope.ownerId, conversationId: scope.conversationId,
        projectionTurnId: scope.turnId, expectedRuntimeGeneration: scope.runtimeGeneration,
        model: "fixture-model",
        modelProvider: {
          revision: 1, protocolMode: "native_responses",
          baseUrl: "https://fixture-provider.example.test/v1", apiKey: randomUUID(),
        },
      },
    );
    return credentials.run_token;
  };
  const occupancy = new LocalComputerGuiOccupancy(redis.client);
  const redisSelections = new DesktopComputerRedisSelection(redis.client);
  const store = new PrismaDesktopComputerControl(db, redisSelections, leases, occupancy);
  const scope: DesktopRunScope = {
    ownerId: owner.id, deviceId: device.id, connectionId,
    conversationId: local.id, turnId: turn.id, runtimeGeneration: generation,
  };
  const selectionA = randomUUID();
  const selectionB = randomUUID();
  const selectionC = randomUUID();
  const bundleId = "com.example.ProductFixture";
  await bindRun(scope);

  assert.deepEqual(await store.resolve({ ownerId: owner.id, deviceId: device.id, conversationId: local.id }),
    { runtimeGeneration: generation });
  assert.equal(await store.resolve({ ownerId: owner.id, deviceId: device.id, conversationId: cloud.id }), null);
  assert.equal(await store.resolve({ ownerId: other.id, deviceId: device.id, conversationId: local.id }), null);

  const selected = await store.select({ scope, selectionId: selectionA, bundleId });
  assert.equal(selected.state, "active");
  assert.equal(selected.runtimeGeneration, generation);
  assert.equal(selected.selectionId, selectionA);
  const session = await db.localComputerSession.findUniqueOrThrow({ where: { id: selected.sessionId } });
  assert.equal(session.status, "active");
  assert.equal(session.runtimeGeneration, generation);
  assert.ok(session.expiresAt);
  const grantRows = await db.computerPermissionGrant.findMany({ where: { sessionId: selected.sessionId } });
  assert.deepEqual(grantRows.map(row => row.capability).sort(), ["computer.act", "computer.observe"]);
  assert.ok(grantRows.every(row => (row.targetJson as { bundle_id?: string }).bundle_id === bundleId));
  assert.ok(grantRows.every(row => row.expiresAt?.getTime() === session.expiresAt?.getTime()));
  const sessionTtl = session.expiresAt!.getTime() - Date.now();
  assert.ok(sessionTtl > 4 * 60_000 && sessionTtl <= 5 * 60_000, `unexpected session ttl ${sessionTtl}`);
  assert.equal((await redis.client.exists(desktopComputerSelectionKey(scope))), 1);

  // An explicit select with the same native selection renews the live window:
  // same session, extended expiry, and a new control epoch so old queued acts
  // cannot revive. No additional session is created.
  const repeated = await store.select({ scope, selectionId: selectionA, bundleId });
  assert.equal(repeated.sessionId, selected.sessionId);
  assert.ok(repeated.expiresAt >= selected.expiresAt);
  assert.notEqual(repeated.controlEpoch, selected.controlEpoch);
  const renewedSession = await db.localComputerSession.findUniqueOrThrow({ where: { id: selected.sessionId } });
  assert.equal(renewedSession.expiresAt?.getTime(), repeated.expiresAt);
  const renewedGrants = await db.computerPermissionGrant.findMany({ where: { sessionId: selected.sessionId } });
  assert.ok(renewedGrants.every(row => row.expiresAt?.getTime() === repeated.expiresAt));
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: local.id, deviceId: device.id },
  }), 1);
  await assert.rejects(store.select({ scope, selectionId: selectionB, bundleId }), {
    code: "COMPUTER_TARGET_CHANGED",
  });

  const pausing = await store.pause({ scope, selectionId: selectionA });
  assert.equal(pausing.state, "pausing");
  const paused = await store.confirmPause({ scope, selection: pausing });
  assert.equal(paused.state, "paused");
  assert.equal((await store.pause({ scope, selectionId: selectionA })).state, "paused");
  await assert.rejects(store.select({ scope, selectionId: selectionA, bundleId }), {
    code: "COMPUTER_TARGET_CHANGED",
  });
  await assert.rejects(store.resume({ scope, selectionId: selectionA, newSelectionId: selectionA }), {
    code: "COMPUTER_TARGET_CHANGED",
  });
  const resumed = await store.resume({ scope, selectionId: selectionA, newSelectionId: selectionB });
  assert.equal(resumed.state, "active");
  assert.equal(resumed.selectionId, selectionB);
  assert.equal(resumed.sessionId, selected.sessionId);
  assert.equal(await db.computerPermissionGrant.count({ where: { sessionId: selected.sessionId } }), 2);
  // A lost resume acknowledge can retry the identical transition.
  assert.deepEqual(
    await store.resume({ scope, selectionId: selectionA, newSelectionId: selectionB }),
    resumed,
  );

  // A revoked grant makes the exact same-id selection non-renewable. The
  // refusal must not prepare a replacement session/grant pair, revive the
  // revoked grant, or advance the selection epoch.
  await db.computerPermissionGrant.updateMany({
    where: { sessionId: selected.sessionId, capability: "computer.act" },
    data: { revokedAt: new Date() },
  });
  const beforeRefusal = await store.read(scope);
  if (!beforeRefusal) throw new Error("selection missing");
  const sessionsBeforeRefusal = await db.localComputerSession.count({
    where: { conversationId: local.id, deviceId: device.id },
  });
  const grantsBeforeRefusal = await db.computerPermissionGrant.count({
    where: { sessionId: selected.sessionId },
  });
  await assert.rejects(store.select({ scope, selectionId: selectionB, bundleId }), { code: "FORBIDDEN" });
  assert.deepEqual(await store.read(scope), beforeRefusal);
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: local.id, deviceId: device.id },
  }), sessionsBeforeRefusal);
  assert.equal(await db.computerPermissionGrant.count({
    where: { sessionId: selected.sessionId },
  }), grantsBeforeRefusal);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: selected.sessionId },
  })).status, "active");
  const revoked = await db.computerPermissionGrant.findMany({ where: { sessionId: selected.sessionId } });
  assert.notEqual(revoked.find(row => row.capability === "computer.act")?.revokedAt, null);
  assert.equal(revoked.find(row => row.capability === "computer.observe")?.revokedAt, null);

  // Stop still works from the unchanged metadata and ends exactly that
  // session, so the old selection remains a safety control after a refusal.
  const stoppedAfterRefusal = await store.stop({ scope, selectionId: selectionB });
  assert.equal(stoppedAfterRefusal.state, "stopped");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: selected.sessionId },
  })).status, "ended");
  const stoppedGrantsAfterRefusal = await db.computerPermissionGrant.findMany({
    where: { sessionId: selected.sessionId },
  });
  assert.ok(stoppedGrantsAfterRefusal.every(row => row.revokedAt !== null));

  // A fresh deliberate pick with a new selection id is separate and may start
  // a new session/grant pair after the old selection is stopped.
  const fresh = await store.select({ scope, selectionId: selectionC, bundleId });
  assert.equal(fresh.state, "active");
  assert.equal(fresh.selectionId, selectionC);
  assert.notEqual(fresh.sessionId, selected.sessionId);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: fresh.sessionId },
  })).status, "active");
  assert.equal(await db.computerPermissionGrant.count({ where: { sessionId: fresh.sessionId } }), 2);

  // Resume requires both live grants; a revoked act keeps the selection paused.
  await store.pause({ scope, selectionId: selectionC });
  await store.confirmPause({
    scope, selection: (await store.read(scope))!,
  });
  await db.computerPermissionGrant.updateMany({
    where: { sessionId: fresh.sessionId, capability: "computer.act" },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(store.resume({ scope, selectionId: selectionC, newSelectionId: selectionA }), {
    code: "FORBIDDEN",
  });

  // Stop is a safety control: it ends exactly the selected session/grants even
  // from a paused state and is idempotent.
  const stopped = await store.stop({ scope, selectionId: selectionC });
  assert.equal(stopped.state, "stopped");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({ where: { id: fresh.sessionId } })).status, "ended");
  const stoppedGrants = await db.computerPermissionGrant.findMany({ where: { sessionId: fresh.sessionId } });
  assert.ok(stoppedGrants.every(row => row.revokedAt !== null));
  assert.equal((await store.stop({ scope, selectionId: selectionC })).state, "stopped");

  // The locked authority rejects wrong conversation kinds, foreign owners,
  // stale runtime generations, interrupted turns, and connection replacement.
  const cloudScope = { ...scope, conversationId: cloud.id, runtimeGeneration: cloud.runtimeGeneration };
  await assert.rejects(store.select({ scope: cloudScope, selectionId: randomUUID(), bundleId }), { code: "FORBIDDEN" });
  const foreignScope = {
    ...scope, ownerId: other.id, deviceId: otherDevice.id,
    conversationId: foreign.id, turnId: randomUUID(), runtimeGeneration: foreign.runtimeGeneration,
  };
  await coordinator.connect(otherDevice.id, foreignScope.connectionId);
  await assert.rejects(store.select({ scope: foreignScope, selectionId: randomUUID(), bundleId }), { code: "FORBIDDEN" });
  const staleScope = { ...scope, runtimeGeneration: randomUUID() };
  await assert.rejects(store.select({ scope: staleScope, selectionId: randomUUID(), bundleId }), { code: "FORBIDDEN" });
  await db.conversationTurn.update({ where: { id: turn.id }, data: { interruptRequestedAt: new Date() } });
  await assert.rejects(store.select({ scope, selectionId: randomUUID(), bundleId }), { code: "FORBIDDEN" });
  await db.conversationTurn.update({ where: { id: turn.id }, data: { interruptRequestedAt: null } });

  const replacementConnection = randomUUID();
  await coordinator.connect(device.id, replacementConnection);
  await assert.rejects(store.pause({ scope, selectionId: selectionC }), { code: "COMPUTER_UNAVAILABLE" });
  await db.conversationTurn.update({
    where: { id: turn.id }, data: { status: "completed", completedAt: new Date() },
  });
  const replacementTurn = await db.conversationTurn.create({
    data: {
      conversationId: local.id, sequenceNo: 2, submittedBy: owner.id,
      codexThreadId: thread, codexTurnId: randomUUID(), status: "running",
      submitMode: "normal", capabilityGeneration: "0".repeat(64), capabilitiesJson: [], startedAt: new Date(),
    },
  });
  const replacementScope: DesktopRunScope = {
    ...scope, connectionId: replacementConnection, turnId: replacementTurn.id,
  };
  await bindRun(replacementScope);
  const replacement = await store.select({
    scope: replacementScope, selectionId: randomUUID(), bundleId,
  });
  assert.equal(replacement.connectionId, replacementConnection);
  assert.equal((await redis.client.get(localComputerGuiOccupancyKey(device.id))), null);

  // ---------------------------------------------------------------------
  // Exact live run binding, locked dispatch, durable pending input, and
  // cross-replica lifecycle regressions. All are deterministic; no replayed
  // transport action and no real Mac/device.
  // ---------------------------------------------------------------------
  const service = new LocalComputerService(db);
  const actor = { id: owner.id, authValidAfter: owner.authValidAfter };
  const delayed = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  // One running turn per conversation; each isolated test turn gets its own
  // local conversation on the same device so scopes stay independent.
  const createTurn = async () => {
    const conversation = await createConversation({
      ownerId: owner.id, deviceId: device.id, executionTarget: "local",
    });
    const turn = await db!.conversationTurn.create({
      data: {
        conversationId: conversation.id, sequenceNo: 1, submittedBy: owner.id,
        codexThreadId: conversation.codexThreadId!, codexTurnId: randomUUID(), status: "running",
        submitMode: "normal", capabilityGeneration: "0".repeat(64), capabilitiesJson: [], startedAt: new Date(),
      },
    });
    return { conversation, turn };
  };
  const writeRun = (value: DesktopRunScope) => redis.client.set(
    desktopRunLeaseKey(value.turnId),
    JSON.stringify({
      scope: value, expiresAt: Date.now() + 10 * 60_000, runHash: "a".repeat(64), models: {},
    }),
    "PX", 10 * 60_000,
  );
  const putHolder = async (
    value: DesktopRunScope, selection: DesktopComputerSelection, holderId = randomUUID(),
  ) => {
    await redis.client.set(localComputerGuiOccupancyKey(value.deviceId), JSON.stringify({
      v: 1, holderId, expiresAt: Date.now() + 45_000, scope: value,
      sessionId: selection.sessionId, bundleId: selection.bundleId, selectionId: selection.selectionId,
    }), "PX", 60_000);
    return holderId;
  };
  const runTurn = async () => {
    const created = await createTurn();
    const value: DesktopRunScope = {
      ...scope, conversationId: created.conversation.id,
      runtimeGeneration: created.conversation.runtimeGeneration,
      connectionId: replacementConnection, turnId: created.turn.id,
    };
    const runToken = await bindRun(value);
    const selection = await store.select({ scope: value, selectionId: randomUUID(), bundleId });
    return { conversation: created.conversation, turn: created.turn, scope: value, selection, runToken };
  };
  const actGrant = (selection: DesktopComputerSelection) => db!.computerPermissionGrant.findFirstOrThrow({
    where: { sessionId: selection.sessionId, capability: "computer.act" },
  });
  const actRequest = (id = randomUUID()) => ({
    kind: "act" as const, native_call_id: `native-${id}`,
    input: { action: "click" as const, observation_id: "obs-1", ref: "e1", timeout_ms: 1_000 },
  });
  const admissionFor = async (input: { scope: DesktopRunScope; selection: DesktopComputerSelection }) => ({
    scope: input.scope, sessionId: input.selection.sessionId, grantId: (await actGrant(input.selection)).id,
    capability: "computer.act" as const, bundleId, expiresAt: new Date(Date.now() + 60_000),
    controlEpoch: input.selection.controlEpoch,
  });
  const transportCalls: Array<{ holderId: string | null; selectionId: string; kind: string }> = [];
  const hostOptions: DesktopComputerControlHost = {
    store,
    transport: {
      connection: async deviceId => deviceId === device.id
        ? { deviceId, connectionId: replacementConnection, gatewayId: randomUUID() } : null,
      send: async (_binding, command) => {
        if (command.operation !== "computer.execute") throw new Error("unexpected command operation");
        transportCalls.push({
          holderId: command.body.holder_id, selectionId: command.body.selection_id,
          kind: command.body.request.kind,
        });
        return desktopExecutionResultSchema.parse({
          type: "command.result", id: command.id, operation: "computer.execute", ok: true,
          result: { kind: "quiesce", result: { quiesced: true } },
        });
      },
    },
    occupancy,
    authorize: async () => { throw new Error("authorization is not part of dispatch admission"); },
    verifyDispatch: (input, finalize) => verifyLocalComputerDispatch(db!, input, undefined, finalize),
    claimNativeCall: async () => true,
  };
  const computerControl = new DesktopComputerControl(hostOptions);
  // A separate instance starts with an empty process-local map, simulating a
  // different API replica for lifecycle cleanup.
  const otherReplica = new DesktopComputerControl(hostOptions);
  // Stateless store instance for cleanup calls started on another replica.
  const otherReplicaStore = new PrismaDesktopComputerControl(db, redisSelections, leases, occupancy);

  // Missing and revoked runs fail closed even while the database turn and
  // credential remain running.
  const missing = await createTurn();
  const missingScope: DesktopRunScope = {
    ...scope, conversationId: missing.conversation.id,
    runtimeGeneration: missing.conversation.runtimeGeneration,
    connectionId: replacementConnection, turnId: missing.turn.id,
  };
  await assert.rejects(
    store.select({ scope: missingScope, selectionId: randomUUID(), bundleId }), { code: "AUTH_REQUIRED" },
  );
  assert.equal((await store.scopesForTurn(missing.turn.id)).length, 0);

  const revokedRun = await runTurn();
  const revokedHolder = await putHolder(revokedRun.scope, revokedRun.selection);
  await leases.revoke(revokedRun.turn.id);
  assert.equal(await store.bindingLive(revokedRun.scope), false);
  assert.equal(
    (await db.localComputerSession.findUniqueOrThrow({ where: { id: revokedRun.selection.sessionId } })).status,
    "active",
  );
  let revokedSent = 0;
  assert.equal(await computerControl.admit({
    scope: revokedRun.scope, request: actRequest(), commandId: randomUUID(), sessionId: revokedRun.selection.sessionId,
    selectionId: revokedRun.selection.selectionId, holderId: revokedHolder,
    admission: await admissionFor(revokedRun),
  }, {
    mayDispatch: async () => true,
    finalize: () => { revokedSent += 1; return true; },
  }), false);
  assert.equal(revokedSent, 0);
  await assert.rejects(
    store.select({ scope: revokedRun.scope, selectionId: randomUUID(), bundleId }), { code: "AUTH_REQUIRED" },
  );
  await otherReplica.revokeTurn(revokedRun.turn.id);
  assert.equal(await store.read(revokedRun.scope), null);

  // A revoked grant refuses a same-id renewal without replacing the session,
  // grants, selection epoch, or holder. The exact old holder is still what
  // Stop quiesces, and a fresh deliberate pick with a new id is separate.
  const refusedRenewal = await runTurn();
  const refusedHolder = await putHolder(refusedRenewal.scope, refusedRenewal.selection);
  const refusedGrant = await actGrant(refusedRenewal.selection);
  await service.changePermission(actor, refusedRenewal.scope.conversationId, {
    action: "revoke", session_id: refusedRenewal.selection.sessionId, grant_id: refusedGrant.id,
  });
  const refusedBefore = await store.read(refusedRenewal.scope);
  if (!refusedBefore) throw new Error("selection missing");
  const refusedSessions = await db.localComputerSession.count({
    where: { conversationId: refusedRenewal.scope.conversationId, deviceId: device.id },
  });
  const refusedGrants = await db.computerPermissionGrant.count({
    where: { sessionId: refusedRenewal.selection.sessionId },
  });
  const refusedAck = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: refusedRenewal.scope.conversationId,
        turn_id: refusedRenewal.scope.turnId,
        selection_id: refusedRenewal.selection.selectionId, bundle_id: bundleId,
      },
    },
  });
  assert.equal(refusedAck.ok, false);
  if (refusedAck.ok) throw new Error("refused renewal was acknowledged");
  assert.equal(refusedAck.error_code, "COMPUTER_ACCESS_DENIED");
  assert.deepEqual(await store.read(refusedRenewal.scope), refusedBefore);
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: refusedRenewal.scope.conversationId, deviceId: device.id },
  }), refusedSessions);
  assert.equal(await db.computerPermissionGrant.count({
    where: { sessionId: refusedRenewal.selection.sessionId },
  }), refusedGrants);
  assert.notEqual((await db.computerPermissionGrant.findUniqueOrThrow({
    where: { id: refusedGrant.id },
  })).revokedAt, null);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: refusedRenewal.selection.sessionId },
  })).status, "active");
  assert.equal((await occupancy.read(device.id))?.holderId, refusedHolder);

  // Stop remains the exact safety control for the unchanged generation and
  // quiesces the holder that was live before the refused renewal.
  transportCalls.length = 0;
  const refusedStop = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "stop", conversation_id: refusedRenewal.scope.conversationId,
        turn_id: refusedRenewal.scope.turnId, selection_id: refusedRenewal.selection.selectionId,
      },
    },
  });
  assert.equal(refusedStop.ok, true);
  if (!refusedStop.ok) throw new Error("stop failed");
  assert.equal(refusedStop.data.state, "stopped");
  assert.deepEqual(transportCalls, [{
    holderId: refusedHolder, selectionId: refusedRenewal.selection.selectionId, kind: "quiesce",
  }]);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: refusedRenewal.selection.sessionId },
  })).status, "ended");
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);

  const freshSelectionId = randomUUID();
  const freshAfterRefusal = await store.select({
    scope: refusedRenewal.scope, selectionId: freshSelectionId, bundleId,
  });
  assert.equal(freshAfterRefusal.state, "active");
  assert.equal(freshAfterRefusal.selectionId, freshSelectionId);
  assert.notEqual(freshAfterRefusal.sessionId, refusedRenewal.selection.sessionId);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: freshAfterRefusal.sessionId },
  })).status, "active");
  await otherReplica.revokeScope(refusedRenewal.scope);

  // A committed resume receipt aliases only its exact still-active successor
  // under the locked authority: the recorded predecessor id stops the actual
  // successor and ends its session, while a missing, mismatched, stale, or
  // no-longer-active successor never revokes the current selection. An
  // already-active retry records nothing.
  const receiptRun = await runTurn();
  const receiptPredecessor = receiptRun.selection.selectionId;
  const receiptSuccessor = randomUUID();
  assert.equal((await store.pause({
    scope: receiptRun.scope, selectionId: receiptPredecessor,
  })).state, "pausing");
  await store.confirmPause({ scope: receiptRun.scope, selection: (await store.read(receiptRun.scope))! });
  const resumeReceipts: DesktopComputerResumeReceipt[] = [];
  const receiptResumed = await store.resume({
    scope: receiptRun.scope, selectionId: receiptPredecessor, newSelectionId: receiptSuccessor,
    onResumed: receipt => { resumeReceipts.push(receipt); },
  });
  assert.equal(receiptResumed.state, "active");
  assert.equal(receiptResumed.selectionId, receiptSuccessor);
  assert.equal(resumeReceipts.length, 1, "the committed resume recorded one receipt");
  const resumeReceipt = resumeReceipts[0]!;
  assert.equal(resumeReceipt.predecessor, receiptPredecessor);
  assert.equal(resumeReceipt.successor.selectionId, receiptSuccessor);
  assert.equal(resumeReceipt.successor.sessionId, receiptRun.selection.sessionId);

  // A later Pause of B is a client action on B. The delayed Stop that still
  // names A must not alias that paused B: a receipt is only for a committing
  // or just-active successor.
  assert.equal((await store.pause({
    scope: receiptRun.scope, selectionId: receiptSuccessor,
  })).state, "pausing");
  await store.confirmPause({ scope: receiptRun.scope, selection: (await store.read(receiptRun.scope))! });
  const pausedReceiptSelection = await store.read(receiptRun.scope);
  assert.equal(pausedReceiptSelection?.state, "paused");
  const pausedReceiptSession = await db.localComputerSession.findUniqueOrThrow({
    where: { id: receiptResumed.sessionId },
  });
  assert.equal(pausedReceiptSession.status, "active");
  await assert.rejects(store.stop({
    scope: receiptRun.scope, selectionId: receiptPredecessor, receipt: resumeReceipt,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  assert.deepEqual(await store.read(receiptRun.scope), pausedReceiptSelection);
  assert.deepEqual(await db.localComputerSession.findUniqueOrThrow({
    where: { id: receiptResumed.sessionId },
  }), pausedReceiptSession);

  // The next committed resume supplies the genuine receipt used for the
  // positive alias below; both receipts are captured from the store.
  const nextSuccessor = randomUUID();
  const nextReceipts: DesktopComputerResumeReceipt[] = [];
  const nextResumed = await store.resume({
    scope: receiptRun.scope, selectionId: receiptSuccessor, newSelectionId: nextSuccessor,
    onResumed: receipt => { nextReceipts.push(receipt); },
  });
  assert.equal(nextResumed.state, "active");
  assert.equal(nextResumed.selectionId, nextSuccessor);
  assert.equal(nextReceipts.length, 1);
  const nextReceipt = nextReceipts[0]!;

  // No receipt, a mismatched predecessor, or a different scope leaves the
  // exact successor active and its session usable.
  await assert.rejects(store.stop({
    scope: receiptRun.scope, selectionId: receiptSuccessor,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  await assert.rejects(store.stop({
    scope: receiptRun.scope, selectionId: randomUUID(), receipt: nextReceipt,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  await assert.rejects(store.stop({
    scope: { ...receiptRun.scope, turnId: randomUUID() },
    selectionId: receiptSuccessor, receipt: nextReceipt,
  }), { code: "COMPUTER_UNAVAILABLE" });
  assert.equal((await store.read(receiptRun.scope))?.state, "active");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: nextResumed.sessionId },
  })).status, "active");

  const receiptStopped = await store.stop({
    scope: receiptRun.scope, selectionId: receiptSuccessor, receipt: nextReceipt,
  });
  assert.equal(receiptStopped.state, "stopped");
  assert.equal(receiptStopped.selectionId, nextSuccessor);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: nextResumed.sessionId },
  })).status, "ended");

  // A fresh later selection is never revocable through the old predecessor
  // and the now-stale receipt.
  const receiptReplacement = await store.select({
    scope: receiptRun.scope, selectionId: randomUUID(), bundleId,
  });
  assert.equal(receiptReplacement.state, "active");
  await assert.rejects(store.stop({
    scope: receiptRun.scope, selectionId: receiptSuccessor, receipt: nextReceipt,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  assert.equal((await store.read(receiptRun.scope))?.selectionId, receiptReplacement.selectionId);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: receiptReplacement.sessionId },
  })).status, "active");

  // An idempotent already-active resume returns the stored successor without
  // a write and therefore never calls the receipt callback.
  const idempotentPredecessor = randomUUID();
  let idempotentReceipts = 0;
  const idempotentResume = await store.resume({
    scope: receiptRun.scope, selectionId: idempotentPredecessor, newSelectionId: receiptReplacement.selectionId,
    onResumed: () => { idempotentReceipts += 1; },
  });
  assert.equal(idempotentResume.selectionId, receiptReplacement.selectionId);
  assert.equal(idempotentReceipts, 0);
  await assert.rejects(store.stop({
    scope: receiptRun.scope, selectionId: idempotentPredecessor,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  await store.stop({ scope: receiptRun.scope, selectionId: receiptReplacement.selectionId });

  // A same-id renewal of successor B is a new generation, so the recorded A
  // receipt no longer aliases it: the delayed Stop naming A must refuse without
  // stopping or revoking B, while the exact B Stop still ends that session.
  const renewRun = await runTurn();
  const renewPredecessor = renewRun.selection.selectionId;
  const renewSuccessor = randomUUID();
  await store.pause({ scope: renewRun.scope, selectionId: renewPredecessor });
  await store.confirmPause({ scope: renewRun.scope, selection: (await store.read(renewRun.scope))! });
  const renewReceipts: DesktopComputerResumeReceipt[] = [];
  const renewResumed = await store.resume({
    scope: renewRun.scope, selectionId: renewPredecessor, newSelectionId: renewSuccessor,
    onResumed: receipt => { renewReceipts.push(receipt); },
  });
  assert.equal(renewReceipts.length, 1);
  const renewedSuccessor = await store.select({
    scope: renewRun.scope, selectionId: renewSuccessor, bundleId,
  });
  assert.equal(renewedSuccessor.sessionId, renewResumed.sessionId);
  assert.notEqual(renewedSuccessor.controlEpoch, renewResumed.controlEpoch);
  assert.ok(renewedSuccessor.expiresAt > renewResumed.expiresAt);
  await assert.rejects(store.stop({
    scope: renewRun.scope, selectionId: renewPredecessor, receipt: renewReceipts[0]!,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  const afterStaleReceipt = await store.read(renewRun.scope);
  assert.equal(afterStaleReceipt?.selectionId, renewSuccessor);
  assert.equal(afterStaleReceipt?.state, "active");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: renewResumed.sessionId },
  })).status, "active");
  assert.equal((await store.stop({
    scope: renewRun.scope, selectionId: renewSuccessor,
  })).state, "stopped");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: renewResumed.sessionId },
  })).status, "ended");

  // A first positive check followed by a revoke before the Lua CAS rolls the
  // speculative session/grant rows back and writes nothing.
  const race = await createTurn();
  const raceScope: DesktopRunScope = {
    ...scope, conversationId: race.conversation.id,
    runtimeGeneration: race.conversation.runtimeGeneration,
    connectionId: replacementConnection, turnId: race.turn.id,
  };
  await bindRun(raceScope);
  let firstCheck = true;
  const racingStore = new PrismaDesktopComputerControl(
    db, new DesktopComputerRedisSelection(redis.client),
    {
      hasActiveBinding: async value => {
        const live = await leases.hasActiveBinding(value);
        if (live && firstCheck) {
          firstCheck = false;
          await leases.revoke(value.turnId);
        }
        return live;
      },
    },
  );
  const sessionsBeforeRace = await db.localComputerSession.count({
    where: { conversationId: local.id, deviceId: device.id },
  });
  await assert.rejects(
    racingStore.select({ scope: raceScope, selectionId: randomUUID(), bundleId }),
    { code: "COMPUTER_UNAVAILABLE" },
  );
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: local.id, deviceId: device.id },
  }), sessionsBeforeRace);
  assert.equal(await store.read(raceScope), null);

  // A rebind to a different canonical connection between the first check and
  // the CAS is also rejected by the same Lua evaluation.
  const rebind = await createTurn();
  const rebindScope: DesktopRunScope = {
    ...scope, conversationId: rebind.conversation.id,
    runtimeGeneration: rebind.conversation.runtimeGeneration,
    connectionId: replacementConnection, turnId: rebind.turn.id,
  };
  await bindRun(rebindScope);
  let rebound = false;
  const reboundStore = new PrismaDesktopComputerControl(
    db, new DesktopComputerRedisSelection(redis.client),
    {
      hasActiveBinding: async value => {
        const live = await leases.hasActiveBinding(value);
        if (live && !rebound) {
          rebound = true;
          await writeRun({ ...value, connectionId: randomUUID() });
        }
        return live;
      },
    },
  );
  await assert.rejects(
    reboundStore.select({ scope: rebindScope, selectionId: randomUUID(), bundleId }),
    { code: "COMPUTER_UNAVAILABLE" },
  );
  assert.equal(await store.read(rebindScope), null);

  // An admitted act writes the durable pending marker. After the 45s holder
  // has elapsed, pause must still quiesce the exact recorded holder instead of
  // acknowledging without proof.
  const pending = await runTurn();
  const pendingHolder = await putHolder(pending.scope, pending.selection);
  let sent = 0;
  assert.equal(await computerControl.admit({
    scope: pending.scope, request: actRequest(), commandId: randomUUID(), sessionId: pending.selection.sessionId,
    selectionId: pending.selection.selectionId, holderId: pendingHolder,
    admission: await admissionFor(pending),
  }, {
    mayDispatch: async () => true,
    finalize: () => { sent += 1; return true; },
  }), true);
  assert.equal(sent, 1);
  assert.equal((await store.read(pending.scope))?.pendingInput?.holderId, pendingHolder);
  await redis.client.del(localComputerGuiOccupancyKey(device.id));
  transportCalls.length = 0;
  const pauseReceipts: DesktopComputerPauseReceipt[] = [];
  const pauseResult = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: pending.scope.conversationId,
        turn_id: pending.scope.turnId, selection_id: pending.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { pauseReceipts.push(receipt); },
  }, () => true);
  assert.equal(pauseResult.ok, true);
  if (!pauseResult.ok) throw new Error("pause failed");
  assert.equal(pauseResult.data.state, "paused");
  assert.deepEqual(transportCalls, [{
    holderId: pendingHolder, selectionId: pending.selection.selectionId, kind: "quiesce",
  }]);
  assert.equal((await store.read(pending.scope))?.pendingInput, null);
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);
  const pendingPaused = await store.read(pending.scope);
  assert.equal(pendingPaused?.state, "paused");
  assert.equal(pauseReceipts.length, 1);
  const pauseReceipt = pauseReceipts[0]!;
  assert.equal(pauseReceipt.ownerId, owner.id);
  assert.equal(pauseReceipt.sessionId, pending.selection.sessionId);
  assert.equal(pauseReceipt.selectionId, pending.selection.selectionId);
  assert.equal(pauseReceipt.controlEpoch, pendingPaused?.controlEpoch);
  assert.ok(pauseReceipt.acknowledgedAt instanceof Date);
  // Only an accepted positive Pause reply reaches the audit writer; the row is
  // idempotent by its existing primary key and carries no metadata.
  assert.equal(await db.auditLog.count({ where: { action: "computer_session_paused" } }), 0);
  await recordDesktopComputerPauseAudit(auditDb, pauseReceipt);
  await recordDesktopComputerPauseAudit(auditDb, pauseReceipt);
  const pauseRows = await db.auditLog.findMany({ where: { action: "computer_session_paused" } });
  assert.equal(pauseRows.length, 1, "a repeated Pause audit write stays one row");
  const [pauseRow] = pauseRows;
  if (!pauseRow) throw new Error("pause audit row missing");
  assert.equal(pauseRow.id, desktopComputerPauseAuditId(pauseReceipt));
  assert.equal(pauseRow.actorId, owner.id);
  assert.equal(pauseRow.action, "computer_session_paused");
  assert.equal(pauseRow.targetType, "local_computer_session");
  assert.equal(pauseRow.targetId, pending.selection.sessionId);
  assert.equal(pauseRow.result, "success");
  assert.deepEqual(pauseRow.metadataJson, {});
  assert.equal(pauseRow.createdAt.getTime(), pauseReceipt.acknowledgedAt.getTime(),
    "the row time is the accepted reply time, not the asynchronous insert order");
  assert.equal(pauseRow.ipAddress, null);
  assert.equal(pauseRow.userAgent, null);
  assert.equal(JSON.stringify(pauseRow).includes(bundleId), false);
  assert.equal(JSON.stringify(pauseRow).includes(pending.selection.selectionId), false);

  // A duplicate Pause with a fresh request id is idempotent and maps to the
  // same trusted generation, so the database keeps the one existing row.
  const repeatedPause = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: pending.scope.conversationId,
        turn_id: pending.scope.turnId, selection_id: pending.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { pauseReceipts.push(receipt); },
  }, () => true);
  assert.equal(repeatedPause.ok, true);
  assert.equal(pauseReceipts.length, 2);
  assert.equal(desktopComputerPauseAuditId(pauseReceipts[1]!), desktopComputerPauseAuditId(pauseReceipt));
  assert.equal(pauseReceipts[1]!.controlEpoch, pauseReceipt.controlEpoch);
  await recordDesktopComputerPauseAudit(auditDb, pauseReceipts[1]!);
  assert.equal(await db.auditLog.count({ where: { action: "computer_session_paused" } }), 1);

  // A native quiesce failure is not a Pause: no receipt and no success row.
  const failedPause = await runTurn();
  const failedPauseHolder = await putHolder(failedPause.scope, failedPause.selection);
  const failingControl = new DesktopComputerControl({
    ...hostOptions,
    transport: {
      connection: hostOptions.transport.connection,
      send: async (_binding, command) => desktopExecutionResultSchema.parse({
        type: "command.result", id: command.id, operation: "computer.execute", ok: false,
        error_code: "COMPUTER_ACTION_FAILED",
      }),
    },
  });
  const failedPauseReceipts: DesktopComputerPauseReceipt[] = [];
  const failedPauseResult = await failingControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: failedPause.scope.conversationId,
        turn_id: failedPause.scope.turnId, selection_id: failedPause.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { failedPauseReceipts.push(receipt); },
  }, () => true);
  assert.equal(failedPauseResult.ok, false);
  assert.equal(failedPauseReceipts.length, 0);
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: failedPause.selection.sessionId },
  }), 0);
  assert.equal((await occupancy.read(device.id))?.holderId, failedPauseHolder);
  await otherReplica.revokeScope(failedPause.scope);

  // A credential that goes stale before the final reply recheck suppresses the
  // acknowledgement and therefore the success row.
  const stalePause = await runTurn();
  const stalePauseReceipts: DesktopComputerPauseReceipt[] = [];
  let staleCredentialChecks = 0;
  const stalePauseResult = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => ++staleCredentialChecks < 2,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: stalePause.scope.conversationId,
        turn_id: stalePause.scope.turnId, selection_id: stalePause.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { stalePauseReceipts.push(receipt); },
  }, () => true);
  assert.equal(stalePauseResult.ok, false);
  assert.equal(staleCredentialChecks, 2);
  assert.equal(stalePauseReceipts.length, 0);
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: stalePause.selection.sessionId },
  }), 0);
  await otherReplica.revokeScope(stalePause.scope);
  await otherReplica.revokeTurn(pending.turn.id);

  // Only explicit receiver acceptance is a Pause claim. An absent delivery
  // continuation keeps the existing successful reply but publishes no receipt;
  // a refused continuation fails the reply and likewise publishes none.
  const absentDeliveryRun = await runTurn();
  const absentDeliveryReceipts: DesktopComputerPauseReceipt[] = [];
  const absentDeliveryResult = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: absentDeliveryRun.scope.conversationId,
        turn_id: absentDeliveryRun.scope.turnId, selection_id: absentDeliveryRun.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { absentDeliveryReceipts.push(receipt); },
  });
  assert.equal(absentDeliveryResult.ok, true);
  assert.equal(absentDeliveryReceipts.length, 0);
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: absentDeliveryRun.selection.sessionId },
  }), 0);
  await otherReplica.revokeScope(absentDeliveryRun.scope);

  const refusedDeliveryRun = await runTurn();
  const refusedDeliveryReceipts: DesktopComputerPauseReceipt[] = [];
  const refusedDeliveryResult = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "pause", conversation_id: refusedDeliveryRun.scope.conversationId,
        turn_id: refusedDeliveryRun.scope.turnId, selection_id: refusedDeliveryRun.selection.selectionId,
      },
    },
    onPauseAcknowledged: receipt => { refusedDeliveryReceipts.push(receipt); },
  }, () => false);
  assert.equal(refusedDeliveryResult.ok, false);
  assert.equal(refusedDeliveryReceipts.length, 0);
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: refusedDeliveryRun.selection.sessionId },
  }), 0);
  await otherReplica.revokeScope(refusedDeliveryRun.scope);

  // The server-controlled control epoch separates repeated valid cycles through
  // the same native selection id. Each true paused->active resume rotates it,
  // so A -> Pause(A) -> Resume(B) -> Pause(B) -> Resume(A) -> Pause(A) is three
  // claims, while an idempotent repeat of the live paused generation stays one.
  const identityRun = await runTurn();
  const identityA = identityRun.selection.selectionId;
  const identityB = randomUUID();
  const pauseOnce = async (selectionId: string) => {
    const paused = await store.pause({ scope: identityRun.scope, selectionId });
    return paused.state === "paused"
      ? paused
      : await store.confirmPause({ scope: identityRun.scope, selection: paused });
  };
  const identityReceipt = (selection: DesktopComputerSelection): DesktopComputerPauseReceipt => ({
    ownerId: owner.id, sessionId: selection.sessionId, selectionId: selection.selectionId,
    controlEpoch: selection.controlEpoch, acknowledgedAt: new Date(),
  });
  const pausedIdentityA = await pauseOnce(identityA);
  const firstPauseReceipt = identityReceipt(pausedIdentityA);
  const resumedIdentityB = await store.resume({
    scope: identityRun.scope, selectionId: identityA, newSelectionId: identityB,
  });
  assert.notEqual(resumedIdentityB.controlEpoch, pausedIdentityA.controlEpoch,
    "a true paused->active resume rotates the server control epoch");
  const pausedIdentityB = await pauseOnce(identityB);
  const resumedIdentityA = await store.resume({
    scope: identityRun.scope, selectionId: identityB, newSelectionId: identityA,
  });
  assert.notEqual(resumedIdentityA.controlEpoch, resumedIdentityB.controlEpoch);
  const pausedIdentityAgain = await pauseOnce(identityA);
  const secondPauseReceipt = identityReceipt(pausedIdentityB);
  const thirdPauseReceipt = identityReceipt(pausedIdentityAgain);
  assert.notEqual(
    desktopComputerPauseAuditId(secondPauseReceipt), desktopComputerPauseAuditId(firstPauseReceipt),
    "pausing B after resuming from A is a separate claim",
  );
  assert.notEqual(
    desktopComputerPauseAuditId(thirdPauseReceipt), desktopComputerPauseAuditId(firstPauseReceipt),
    "pausing A again after resuming back from B is a separate claim",
  );
  await recordDesktopComputerPauseAudit(auditDb, firstPauseReceipt);
  await recordDesktopComputerPauseAudit(auditDb, secondPauseReceipt);
  await recordDesktopComputerPauseAudit(auditDb, thirdPauseReceipt);
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: identityRun.selection.sessionId },
  }), 3);
  // A repeat of the exact live paused generation is not a new claim.
  const repeatedIdentityPause = await pauseOnce(identityA);
  assert.equal(repeatedIdentityPause.controlEpoch, pausedIdentityAgain.controlEpoch);
  await recordDesktopComputerPauseAudit(auditDb, identityReceipt(repeatedIdentityPause));
  assert.equal(await db.auditLog.count({
    where: { action: "computer_session_paused", targetId: identityRun.selection.sessionId },
  }), 3);
  await otherReplica.revokeScope(identityRun.scope);

  // A real competing transaction holds the exact deterministic PAUSE audit
  // primary key. The writer's PostgreSQL statement timeout must reject it while
  // that transaction is still open and leave no committed row, and an unrelated
  // exact Stop (which writes its own audit row in the same table) must still
  // settle without waiting for this PAUSE row.
  const lockedRun = await runTurn();
  await store.pause({ scope: lockedRun.scope, selectionId: lockedRun.selection.selectionId });
  const lockedPausedSelection = await store.confirmPause({
    scope: lockedRun.scope, selection: (await store.read(lockedRun.scope))!,
  });
  const lockedReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: lockedPausedSelection.sessionId,
    selectionId: lockedPausedSelection.selectionId,
    controlEpoch: lockedPausedSelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const lockedAuditId = desktopComputerPauseAuditId(lockedReceipt);
  let releaseLockedRow!: () => void;
  const lockedRowHeld = new Promise<void>(resolve => { releaseLockedRow = resolve; });
  let lockedRowInserted = false;
  const lockingTransaction = db.$transaction(async tx => {
    await tx.auditLog.create({
      data: {
        id: lockedAuditId, actorId: owner.id, action: "computer_session_paused",
        targetType: "local_computer_session", targetId: lockedPausedSelection.sessionId,
        result: "success", metadataJson: {},
      },
    });
    lockedRowInserted = true;
    await lockedRowHeld;
    // Roll back the exact held row; the writer must have given up first.
    throw new Error("pause audit lock fixture rollback");
  }, { maxWait: 5_000, timeout: 30_000 }).catch(() => undefined);
  await waitUntil("the locked audit row to be inserted", 5_000, async () => lockedRowInserted);
  const settleOutcome = (promise: Promise<unknown>, ms: number): Promise<"settled" | "timeout"> => {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      promise.then(() => "settled" as const, () => "settled" as const),
      new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), ms); }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
  };
  let lockedWriter: Promise<void> | undefined;
  try {
    let rejection: unknown;
    lockedWriter = recordDesktopComputerPauseAudit(auditDb, lockedReceipt).catch(error => {
      rejection = error;
    });
    assert.equal(
      await settleOutcome(lockedWriter!, 5_000), "settled",
      "the blocked Pause audit insert must settle inside its DB timeout",
    );
    assert.ok(rejection instanceof Error, "the blocked Pause audit insert must reject");
    assert.match(rejection.message, /57014/,
      "the dedicated audit client's PostgreSQL statement timeout aborted the blocked insert");
    assert.equal(await db.auditLog.count({ where: { id: lockedAuditId } }), 0,
      "a rejected blocked insert leaves no committed row");

    const stopWhilePauseRowLocked = await computerControl.handle({
      ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: {
          action: "stop", conversation_id: lockedRun.scope.conversationId,
          turn_id: lockedRun.scope.turnId, selection_id: lockedPausedSelection.selectionId,
        },
      },
    }, () => true);
    assert.equal(stopWhilePauseRowLocked.ok, true, "an unrelated exact Stop must settle");
    if (!stopWhilePauseRowLocked.ok) throw new Error("stop while the Pause row was locked failed");
    assert.equal(stopWhilePauseRowLocked.data.state, "stopped");
    assert.equal(await db.auditLog.count({
      where: { action: "computer_session_stopped", targetId: lockedPausedSelection.sessionId },
    }), 1);
  } finally {
    releaseLockedRow();
    await lockingTransaction;
    if (lockedWriter) await lockedWriter;
  }
  assert.equal(await db.auditLog.count({ where: { id: lockedAuditId } }), 0,
    "the rolled-back fixture row never appears");
  await otherReplica.revokeScope(lockedRun.scope);

  // The dedicated audit client has one real pg connection. While that
  // connection is held, a second Pause write must fail from the driver's
  // connectionTimeoutMillis, before Prisma's longer maxWait, and remove its
  // waiter. The shared application pool is independent, so the exact Stop
  // still settles and the failed acquire can never write its row later.
  const acquisitionRun = await runTurn();
  await store.pause({ scope: acquisitionRun.scope, selectionId: acquisitionRun.selection.selectionId });
  const acquisitionSelection = await store.confirmPause({
    scope: acquisitionRun.scope, selection: (await store.read(acquisitionRun.scope))!,
  });
  const acquisitionReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: acquisitionSelection.sessionId,
    selectionId: acquisitionSelection.selectionId,
    controlEpoch: acquisitionSelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const acquisitionAuditId = desktopComputerPauseAuditId(acquisitionReceipt);
  const acquisitionAuditFactory = new PrismaPg({
    connectionString: databaseUrl("computer_control"),
    ...desktopComputerPauseAuditPoolConfig,
  });
  // Reuse the adapter's own typed pg pool; pg types are only a transitive
  // dependency of the adapter, not an API test dependency.
  const acquisitionAuditAdapter = await acquisitionAuditFactory.connect();
  const acquisitionAuditPool = acquisitionAuditAdapter.underlyingDriver();
  const acquisitionAuditDb = new PrismaClient({
    adapter: {
      provider: acquisitionAuditFactory.provider,
      adapterName: acquisitionAuditFactory.adapterName,
      connect: async () => acquisitionAuditAdapter,
    },
    log: [],
  });
  let releaseAuditConnection!: () => void;
  const auditConnectionHeld = new Promise<void>(resolve => { releaseAuditConnection = resolve; });
  let auditConnectionReady!: () => void;
  const auditConnectionReadyPromise = new Promise<void>(resolve => { auditConnectionReady = resolve; });
  let holdOpen = true;
  const holdingTransaction = acquisitionAuditDb.$transaction(async tx => {
    await tx.$queryRawUnsafe("SELECT 1");
    auditConnectionReady();
    await auditConnectionHeld;
  }, { maxWait: 5_000, timeout: 30_000 }).finally(() => { holdOpen = false; });
  try {
    await auditConnectionReadyPromise;
    assert.equal(acquisitionAuditPool.totalCount, 1);
    assert.equal(acquisitionAuditPool.waitingCount, 0);
    let acquisitionRejection: unknown;
    const acquisitionWriter = recordDesktopComputerPauseAudit(acquisitionAuditDb, acquisitionReceipt)
      .catch(error => { acquisitionRejection = error; });
    assert.equal(
      await settleOutcome(acquisitionWriter, 5_000), "settled",
      "the queued audit acquire must settle while its only connection is held",
    );
    assert.equal(holdOpen, true, "the audit connection was still held when the writer rejected");
    assert.ok(acquisitionRejection instanceof Error, "the queued audit acquire must reject");
    assert.match(acquisitionRejection.message, /timeout exceeded when trying to connect/,
      "the driver acquisition timeout, not Prisma's maxWait, rejects the queued writer");
    assert.equal(acquisitionAuditPool.waitingCount, 0,
      "the driver removed the timed-out waiter instead of leaving an orphan acquire");
    assert.equal(acquisitionAuditPool.idleCount, 0);

    const stopWhileAuditHeld = await computerControl.handle({
      ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: {
          action: "stop", conversation_id: acquisitionRun.scope.conversationId,
          turn_id: acquisitionRun.scope.turnId, selection_id: acquisitionSelection.selectionId,
        },
      },
    }, () => true);
    assert.equal(stopWhileAuditHeld.ok, true, "the shared pool still serves the exact Stop");
    if (!stopWhileAuditHeld.ok) throw new Error("stop while the audit connection was held failed");
    assert.equal(stopWhileAuditHeld.data.state, "stopped");
    assert.equal(await db.auditLog.count({
      where: { action: "computer_session_stopped", targetId: acquisitionSelection.sessionId },
    }), 1);

    // Releasing the held connection must not wake a queued writer or insert
    // the deterministic Pause row after its acquisition already timed out.
    releaseAuditConnection();
    releaseAuditConnection = () => {};
    await holdingTransaction;
    await new Promise<void>(resolve => setTimeout(resolve, 750));
    assert.equal(acquisitionAuditPool.waitingCount, 0);
    assert.equal(await db.auditLog.count({ where: { id: acquisitionAuditId } }), 0,
      "a timed-out acquire never writes the Pause row later");
  } finally {
    releaseAuditConnection();
    await holdingTransaction.catch(() => undefined);
    await acquisitionAuditDb.$disconnect().catch(() => undefined);
    await acquisitionAuditPool.end().catch(() => undefined);
  }
  await otherReplica.revokeScope(acquisitionRun.scope);

  // DATABASE_URL can disable the server-side statement timeout at session
  // scope: pg 8.23.1 parses the connection string after the pool config, and
  // startup options can also carry `-c statement_timeout=0`. The writer must
  // set its own short timeout on the transaction so the blocked INSERT still
  // aborts while the exact audit primary key is locked.
  const hostileRun = await runTurn();
  await store.pause({ scope: hostileRun.scope, selectionId: hostileRun.selection.selectionId });
  const hostileSelection = await store.confirmPause({
    scope: hostileRun.scope, selection: (await store.read(hostileRun.scope))!,
  });
  const hostileReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: hostileSelection.sessionId,
    selectionId: hostileSelection.selectionId,
    controlEpoch: hostileSelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const hostileAuditId = desktopComputerPauseAuditId(hostileReceipt);
  const hostileUrl = new URL(databaseUrl("computer_control"));
  hostileUrl.searchParams.set("statement_timeout", "0");
  hostileUrl.searchParams.set("options", "-c statement_timeout=0");
  const hostileAuditDb = createDesktopComputerPauseAuditClient(hostileUrl.toString());
  let releaseHostileRow!: () => void;
  const hostileRowHeld = new Promise<void>(resolve => { releaseHostileRow = resolve; });
  let hostileRowInserted = false;
  const hostileLocking = db.$transaction(async tx => {
    await tx.auditLog.create({
      data: {
        id: hostileAuditId, actorId: owner.id, action: "computer_session_paused",
        targetType: "local_computer_session", targetId: hostileSelection.sessionId,
        result: "success", metadataJson: {},
      },
    });
    hostileRowInserted = true;
    await hostileRowHeld;
    throw new Error("hostile statement timeout fixture rollback");
  }, { maxWait: 5_000, timeout: 30_000 }).catch(() => undefined);
  let hostileWriter: Promise<void> | undefined;
  try {
    const sessionTimeout = await hostileAuditDb.$queryRaw<Array<{ timeout: string }>>`
      SELECT current_setting('statement_timeout') AS timeout`;
    assert.equal(sessionTimeout[0]?.timeout, "0",
      "the hostile connection URL disables the session-level statement timeout");
    await waitUntil("the hostile audit row to be inserted", 5_000, async () => hostileRowInserted);
    let rejection: unknown;
    hostileWriter = recordDesktopComputerPauseAudit(hostileAuditDb, hostileReceipt)
      .catch(error => { rejection = error; });
    assert.equal(await settleOutcome(hostileWriter, 5_000), "settled",
      "the blocked Pause audit insert settles despite the disabled session statement timeout");
    assert.ok(rejection instanceof Error, "the blocked Pause audit insert must reject");
    assert.match(rejection.message, /57014/,
      "the transaction-local statement timeout aborted the blocked insert while the row was locked");
    assert.equal(await db.auditLog.count({ where: { id: hostileAuditId } }), 0,
      "a rejected blocked insert leaves no committed row");
  } finally {
    releaseHostileRow();
    await hostileLocking;
    if (hostileWriter) await settleOutcome(hostileWriter.catch(() => undefined), 3_000);
    await settleOutcome(hostileAuditDb.$disconnect().catch(() => undefined), 3_000);
  }
  await otherReplica.revokeScope(hostileRun.scope);

  // A connected but silent server must not keep the Pause audit writer, its
  // pg connection, or Prisma shutdown pending. The loopback proxy forwards the
  // request to the real disposable PostgreSQL; pg_stat_activity proves the
  // exact audit INSERT is waiting on the held row before only its responses
  // are dropped.
  const silentRun = await runTurn();
  await store.pause({ scope: silentRun.scope, selectionId: silentRun.selection.selectionId });
  const silentSelection = await store.confirmPause({
    scope: silentRun.scope, selection: (await store.read(silentRun.scope))!,
  });
  const silentReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: silentSelection.sessionId,
    selectionId: silentSelection.selectionId,
    controlEpoch: silentSelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const silentAuditId = desktopComputerPauseAuditId(silentReceipt);
  const auditSessionPids = async () => new Set(
    (await db!.$queryRaw<Array<{ pid: number }>>`
      SELECT pid FROM pg_stat_activity
      WHERE application_name = ${desktopComputerPauseAuditPoolConfig.application_name}`)
      .map(row => Number(row.pid)),
  );
  const baselineAuditPids = await auditSessionPids();
  let releaseSilentRow!: () => void;
  const silentRowHeld = new Promise<void>(resolve => { releaseSilentRow = resolve; });
  let silentRowInserted = false;
  const silentLocking = db.$transaction(async tx => {
    await tx.auditLog.create({
      data: {
        id: silentAuditId, actorId: owner.id, action: "computer_session_paused",
        targetType: "local_computer_session", targetId: silentSelection.sessionId,
        result: "success", metadataJson: {},
      },
    });
    silentRowInserted = true;
    await silentRowHeld;
    throw new Error("silent transport fixture rollback");
  }, { maxWait: 5_000, timeout: 30_000 }).catch(() => undefined);
  await waitUntil("the silent audit row to be inserted", 5_000, async () => silentRowInserted);
  const proxy = await createAuditTransportProxy(port);
  const transportAuditDb = createDesktopComputerPauseAuditClient(proxy.url("computer_control"));
  let silentWriter: Promise<void> | undefined;
  let silentRejection: unknown;
  try {
    silentWriter = recordDesktopComputerPauseAudit(transportAuditDb, silentReceipt)
      .catch(error => { silentRejection = error; });
    // Positive signal only: the real backend must show the exact INSERT
    // waiting on the held audit row in pg_stat_activity before responses drop.
    await waitUntil("the audit INSERT to wait on the held audit row", 5_000, async () => {
      const active = await db!.$queryRaw<Array<{ wait_event_type: string | null; query: string }>>`
        SELECT wait_event_type, query FROM pg_stat_activity
        WHERE application_name = ${desktopComputerPauseAuditPoolConfig.application_name}
          AND state = 'active'`;
      return active.some(row =>
        row.wait_event_type === "Lock" && String(row.query).includes("audit_logs"));
    });
    // The INSERT is provably in flight on the real server. Lose only the
    // responses; requests and the server-side query keep going.
    proxy.dropServerBytes();

    // The ordinary shared pool is independent: the exact Stop still settles
    // and writes its own audit row while the Pause audit transport is silent.
    const stopDuringSilence = await computerControl.handle({
      ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: {
          action: "stop", conversation_id: silentRun.scope.conversationId,
          turn_id: silentRun.scope.turnId, selection_id: silentSelection.selectionId,
        },
      },
    }, () => true);
    assert.equal(stopDuringSilence.ok, true, "the shared pool still serves the exact Stop");
    if (!stopDuringSilence.ok) throw new Error("stop during the silent audit transport failed");
    assert.equal(stopDuringSilence.data.state, "stopped");
    assert.equal(await db.auditLog.count({
      where: { action: "computer_session_stopped", targetId: silentSelection.sessionId },
    }), 1);

    // The transport deadline destroys the actual socket, so the pending write
    // rejects and the pool/Prisma closure finishes without an outer timeout.
    assert.equal(await settleOutcome(silentWriter, 6_000), "settled",
      "a silent server must not keep the Pause audit writer pending");
    assert.ok(silentRejection instanceof Error, "the silent Pause audit write must reject");
    assert.equal(await settleOutcome(proxy.waitForClientClose(), 3_000), "settled",
      "the dedicated audit transport's actual socket closes");
    // settleOutcome maps rejection to "settled"; require the disconnect itself
    // to fulfill within the same deadline.
    const auditClientClosed = transportAuditDb.$disconnect();
    assert.equal(await settleOutcome(auditClientClosed, 5_000), "settled",
      "the dedicated audit client closes after the transport deadline");
    await auditClientClosed;
    assert.equal(proxy.activeConnections(), 0,
      "the fixture proxy observes no leaked audit connection before force cleanup");
  } finally {
    // Fixture-only deadline: never let a broken candidate hang the white-box.
    proxy.destroyConnections();
    releaseSilentRow();
    await silentLocking;
    if (silentWriter) await settleOutcome(silentWriter.catch(() => undefined), 3_000);
    await settleOutcome(transportAuditDb.$disconnect().catch(() => undefined), 5_000);
    await proxy.close();
  }
  assert.equal(await db.auditLog.count({ where: { id: silentAuditId } }), 0,
    "the transport-killed Pause audit left no committed row");
  // A healthy writer retries the deterministic key and records it exactly once.
  await recordDesktopComputerPauseAudit(auditDb, silentReceipt);
  assert.equal(await db.auditLog.count({ where: { id: silentAuditId } }), 1,
    "a later healthy write records the same Pause generation exactly once");
  await waitUntil("the killed audit sessions to be reaped", 5_000, async () => {
    const current = await auditSessionPids();
    return [...current].every(pid => baselineAuditPids.has(pid));
  });
  await otherReplica.revokeScope(silentRun.scope);

  // Prisma 7.10.1 starts the acquisition maxWait timer before the pg adapter
  // sends BEGIN. A server that accepts the connection and then stalls only
  // that BEGIN must not make Prisma reject before the dedicated transport
  // deadline releases the checked-out connection: with the route's serialized
  // admission, the next accepted receipt would start while the old checkout
  // still occupies the one-connection pool and lose pg-pool's own 500 ms
  // acquisition timeout. The proxy forwards the real BEGIN and withholds only
  // that connection's responses; a distinct second receipt must still commit.
  const stalledRun = await runTurn();
  await store.pause({ scope: stalledRun.scope, selectionId: stalledRun.selection.selectionId });
  const stalledSelection = await store.confirmPause({
    scope: stalledRun.scope, selection: (await store.read(stalledRun.scope))!,
  });
  const stalledReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: stalledSelection.sessionId,
    selectionId: stalledSelection.selectionId,
    controlEpoch: stalledSelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const healthyRun = await runTurn();
  await store.pause({ scope: healthyRun.scope, selectionId: healthyRun.selection.selectionId });
  const healthySelection = await store.confirmPause({
    scope: healthyRun.scope, selection: (await store.read(healthyRun.scope))!,
  });
  const healthyReceipt: DesktopComputerPauseReceipt = {
    ownerId: owner.id, sessionId: healthySelection.sessionId,
    selectionId: healthySelection.selectionId,
    controlEpoch: healthySelection.controlEpoch, acknowledgedAt: new Date(),
  };
  const stalledAuditId = desktopComputerPauseAuditId(stalledReceipt);
  const healthyAuditId = desktopComputerPauseAuditId(healthyReceipt);
  assert.notEqual(stalledAuditId, healthyAuditId,
    "the two accepted Pause receipts have distinct audit identities");
  const admissionProxy = await createAuditTransportProxy(port);
  const admissionAuditDb = createDesktopComputerPauseAuditClient(admissionProxy.url("computer_control"));
  const admissionBaselinePids = await auditSessionPids();
  // The route admits Pause audits through pLimit(1); reuse that exact
  // serialization so the second write starts only when the first settles.
  const admission = pLimit(1);
  let stalledRejection: unknown;
  let healthyRejection: unknown;
  let stalledPid: number | undefined;
  let stalledWriter: Promise<void> | undefined;
  let healthyWriter: Promise<void> | undefined;
  try {
    admissionProxy.stallFirstBegin();
    stalledWriter = admission(() => recordDesktopComputerPauseAudit(admissionAuditDb, stalledReceipt))
      .catch(error => { stalledRejection = error; });
    healthyWriter = admission(() => recordDesktopComputerPauseAudit(admissionAuditDb, healthyReceipt))
      .catch(error => { healthyRejection = error; });
    // Positive, bounded fixture synchronization: the proxy forwarded the exact
    // BEGIN, and the real backend is idle inside that open transaction.
    await waitUntil("the proxy to forward the audit BEGIN", 5_000, async () =>
      admissionProxy.firstBeginForwarded());
    await waitUntil("the audit BEGIN to reach the real backend", 5_000, async () => {
      const rows = await db!.$queryRaw<Array<{ pid: number }>>`
        SELECT pid FROM pg_stat_activity
        WHERE application_name = ${desktopComputerPauseAuditPoolConfig.application_name}
          AND state = 'idle in transaction' AND query = 'BEGIN'`;
      stalledPid = rows.map(row => Number(row.pid)).find(pid => !admissionBaselinePids.has(pid));
      return stalledPid !== undefined;
    });
    assert.equal(await settleOutcome(stalledWriter, 6_000), "settled",
      "the stalled BEGIN settles within the transport deadline");
    assert.ok(stalledRejection instanceof Error, "the stalled BEGIN write must reject");
    assert.equal(await settleOutcome(healthyWriter, 6_000), "settled",
      "the next admitted healthy receipt settles");
    assert.equal(healthyRejection, undefined,
      "the next admitted write must not fail on the old checkout's acquisition");
    assert.equal(await db.auditLog.count({ where: { id: stalledAuditId } }), 0,
      "the stalled BEGIN never committed a row");
    const healthyRows = await db.auditLog.findMany({ where: { id: healthyAuditId } });
    assert.equal(healthyRows.length, 1, "the healthy receipt is recorded exactly once");
    assert.equal(healthyRows[0]?.targetId, healthySelection.sessionId);
    assert.equal(await db.auditLog.count({
      where: { id: { in: [stalledAuditId, healthyAuditId] } },
    }), 1, "only the second accepted receipt produced a row");

    // The stalled transport is the one that closed; the client and its server
    // session must not linger after the healthy receipt.
    assert.equal(await settleOutcome(admissionProxy.waitForClientClose(), 3_000), "settled",
      "the stalled audit transport's actual socket closes");
    const admissionClientClosed = admissionAuditDb.$disconnect();
    assert.equal(await settleOutcome(admissionClientClosed, 5_000), "settled",
      "the dedicated audit client disconnects after the stalled connection ends");
    await admissionClientClosed;
    assert.equal(admissionProxy.activeConnections(), 0,
      "the fixture proxy observes no leaked audit connection");
    await waitUntil("the stalled audit backend to be reaped", 5_000, async () => {
      const current = await auditSessionPids();
      return stalledPid === undefined || !current.has(stalledPid);
    });
  } finally {
    admissionProxy.destroyConnections();
    if (stalledWriter) await settleOutcome(stalledWriter.catch(() => undefined), 3_000);
    if (healthyWriter) await settleOutcome(healthyWriter.catch(() => undefined), 3_000);
    await settleOutcome(admissionAuditDb.$disconnect().catch(() => undefined), 5_000);
    await admissionProxy.close();
  }
  await otherReplica.revokeScope(stalledRun.scope);
  await otherReplica.revokeScope(healthyRun.scope);

  // Stop has the same proof requirement: after the holder TTL elapsed it
  // quiesces the exact recorded holder before reporting stopped.
  const stopPending = await runTurn();
  const stopPendingHolder = await putHolder(stopPending.scope, stopPending.selection);
  let stopPendingSent = 0;
  assert.equal(await computerControl.admit({
    scope: stopPending.scope, request: actRequest(), commandId: randomUUID(), sessionId: stopPending.selection.sessionId,
    selectionId: stopPending.selection.selectionId, holderId: stopPendingHolder,
    admission: await admissionFor(stopPending),
  }, {
    mayDispatch: async () => true,
    finalize: () => { stopPendingSent += 1; return true; },
  }), true);
  assert.equal(stopPendingSent, 1);
  await redis.client.del(localComputerGuiOccupancyKey(device.id));
  transportCalls.length = 0;
  const stopPendingResult = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "stop", conversation_id: stopPending.scope.conversationId,
        turn_id: stopPending.scope.turnId, selection_id: stopPending.selection.selectionId,
      },
    },
  });
  assert.equal(stopPendingResult.ok, true);
  if (!stopPendingResult.ok) throw new Error("stop failed");
  assert.equal(stopPendingResult.data.state, "stopped");
  assert.deepEqual(transportCalls, [{
    holderId: stopPendingHolder, selectionId: stopPending.selection.selectionId, kind: "quiesce",
  }]);
  assert.equal((await store.read(stopPending.scope))?.pendingInput, null);
  await otherReplica.revokeScope(stopPending.scope);

  // A paused predecessor left by a pre-fix Pause can retain the admitted-input
  // marker (with its holder TTL already elapsed) or the exact orphaned holder
  // while its marker is the known-idle null. Resume must refuse both without
  // writing or recording a receipt; the exact Stop must still revoke A,
  // quiesce the recorded holder, and release only that holder.
  for (const retained of ["marker", "holder"] as const) {
    const parked = await runTurn();
    const parkedHolder = await putHolder(parked.scope, parked.selection);
    let parkedCommandId: string | undefined;
    if (retained === "marker") {
      parkedCommandId = randomUUID();
      assert.equal(await store.claimInput({
        scope: parked.scope, selection: parked.selection,
        holderId: parkedHolder, commandId: parkedCommandId,
      }), true);
      // The marker outlives the holder TTL and alone names the exact holder.
      await redis.client.del(localComputerGuiOccupancyKey(device.id));
    }
    await store.pause({ scope: parked.scope, selectionId: parked.selection.selectionId });
    await store.confirmPause({ scope: parked.scope, selection: (await store.read(parked.scope))! });
    const parkedBeforeResume = await store.read(parked.scope);
    assert.equal(parkedBeforeResume?.state, "paused");
    if (retained === "marker") {
      assert.equal(parkedBeforeResume?.pendingInput?.commandId, parkedCommandId);
      assert.equal(parkedBeforeResume?.pendingInput?.holderId, parkedHolder);
      assert.equal(await occupancy.read(device.id), null);
    } else {
      assert.equal(parkedBeforeResume?.pendingInput, null);
      assert.equal((await occupancy.read(device.id))?.holderId, parkedHolder);
    }
    const parkedRaw = await redis.client.get(desktopComputerSelectionKey(parked.scope));
    let parkedReceipts = 0;
    await assert.rejects(store.resume({
      scope: parked.scope, selectionId: parked.selection.selectionId,
      newSelectionId: randomUUID(), onResumed: () => { parkedReceipts += 1; },
    }), { code: "COMPUTER_TARGET_CHANGED" });
    assert.equal(parkedReceipts, 0, "a refused resume records no receipt");
    assert.deepEqual(await store.read(parked.scope), parkedBeforeResume);
    assert.equal(await redis.client.get(desktopComputerSelectionKey(parked.scope)), parkedRaw);
    assert.equal((await db.localComputerSession.findUniqueOrThrow({
      where: { id: parked.selection.sessionId },
    })).status, "active");
    if (retained === "holder") {
      assert.equal((await occupancy.read(device.id))?.holderId, parkedHolder);
    }

    // Stop remains the safety control: it ends exactly A's session and sends
    // exactly one quiesce for the recorded holder before the positive reply.
    transportCalls.length = 0;
    const parkedStop = await computerControl.handle({
      ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: {
          action: "stop", conversation_id: parked.scope.conversationId,
          turn_id: parked.scope.turnId, selection_id: parked.selection.selectionId,
        },
      },
    });
    assert.equal(parkedStop.ok, true);
    if (!parkedStop.ok) throw new Error("stop failed");
    assert.equal(parkedStop.data.state, "stopped");
    assert.deepEqual(transportCalls, [{
      holderId: parkedHolder, selectionId: parked.selection.selectionId, kind: "quiesce",
    }]);
    assert.equal((await store.read(parked.scope))?.state, "stopped");
    assert.equal((await store.read(parked.scope))?.pendingInput, null);
    assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);
    assert.equal((await db.localComputerSession.findUniqueOrThrow({
      where: { id: parked.selection.sessionId },
    })).status, "ended");
    await otherReplica.revokeScope(parked.scope);
  }

  // A public stop holds the same conversation lock as final dispatch
  // admission: it cannot commit before the single socket send, and the lock is
  // not held for any native response.
  const stopTarget = await runTurn();
  const stopHolder = await putHolder(stopTarget.scope, stopTarget.selection);
  const order: string[] = [];
  let stopSettled = false;
  let stopPromise: Promise<unknown> | undefined;
  assert.equal(await computerControl.admit({
    scope: stopTarget.scope, request: actRequest(), commandId: randomUUID(), sessionId: stopTarget.selection.sessionId,
    selectionId: stopTarget.selection.selectionId, holderId: stopHolder,
    admission: await admissionFor(stopTarget),
  }, {
    mayDispatch: async () => {
      stopPromise = service.stop(actor, stopTarget.scope.conversationId, stopTarget.selection.sessionId)
        .then(value => { stopSettled = true; order.push("stop"); return value; });
      await delayed(50);
      assert.equal(stopSettled, false);
      order.push("send");
      return true;
    },
    finalize: () => true,
  }), true);
  await stopPromise;
  assert.deepEqual(order, ["send", "stop"]);
  await otherReplica.revokeScope(stopTarget.scope);

  // A public stop committed before the final dispatch transaction produces no
  // socket command for the queued input.
  const queued = await runTurn();
  const queuedHolder = await putHolder(queued.scope, queued.selection);
  await service.stop(actor, queued.scope.conversationId, queued.selection.sessionId);
  let queuedSent = 0;
  assert.equal(await computerControl.admit({
    scope: queued.scope, request: actRequest(), commandId: randomUUID(), sessionId: queued.selection.sessionId,
    selectionId: queued.selection.selectionId, holderId: queuedHolder,
    admission: await admissionFor(queued),
  }, {
    mayDispatch: async () => true,
    finalize: () => { queuedSent += 1; return true; },
  }), false);
  assert.equal(queuedSent, 0);
  await otherReplica.revokeScope(queued.scope);

  // ---------------------------------------------------------------------
  // Blocker 3: a public stop or grant revoke that commits after the select
  // transaction but before the final active reply must suppress the positive
  // ack. The final check reuses the same conversation lock, materialized turn,
  // exact session, and both live grants.
  // ---------------------------------------------------------------------
  const stopAfterSelect = Object.create(store) as PrismaDesktopComputerControl;
  const finalStop = await runTurn();
  stopAfterSelect.select = async input => {
    const selected = await store.select(input);
    await service.stop(actor, finalStop.scope.conversationId, selected.sessionId);
    return selected;
  };
  const stopControl = new DesktopComputerControl({ ...hostOptions, store: stopAfterSelect });
  const stopAck = await stopControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: finalStop.scope.conversationId,
        turn_id: finalStop.scope.turnId, selection_id: finalStop.selection.selectionId,
        bundle_id: bundleId,
      },
    },
  });
  assert.equal(stopAck.ok, false);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: finalStop.selection.sessionId },
  })).status, "ended");
  await otherReplica.revokeScope(finalStop.scope);

  const revokeAfterSelect = Object.create(store) as PrismaDesktopComputerControl;
  const finalRevoke = await runTurn();
  revokeAfterSelect.select = async input => {
    const selected = await store.select(input);
    const grant = await db!.computerPermissionGrant.findFirstOrThrow({
      where: { sessionId: selected.sessionId, capability: "computer.act", revokedAt: null },
    });
    await service.changePermission(actor, finalRevoke.scope.conversationId, {
      action: "revoke", session_id: selected.sessionId, grant_id: grant.id,
    });
    return selected;
  };
  const revokeControl = new DesktopComputerControl({ ...hostOptions, store: revokeAfterSelect });
  const revokeAck = await revokeControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: finalRevoke.scope.conversationId,
        turn_id: finalRevoke.scope.turnId, selection_id: finalRevoke.selection.selectionId,
        bundle_id: bundleId,
      },
    },
  });
  assert.equal(revokeAck.ok, false);
  await otherReplica.revokeScope(finalRevoke.scope);

  // A positive active ack is sent once, inside the final locked check. A
  // competing public stop started from that continuation blocks on the same
  // conversation lock and completes after the ack without a deadlock.
  const positive = await runTurn();
  const replies: boolean[] = [];
  let competingStop: Promise<unknown> | undefined;
  let competingSettled = false;
  const positiveAck = await computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => true,
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: positive.scope.conversationId,
        turn_id: positive.scope.turnId, selection_id: positive.selection.selectionId,
        bundle_id: bundleId,
      },
    },
  }, result => {
    replies.push(result.ok);
    competingStop = service.stop(actor, positive.scope.conversationId, positive.selection.sessionId)
      .then(value => { competingSettled = true; return value; });
    return true;
  });
  assert.equal(positiveAck.ok, true);
  assert.deepEqual(replies, [true]);
  assert.equal(competingSettled, false);
  await competingStop;
  assert.equal(competingSettled, true);
  await delayed(50);
  assert.deepEqual(replies, [true]);
  await otherReplica.revokeScope(positive.scope);

  // ---------------------------------------------------------------------
  // Blocker 1: an explicit authorized observe keeps the per-device lease
  // through the absolute five-minute grant, so a native approval longer than
  // the old 45s GUI TTL can still run the approved act once without observe.
  // ---------------------------------------------------------------------
  await redis.client.del(localComputerGuiOccupancyKey(device.id));
  const delayedApproval = await runTurn();
  let delayedObserves = 0;
  let delayedActs = 0;
  const delayedTransport: Pick<DesktopComputerControlHost["transport"], "connection" | "send"> = {
    connection: async deviceId => deviceId === device.id
      ? { deviceId, connectionId: replacementConnection, gatewayId: randomUUID() } : null,
    send: async (_binding, command) => {
      if (command.operation !== "computer.execute") throw new Error("unexpected command operation");
      if (command.body.request.kind === "observe") delayedObserves += 1;
      if (command.body.request.kind === "act") delayedActs += 1;
      return desktopExecutionResultSchema.parse({
        type: "command.result", id: command.id, operation: "computer.execute", ok: true,
        result: command.body.request.kind === "observe"
          ? {
            kind: "observe",
            result: { observation_id: "obs-1", tree_quality: "good", truncated: false, nodes: [] },
          }
          : { kind: "act", result: { ok: true, effect: "done", waited_ms: 1 } },
      });
    },
  };
  const delayedControl = new DesktopComputerControl({
    ...hostOptions,
    transport: delayedTransport,
    authorize: input => authorizeLocalComputerAction(db!, { leases, connections: coordinator }, input),
  });
  const delayedTool = (kind: "observe" | "act") => {
    const request = desktopToolRequestSchema.parse({
      type: "tool.request", id: randomUUID(),
      conversation_id: delayedApproval.scope.conversationId,
      runtime_generation: delayedApproval.scope.runtimeGeneration,
      turn_id: delayedApproval.scope.turnId,
      expires_at: new Date(Date.now() + 25_000).toISOString(),
      run_token: delayedApproval.runToken,
      operation: "computer.execute",
      body: kind === "observe" ? { kind } : {
        kind, native_call_id: `native-${randomUUID()}`,
        input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 1_000 },
      },
    });
    if (request.operation !== "computer.execute") throw new Error("unexpected tool operation");
    return request;
  };
  // The Mac socket is live: its presence key is maintained while no act
  // request exists. This is the device heartbeat, not a reobserve.
  await coordinator.connect(device.id, replacementConnection);
  const keepAlive = setInterval(() => {
    void coordinator.maintain(device.id, replacementConnection).catch(() => undefined);
  }, 10_000);
  const observeCommand = await delayedControl.execute({
    scope: delayedApproval.scope, request: delayedTool("observe"), signal: new AbortController().signal,
  });
  assert.equal(observeCommand.kind, "observe");
  assert.equal(delayedObserves, 1);
  // No act request for longer than the old 45s GUI occupancy TTL: the lease
  // acquired by this explicit authorized observe must still be the exact
  // current holder, and the approved act must run once without reobserving.
  try {
    await delayed(46_000);
  } finally {
    clearInterval(keepAlive);
  }
  const delayedHolder = await occupancy.read(device.id);
  assert.ok(delayedHolder, "the authorized observe lease expired inside the grant");
  assert.ok(delayedHolder.expiresAt - Date.now() > 60_000);
  const delayedAct = await delayedControl.execute({
    scope: delayedApproval.scope, request: delayedTool("act"), signal: new AbortController().signal,
  });
  assert.equal(delayedAct.kind, "act");
  assert.equal(delayedActs, 1);
  assert.equal(delayedObserves, 1);
  // The absolute grant is a hard boundary: an expired grant never sends.
  await db.computerPermissionGrant.updateMany({
    where: { sessionId: delayedApproval.selection.sessionId },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  });
  const expiredGrant = await delayedControl.execute({
    scope: delayedApproval.scope, request: delayedTool("act"), signal: new AbortController().signal,
  });
  assert.equal(expiredGrant.kind, "failure");
  assert.equal(delayedActs, 1);
  // A lost exact holder is not proof that input may be sent: no act command.
  await redis.client.del(localComputerGuiOccupancyKey(device.id));
  const lostHolder = await delayedControl.execute({
    scope: delayedApproval.scope, request: delayedTool("act"), signal: new AbortController().signal,
  });
  assert.equal(lostHolder.kind, "failure");
  assert.equal(delayedActs, 1);
  await otherReplica.revokeScope(delayedApproval.scope);

  // ---------------------------------------------------------------------
  // Residual 1: an explicit same-selection renewal cannot carry or overwrite
  // a live pending act marker. The verdict is the live Lua CAS, not the outer
  // read; an accepted idle renewal is written with a known-idle marker.
  // ---------------------------------------------------------------------
  const pendingRenewal = await runTurn();
  const pendingRenewalHolder = await putHolder(pendingRenewal.scope, pendingRenewal.selection);
  const pendingRenewalCommand = randomUUID();
  let pendingRenewalSent = 0;
  assert.equal(await computerControl.admit({
    scope: pendingRenewal.scope, request: actRequest(), commandId: pendingRenewalCommand,
    sessionId: pendingRenewal.selection.sessionId,
    selectionId: pendingRenewal.selection.selectionId, holderId: pendingRenewalHolder,
    admission: await admissionFor(pendingRenewal),
  }, {
    mayDispatch: async () => true,
    finalize: () => { pendingRenewalSent += 1; return true; },
  }), true);
  assert.equal(pendingRenewalSent, 1);

  // Hide the marker from the outer read. The production store would otherwise
  // appear idle; the live Redis metadata still owns the pending proof.
  const staleOuterSelections = Object.create(redisSelections) as DesktopComputerRedisSelection;
  staleOuterSelections.read = async value => {
    const live = await redisSelections.read(value);
    return live ? { ...live, pendingInput: null } : null;
  };
  const casOnlyStore = new PrismaDesktopComputerControl(db, staleOuterSelections, leases, occupancy);
  await assert.rejects(casOnlyStore.select({
    scope: pendingRenewal.scope, selectionId: pendingRenewal.selection.selectionId, bundleId,
  }), { code: "COMPUTER_TARGET_CHANGED" });
  assert.equal((await store.read(pendingRenewal.scope))?.pendingInput?.commandId, pendingRenewalCommand);

  // The exact terminal result clears only this command; the deliberate idle
  // renewal then succeeds and is persisted idle.
  assert.equal(await store.clearInput(
    pendingRenewal.scope, pendingRenewal.selection, pendingRenewalHolder, pendingRenewalCommand,
  ), true);
  const renewedAfterClear = await store.select({
    scope: pendingRenewal.scope, selectionId: pendingRenewal.selection.selectionId, bundleId,
  });
  assert.equal(renewedAfterClear.sessionId, pendingRenewal.selection.sessionId);
  assert.notEqual(renewedAfterClear.controlEpoch, pendingRenewal.selection.controlEpoch);
  assert.equal(renewedAfterClear.pendingInput, null);
  assert.equal((await store.read(pendingRenewal.scope))?.pendingInput, null);
  await otherReplica.revokeScope(pendingRenewal.scope);

  // ---------------------------------------------------------------------
  // Residual 2: a delayed revalidate/disconnect cleanup started with
  // pre-renewal metadata must not clear the renewed same-id selection, its
  // reused holder, or its live session/grants. The exact CAS and the renewal
  // lock are both exercised.
  // ---------------------------------------------------------------------
  const staleCleanup = await runTurn();
  const staleCleanupHolder = await putHolder(staleCleanup.scope, staleCleanup.selection);
  const staleRenewed = await store.select({
    scope: staleCleanup.scope, selectionId: staleCleanup.selection.selectionId, bundleId,
  });
  assert.equal(staleRenewed.sessionId, staleCleanup.selection.sessionId);
  assert.notEqual(staleRenewed.controlEpoch, staleCleanup.selection.controlEpoch);
  await otherReplicaStore.discard({ scope: staleCleanup.scope, selection: staleCleanup.selection });
  assert.deepEqual(await store.read(staleCleanup.scope), staleRenewed);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: staleRenewed.sessionId },
  })).status, "active");
  const staleRenewedGrants = await db.computerPermissionGrant.findMany({
    where: { sessionId: staleRenewed.sessionId },
  });
  assert.ok(staleRenewedGrants.every(row => row.revokedAt === null));
  assert.equal((await occupancy.read(device.id))?.holderId, staleCleanupHolder);

  // A renewal transaction holds the same conversation lock. A stale cleanup
  // cannot clear the still-live pre-renewal metadata (same selection id and
  // connection) or end the session while that renewal is in flight.
  const serializedCleanup = await runTurn();
  const serializedHolder = await putHolder(serializedCleanup.scope, serializedCleanup.selection);
  let releaseRenewal!: () => void;
  const renewalGate = new Promise<void>(resolve => { releaseRenewal = resolve; });
  let renewalStarted!: () => void;
  const renewalStartedPromise = new Promise<void>(resolve => { renewalStarted = resolve; });
  const gatedSelections = Object.create(redisSelections) as DesktopComputerRedisSelection;
  gatedSelections.renew = async (value, candidate, previous) => {
    renewalStarted();
    await renewalGate;
    return redisSelections.renew(value, candidate, previous);
  };
  const gatedStore = new PrismaDesktopComputerControl(db, gatedSelections, leases, occupancy);
  const serializedRenewal = gatedStore.select({
    scope: serializedCleanup.scope, selectionId: serializedCleanup.selection.selectionId, bundleId,
  });
  await renewalStartedPromise;
  const staleDiscard = otherReplicaStore.discard({
    scope: serializedCleanup.scope, selection: serializedCleanup.selection,
  });
  await delayed(150);
  assert.equal(
    (await store.read(serializedCleanup.scope))?.controlEpoch,
    serializedCleanup.selection.controlEpoch,
  );
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: serializedCleanup.selection.sessionId },
  })).status, "active");
  assert.equal((await occupancy.read(device.id))?.holderId, serializedHolder);
  releaseRenewal();
  const serializedRenewed = await serializedRenewal;
  await staleDiscard;
  assert.deepEqual(await store.read(serializedCleanup.scope), serializedRenewed);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: serializedRenewed.sessionId },
  })).status, "active");
  assert.equal((await occupancy.read(device.id))?.holderId, serializedHolder);

  // A true exact revocation still clears the renewed generation end to end.
  await otherReplica.revokeScope(staleCleanup.scope);
  assert.equal(await store.read(staleCleanup.scope), null);
  await otherReplica.revokeScope(serializedCleanup.scope);
  assert.equal(await store.read(serializedCleanup.scope), null);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: serializedRenewed.sessionId },
  })).status, "ended");
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);

  // ---------------------------------------------------------------------
  // Lifecycle cleanup re-checks the live pending marker. A possible act is
  // not over just because the connection/run was fenced: a cleanup started
  // from an idle snapshot after a late claim retains the exact selection and
  // holder, but still ends the retired generation's database authorization.
  // Only the exact terminal proof clears the marker; a repeated revoke then
  // takes the known-idle path and cleans idempotently.
  // ---------------------------------------------------------------------
  const lateClaim = await runTurn();
  const lateHolder = await putHolder(lateClaim.scope, lateClaim.selection);
  const lateCommand = randomUUID();
  assert.equal(await store.claimInput({
    scope: lateClaim.scope, selection: lateClaim.selection,
    holderId: lateHolder, commandId: lateCommand,
  }), true);
  // The cleanup input is the idle generation read before the claim landed.
  assert.equal(lateClaim.selection.pendingInput, null);
  await otherReplicaStore.discard({ scope: lateClaim.scope, selection: lateClaim.selection });
  assert.equal((await store.read(lateClaim.scope))?.pendingInput?.commandId, lateCommand);
  assert.equal((await occupancy.read(device.id))?.holderId, lateHolder);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: lateClaim.selection.sessionId },
  })).status, "ended");
  const lateGrants = await db.computerPermissionGrant.findMany({
    where: { sessionId: lateClaim.selection.sessionId },
  });
  assert.ok(lateGrants.length > 0 && lateGrants.every(row => row.revokedAt !== null));
  // A terminal proof for another command UUID cannot clear the retained proof.
  assert.equal(await store.clearInput(
    lateClaim.scope, lateClaim.selection, lateHolder, randomUUID(),
  ), false);
  assert.equal((await store.read(lateClaim.scope))?.pendingInput?.commandId, lateCommand);
  assert.equal(await store.clearInput(
    lateClaim.scope, lateClaim.selection, lateHolder, lateCommand,
  ), true);
  assert.equal((await store.read(lateClaim.scope))?.pendingInput, null);
  await otherReplicaStore.discard({ scope: lateClaim.scope, selection: lateClaim.selection });
  assert.equal(await store.read(lateClaim.scope), null);
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);

  // ---------------------------------------------------------------------
  // Residual 4: the final positive active ack re-reads the Redis authority
  // after the last awaited credential gate and does one synchronous expiry
  // check before the reply.
  // ---------------------------------------------------------------------
  const delayedCredential = await runTurn();
  let credentialCalls = 0;
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>(resolve => { releaseCredential = resolve; });
  let credentialStarted!: () => void;
  const credentialStartedPromise = new Promise<void>(resolve => { credentialStarted = resolve; });
  const credentialReplies: DesktopComputerControlResult[] = [];
  const credentialAck = computerControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => {
      credentialCalls += 1;
      // The first two reads precede the final locked check; the third is the
      // last awaited gate inside finalizeActive.
      if (credentialCalls < 3) return true;
      credentialStarted();
      await credentialGate;
      return true;
    },
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: delayedCredential.scope.conversationId,
        turn_id: delayedCredential.scope.turnId,
        selection_id: delayedCredential.selection.selectionId, bundle_id: bundleId,
      },
    },
  }, result => { credentialReplies.push(result); return true; });
  await credentialStartedPromise;
  await leases.revoke(delayedCredential.turn.id);
  releaseCredential();
  const credentialResult = await credentialAck;
  assert.equal(credentialResult.ok, false);
  assert.equal(credentialReplies.length, 1);
  assert.equal(credentialReplies[0]?.ok, false);
  await otherReplica.revokeScope(delayedCredential.scope);

  const timeAdvance = await runTurn();
  let clock = Date.now();
  const clockNow = () => new Date(clock);
  const timeStore = new PrismaDesktopComputerControl(db, redisSelections, leases, occupancy, clockNow);
  const timeControl = new DesktopComputerControl({ ...hostOptions, store: timeStore, now: clockNow });
  let timeCalls = 0;
  let releaseTime!: () => void;
  const timeGate = new Promise<void>(resolve => { releaseTime = resolve; });
  let timeStarted!: () => void;
  const timeStartedPromise = new Promise<void>(resolve => { timeStarted = resolve; });
  const timeReplies: DesktopComputerControlResult[] = [];
  const timeAck = timeControl.handle({
    ownerId: owner.id, deviceId: device.id, connectionId: replacementConnection,
    verifyCredential: async () => {
      timeCalls += 1;
      if (timeCalls < 3) return true;
      clock += 6 * 60_000;
      timeStarted();
      await timeGate;
      return true;
    },
    frame: {
      type: "computer.control", id: randomUUID(),
      body: {
        action: "select", conversation_id: timeAdvance.scope.conversationId,
        turn_id: timeAdvance.scope.turnId,
        selection_id: timeAdvance.selection.selectionId, bundle_id: bundleId,
      },
    },
  }, result => { timeReplies.push(result); return true; });
  await timeStartedPromise;
  releaseTime();
  const timeResult = await timeAck;
  assert.equal(timeResult.ok, false);
  assert.equal(timeReplies.length, 1);
  assert.equal(timeReplies[0]?.ok, false);
  await otherReplica.revokeScope(timeAdvance.scope);

  // A same-id renewal whose five-minute window would not strictly advance is
  // a legitimate non-success: no epoch, session/grant expiry, or holder
  // changes. Only a strictly later bounded expiry renews.
  const equality = await runTurn();
  const equalityHolder = await putHolder(equality.scope, equality.selection);
  const equalitySessions = await db.localComputerSession.count({
    where: { conversationId: equality.scope.conversationId, deviceId: device.id },
  });
  const equalityClock = equality.selection.expiresAt - 5 * 60_000;
  const equalityStore = new PrismaDesktopComputerControl(
    db, redisSelections, leases, occupancy, () => new Date(equalityClock),
  );
  await assert.rejects(equalityStore.select({
    scope: equality.scope, selectionId: equality.selection.selectionId, bundleId,
  }), { code: "COMPUTER_TIMEOUT" });
  assert.deepEqual(await store.read(equality.scope), equality.selection);
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: equality.scope.conversationId, deviceId: device.id },
  }), equalitySessions);
  const equalitySession = await db.localComputerSession.findUniqueOrThrow({
    where: { id: equality.selection.sessionId },
  });
  assert.equal(equalitySession.expiresAt?.getTime(), equality.selection.expiresAt);
  assert.equal(equalitySession.status, "active");
  const equalityGrants = await db.computerPermissionGrant.findMany({
    where: { sessionId: equality.selection.sessionId },
  });
  assert.ok(equalityGrants.every(row =>
    row.expiresAt?.getTime() === equality.selection.expiresAt && row.revokedAt === null));
  assert.equal((await occupancy.read(device.id))?.holderId, equalityHolder);

  // One millisecond of strict advancement is accepted with a new epoch and
  // the same session, grants, and holder.
  const advancingStore = new PrismaDesktopComputerControl(
    db, redisSelections, leases, occupancy, () => new Date(equalityClock + 1),
  );
  const equalityRenewed = await advancingStore.select({
    scope: equality.scope, selectionId: equality.selection.selectionId, bundleId,
  });
  assert.equal(equalityRenewed.sessionId, equality.selection.sessionId);
  assert.equal(equalityRenewed.expiresAt, equality.selection.expiresAt + 1);
  assert.notEqual(equalityRenewed.controlEpoch, equality.selection.controlEpoch);
  assert.equal((await occupancy.read(device.id))?.holderId, equalityHolder);
  await otherReplica.revokeScope(equality.scope);

  // ---------------------------------------------------------------------
  // Renewal race: a same-id continuation is authorized against an exact
  // previous Redis version under the locked PostgreSQL transaction. If that
  // version expires, disappears, or is replaced before the Lua CAS, the
  // renewal refuses before writing and the transaction rolls back its
  // session/grant extension. Wrapping renew is the deterministic cutpoint
  // between the locked snapshot and the CAS; no sleeps or Redis clock mocking
  // are involved.
  // ---------------------------------------------------------------------
  const selectionDatabaseState = async (value: DesktopRunScope, selection: DesktopComputerSelection) => {
    const session = await db!.localComputerSession.findUniqueOrThrow({ where: { id: selection.sessionId } });
    const grants = await db!.computerPermissionGrant.findMany({
      where: { sessionId: selection.sessionId }, orderBy: { id: "asc" },
      select: { id: true, capability: true, expiresAt: true, revokedAt: true },
    });
    return {
      sessions: await db!.localComputerSession.count({
        where: { conversationId: value.conversationId, deviceId: value.deviceId },
      }),
      status: session.status,
      expiresAt: session.expiresAt?.getTime() ?? null,
      grants: grants.map(grant => ({
        id: grant.id, capability: grant.capability,
        expiresAt: grant.expiresAt?.getTime() ?? null,
        revokedAt: grant.revokedAt?.getTime() ?? null,
      })),
    };
  };
  const assertRenewalRefusal = async (input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    mutate: (value: DesktopRunScope, previous: DesktopComputerSelection) => Promise<void>;
    code: string;
    after: () => Promise<void>;
  }) => {
    const before = await selectionDatabaseState(input.scope, input.selection);
    const cutpointSelections = Object.create(redisSelections) as DesktopComputerRedisSelection;
    cutpointSelections.renew = async (value, candidate, previous) => {
      await input.mutate(value, previous);
      return redisSelections.renew(value, candidate, previous);
    };
    // One second of strict advance keeps the outer PostgreSQL window check
    // deterministic without sleeping.
    const cutpointStore = new PrismaDesktopComputerControl(
      db!, cutpointSelections, leases, occupancy, () => new Date(Date.now() + 1_000),
    );
    await assert.rejects(cutpointStore.select({
      scope: input.scope, selectionId: input.selection.selectionId, bundleId,
    }), { code: input.code });
    await input.after();
    // The refused Redis CAS must have rolled back the locked extension:
    // same session, expiry, status, grants, and row counts.
    assert.deepEqual(await selectionDatabaseState(input.scope, input.selection), before);
  };

  const missingRenewal = await runTurn();
  const missingRenewalHolder = await putHolder(missingRenewal.scope, missingRenewal.selection);
  await assertRenewalRefusal({
    scope: missingRenewal.scope, selection: missingRenewal.selection, code: "COMPUTER_TIMEOUT",
    mutate: async value => { await redis.client.del(desktopComputerSelectionKey(value)); },
    after: async () => {
      assert.equal(await store.read(missingRenewal.scope), null);
      assert.equal((await occupancy.read(device.id))?.holderId, missingRenewalHolder);
    },
  });
  await occupancy.release(device.id, missingRenewalHolder);

  const expiredRenewal = await runTurn();
  const expiredRenewalHolder = await putHolder(expiredRenewal.scope, expiredRenewal.selection);
  const expiredRenewalMetadata: DesktopComputerSelection = {
    ...expiredRenewal.selection, expiresAt: Date.now() - 1_000,
  };
  await assertRenewalRefusal({
    scope: expiredRenewal.scope, selection: expiredRenewal.selection, code: "COMPUTER_TIMEOUT",
    mutate: async value => {
      await redis.client.set(
        desktopComputerSelectionKey(value), JSON.stringify(expiredRenewalMetadata), "PX", 30_000,
      );
    },
    after: async () => {
      assert.equal(
        await redis.client.get(desktopComputerSelectionKey(expiredRenewal.scope)),
        JSON.stringify(expiredRenewalMetadata),
      );
      assert.equal((await occupancy.read(device.id))?.holderId, expiredRenewalHolder);
    },
  });
  await occupancy.release(device.id, expiredRenewalHolder);

  const replacedRenewal = await runTurn();
  const replacedRenewalHolder = await putHolder(replacedRenewal.scope, replacedRenewal.selection);
  const replacedRenewalMetadata: DesktopComputerSelection = {
    ...replacedRenewal.selection, controlEpoch: randomUUID(),
  };
  await assertRenewalRefusal({
    scope: replacedRenewal.scope, selection: replacedRenewal.selection, code: "COMPUTER_TARGET_CHANGED",
    mutate: async value => {
      await redis.client.set(
        desktopComputerSelectionKey(value), JSON.stringify(replacedRenewalMetadata), "PX", 60_000,
      );
    },
    after: async () => {
      assert.equal(
        await redis.client.get(desktopComputerSelectionKey(replacedRenewal.scope)),
        JSON.stringify(replacedRenewalMetadata),
      );
      assert.equal((await occupancy.read(device.id))?.holderId, replacedRenewalHolder);
    },
  });
  await occupancy.release(device.id, replacedRenewalHolder);

  // A known same-id binding whose stored selection has expired must not
  // become fresh authorization. A fresh deliberate pick with a new id is
  // separate and may start a new session after the expired one is ended.
  const expiredPick = await runTurn();
  const expiredMetadata: DesktopComputerSelection = {
    ...expiredPick.selection, expiresAt: Date.now() - 1_000,
  };
  await redis.client.set(
    desktopComputerSelectionKey(expiredPick.scope), JSON.stringify(expiredMetadata), "PX", 30_000,
  );
  const expiredSessions = await db.localComputerSession.count({
    where: { conversationId: expiredPick.scope.conversationId, deviceId: device.id },
  });
  await assert.rejects(store.select({
    scope: expiredPick.scope, selectionId: expiredPick.selection.selectionId, bundleId,
  }), { code: "COMPUTER_ACCESS_DENIED" });
  assert.deepEqual(await store.read(expiredPick.scope), expiredMetadata);
  assert.equal(await db.localComputerSession.count({
    where: { conversationId: expiredPick.scope.conversationId, deviceId: device.id },
  }), expiredSessions);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: expiredPick.selection.sessionId },
  })).status, "active");
  assert.equal(await db.computerPermissionGrant.count({
    where: { sessionId: expiredPick.selection.sessionId },
  }), 2);

  const expiredFreshId = randomUUID();
  const freshAfterExpiry = await store.select({
    scope: expiredPick.scope, selectionId: expiredFreshId, bundleId,
  });
  assert.equal(freshAfterExpiry.state, "active");
  assert.equal(freshAfterExpiry.selectionId, expiredFreshId);
  assert.notEqual(freshAfterExpiry.sessionId, expiredPick.selection.sessionId);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: expiredPick.selection.sessionId },
  })).status, "ended");
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: freshAfterExpiry.sessionId },
  })).status, "active");
  const expiredOldGrants = await db.computerPermissionGrant.findMany({
    where: { sessionId: expiredPick.selection.sessionId },
  });
  assert.ok(expiredOldGrants.every(row => row.revokedAt !== null));
  await otherReplica.revokeScope(expiredPick.scope);

  // A replacement that lands between the former split presence/run reads and
  // the selection read must be seen by the final positive-ack check. The
  // hooked methods are the seams where that replacement interleaves.
  const finalReplace = await runTurn();
  const finalSelections = Object.create(redisSelections) as DesktopComputerRedisSelection;
  const replacementForAck = randomUUID();
  let finalArmed = false;
  let finalReplaced = false;
  const replaceBeforeFinalRead = async () => {
    if (!finalArmed || finalReplaced) return;
    finalReplaced = true;
    await coordinator.connect(device.id, replacementForAck);
    await writeRun({ ...finalReplace.scope, connectionId: replacementForAck });
  };
  finalSelections.read = async value => {
    await replaceBeforeFinalRead();
    return redisSelections.read(value);
  };
  finalSelections.verifyActiveFinal = async (value, selection) => {
    await replaceBeforeFinalRead();
    return redisSelections.verifyActiveFinal(value, selection);
  };
  const finalStore = new PrismaDesktopComputerControl(db, finalSelections, leases, occupancy);
  let finalAcks = 0;
  const finalAccepted = await finalStore.finalizeActive({
    scope: finalReplace.scope, selection: finalReplace.selection,
    verify: async () => { finalArmed = true; return true; },
    finalize: () => { finalAcks += 1; return true; },
  });
  assert.equal(finalReplaced, true);
  assert.equal(finalAccepted, false);
  assert.equal(finalAcks, 0);
  await otherReplica.revokeScope(finalReplace.scope);
  // Restore the live presence used by the remaining scenarios.
  await coordinator.connect(device.id, replacementConnection);

  // Two turns on the same device: terminal/revoke cleanup for the old turn
  // cannot clear the newer selection or its holder, and a different replica
  // uses the durable device index to clean only the exact connection.
  const older = await runTurn();
  const newer = await runTurn();
  assert.equal(
    (await db.localComputerSession.findUniqueOrThrow({ where: { id: older.selection.sessionId } })).status,
    "active",
  );
  const newerHolder = await putHolder(newer.scope, newer.selection);
  await otherReplica.revokeTurn(older.turn.id);
  assert.equal(await store.read(older.scope), null);
  assert.equal(
    (await db.localComputerSession.findUniqueOrThrow({ where: { id: older.selection.sessionId } })).status,
    "ended",
  );
  assert.notEqual(await store.read(newer.scope), null);
  assert.equal(
    JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(device.id)) ?? "null").holderId,
    newerHolder,
  );
  // As the old turn is terminal and its scope cleared, the newer scope is
  // still accepted (an explicit renewal of the same live selection).
  const renewedNewer = await store.select({
    scope: newer.scope, selectionId: newer.selection.selectionId, bundleId,
  });
  assert.equal(renewedNewer.state, "active");
  await otherReplica.releaseConnection(device.id, replacementConnection);
  assert.equal(await store.read(newer.scope), null);
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);
  assert.equal((await store.scopesForTurn(older.turn.id)).length, 0);
  assert.equal((await store.scopesForTurn(newer.turn.id)).length, 0);

  // The positive status candidate is still provisional until the original act
  // authority and exact selection are rechecked under the dispatch lock. An
  // act-only revoke that wins that wait leaves the observe/diagnostic path
  // usable but never publishes the positive boolean.
  const statusPositive = await runTurn();
  await coordinator.connect(device.id, replacementConnection);
  let statusPublication: DesktopComputerReadPublication | undefined;
  let statusCommands = 0;
  const statusControl = new DesktopComputerControl({
    ...hostOptions,
    transport: {
      connection: async deviceId => deviceId === device.id
        ? { deviceId, connectionId: replacementConnection, gatewayId: randomUUID() } : null,
      send: async (_binding, command) => {
        if (command.operation !== "computer.execute" || command.body.request.kind !== "status") {
          throw new Error("unexpected status command");
        }
        statusCommands += 1;
        return desktopExecutionResultSchema.parse({
          type: "command.result", id: command.id, operation: "computer.execute", ok: true,
          result: {
            kind: "status",
            result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
          },
        });
      },
    },
    authorize: input => authorizeLocalComputerAction(db!, { leases, connections: coordinator }, input),
    verifyDispatch: (input, finalize) => verifyLocalComputerDispatch(db!, input, undefined, finalize),
  });
  const statusRequest = desktopToolRequestSchema.parse({
    type: "tool.request", id: randomUUID(),
    conversation_id: statusPositive.scope.conversationId,
    runtime_generation: statusPositive.scope.runtimeGeneration,
    turn_id: statusPositive.scope.turnId,
    expires_at: new Date(Date.now() + 25_000).toISOString(),
    run_token: statusPositive.runToken,
    operation: "computer.execute",
    body: { kind: "status" },
  });
  if (statusRequest.operation !== "computer.execute") throw new Error("unexpected tool operation");
  const statusCandidate = await statusControl.execute({
    scope: statusPositive.scope, request: statusRequest, signal: new AbortController().signal,
    computerStatus: true,
  }, publication => { statusPublication = publication; });
  assert.equal(statusCandidate.kind, "status");
  if (statusCandidate.kind !== "status") throw new Error("status candidate missing");
  assert.equal(statusCandidate.result.active_grant, true);
  assert.equal(statusCommands, 1);
  assert.ok(statusPublication, "positive status captured its publication continuation");
  const revokedAct = await actGrant(statusPositive.selection);
  await service.changePermission(actor, statusPositive.scope.conversationId, {
    action: "revoke", session_id: statusPositive.selection.sessionId, grant_id: revokedAct.id,
  });
  let positiveSends = 0;
  assert.equal(await statusPublication.publish(() => { positiveSends += 1; return true; }), false);
  assert.equal(positiveSends, 0);
  // The original diagnostic authority is a different capability and remains
  // usable; the act-only revoke is never surfaced as a status error.
  await assert.doesNotReject(authorizeLocalComputerAction(db, { leases, connections: coordinator }, {
    scope: statusPositive.scope, capability: "computer.observe", bundleId, runToken: statusPositive.runToken,
    requestKind: "status",
  }));
  await otherReplica.revokeScope(statusPositive.scope);

  // ---------------------------------------------------------------------
  // Retirement through a real device revocation. DesktopDeviceService
  // retires the device row, every database session/grant, and the
  // coordinator presence; the selection cleanup that follows is the only
  // remaining Redis authority. The conversation lock used by discard must
  // still accept the now-revoked credential row, or an exact idle selection
  // would survive until its TTL. A wrong connection never clears; the exact
  // old scope clears only its own idle selection; a sibling's pending input
  // marker keeps its selection and holder byte for byte; and a serialized
  // record written before pendingInput cannot prove that no act was admitted,
  // so the same exact walk fences it and its holder as well.
  // ---------------------------------------------------------------------
  await coordinator.connect(device.id, replacementConnection);
  const devices = new DesktopDeviceService(new PrismaDesktopDeviceRepository(db), coordinator);

  // A different, still-healthy device keeps an exact live selection, holder,
  // session, and act grant through the whole revoked-device walk. The owner
  // epoch change below is the only thing that invalidates it.
  const foreignDeviceRecord = await db.desktopDevice.findUniqueOrThrow({ where: { id: otherDevice.id } });
  const otherConnection = randomUUID();
  await coordinator.connect(otherDevice.id, otherConnection);
  const otherScope: DesktopRunScope = {
    ownerId: other.id, deviceId: otherDevice.id, connectionId: otherConnection,
    conversationId: foreign.id, turnId: foreignTurn.id, runtimeGeneration: foreign.runtimeGeneration,
  };
  const otherRunToken = await bindRun(otherScope);
  const otherSelection = await store.select({ scope: otherScope, selectionId: randomUUID(), bundleId });
  await putHolder(otherScope, otherSelection);
  const otherGrant = await actGrant(otherSelection);
  const otherSelectionRaw = await redis.client.get(desktopComputerSelectionKey(otherScope));
  const otherHolderRaw = await redis.client.get(localComputerGuiOccupancyKey(otherDevice.id));
  if (otherSelectionRaw === null || otherHolderRaw === null) {
    throw new Error("other device authority missing");
  }

  // A separate idle record carries its own holder, so this stage never
  // overwrites another tested holder. The freshly stored value proves the
  // known-idle null; deleting only that field with KEEPTTL models a record
  // serialized before pendingInput existed.
  const legacy = await runTurn();
  const legacyHolder = await putHolder(legacy.scope, legacy.selection);
  const legacyHolderRaw = await redis.client.get(localComputerGuiOccupancyKey(device.id));
  const legacyRaw = await redis.client.get(desktopComputerSelectionKey(legacy.scope));
  if (legacyHolderRaw === null || legacyRaw === null) throw new Error("legacy authority missing");
  const legacyRecord = JSON.parse(legacyRaw) as Record<string, unknown>;
  assert.equal(legacyRecord.pendingInput, null);
  delete legacyRecord.pendingInput;
  const legacyFieldlessRaw = JSON.stringify(legacyRecord);
  await redis.client.set(desktopComputerSelectionKey(legacy.scope), legacyFieldlessRaw, "KEEPTTL");
  const legacyStored = await redis.client.get(desktopComputerSelectionKey(legacy.scope));
  if (legacyStored === null) throw new Error("legacy selection missing");
  assert.equal(JSON.parse(legacyStored).pendingInput, undefined);
  assert.equal(await store.read(legacy.scope), null);

  // The exact connection walk fences the fieldless record byte for byte and
  // retains its holder, while the other device's authority is untouched.
  await otherReplica.releaseConnection(device.id, replacementConnection);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(legacy.scope)), legacyFieldlessRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), legacyHolderRaw);
  assert.equal((await occupancy.read(device.id))?.holderId, legacyHolder);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(otherScope)), otherSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(otherDevice.id)), otherHolderRaw);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: otherSelection.sessionId },
  })).status, "active");
  assert.equal((await db.computerPermissionGrant.findUniqueOrThrow({
    where: { id: otherGrant.id },
  })).revokedAt, null);
  assert.equal(await occupancy.release(device.id, legacyHolder), true);

  const retiring = await runTurn();
  const sibling = await runTurn();
  const siblingHolder = await putHolder(sibling.scope, sibling.selection);
  const siblingCommand = randomUUID();
  assert.equal(await store.claimInput({
    scope: sibling.scope, selection: sibling.selection,
    holderId: siblingHolder, commandId: siblingCommand,
  }), true);
  const siblingSelection = await store.read(sibling.scope);
  if (!siblingSelection) throw new Error("sibling selection missing");
  assert.equal(siblingSelection.pendingInput?.commandId, siblingCommand);
  const siblingSelectionRaw = await redis.client.get(desktopComputerSelectionKey(sibling.scope));
  const siblingHolderRaw = await redis.client.get(localComputerGuiOccupancyKey(device.id));
  if (siblingSelectionRaw === null || siblingHolderRaw === null) throw new Error("sibling authority missing");
  const retiringSelection = await store.read(retiring.scope);
  if (!retiringSelection) throw new Error("retiring selection missing");
  assert.equal(retiringSelection.pendingInput, null);

  await devices.revoke(owner.id, device.id);
  assert.notEqual((await db.desktopDevice.findUniqueOrThrow({ where: { id: device.id } })).revokedAt, null);
  assert.equal(await coordinator.isCurrentConnection(device.id, replacementConnection), false);
  // The service itself already retired the database authority for both
  // generations before any selection cleanup runs.
  for (const selection of [retiring.selection, sibling.selection]) {
    assert.equal((await db.localComputerSession.findUniqueOrThrow({
      where: { id: selection.sessionId },
    })).status, "ended");
    const grants = await db.computerPermissionGrant.findMany({ where: { sessionId: selection.sessionId } });
    assert.ok(grants.length > 0 && grants.every(row => row.revokedAt !== null));
  }

  // A delayed disconnect cleanup from another connection may not clear either
  // scope even when it names this device and the exact old key scope.
  await computerControl.revokeScope(
    { ...retiring.scope, connectionId: randomUUID() }, { requireConnection: true },
  );
  assert.deepEqual(await store.read(retiring.scope), retiringSelection);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(sibling.scope)), siblingSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), siblingHolderRaw);

  // Exact retirement must still clear the idle old generation after the
  // credential was revoked; the pre-fix live-only lock refuses that row and
  // leaves the selection until its TTL. This is the cross-replica walk: the
  // real Redis device index, an empty process-local map, and the exact
  // connection. The fieldless legacy record and the sibling's pending marker
  // keep their selections byte for byte.
  await otherReplica.releaseConnection(device.id, replacementConnection);
  assert.equal(await store.read(retiring.scope), null);
  assert.equal(await redis.client.exists(desktopComputerSelectionKey(retiring.scope)), 0);
  assert.deepEqual(await store.read(sibling.scope), siblingSelection);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(sibling.scope)), siblingSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), siblingHolderRaw);
  assert.equal((await occupancy.read(device.id))?.holderId, siblingHolder);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(legacy.scope)), legacyFieldlessRaw);
  assert.equal(await store.read(legacy.scope), null);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(otherScope)), otherSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(otherDevice.id)), otherHolderRaw);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: otherSelection.sessionId },
  })).status, "active");
  assert.equal((await db.computerPermissionGrant.findUniqueOrThrow({
    where: { id: otherGrant.id },
  })).revokedAt, null);

  // The sibling's pinned pending marker survives even exact cleanup: a
  // possible act is not over because the credential was retired, so the
  // selection and holder are retained for the exact terminal proof/expiry.
  await otherReplicaStore.discard({ scope: sibling.scope, selection: siblingSelection });
  assert.deepEqual(await store.read(sibling.scope), siblingSelection);
  assert.equal((await store.read(sibling.scope))?.pendingInput?.holderId, siblingHolder);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(sibling.scope)), siblingSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), siblingHolderRaw);

  // The revoked device credential itself grants nothing and dispatches
  // nothing: the locked authority refuses before any selection is consulted.
  await assert.rejects(authorizeLocalComputerAction(db, { leases, connections: coordinator }, {
    scope: sibling.scope, capability: "computer.act", bundleId,
    runToken: sibling.runToken, requestKind: "act",
  }), { code: "FORBIDDEN" });
  const siblingGrant = await actGrant(sibling.selection);
  await assert.rejects(verifyLocalComputerDispatch(db, {
    scope: sibling.scope, sessionId: sibling.selection.sessionId, grantId: siblingGrant.id,
    capability: "computer.act", bundleId, expiresAt: new Date(Date.now() + 60_000), requestKind: "act",
  }), { code: "FORBIDDEN" });
  assert.equal(await redis.client.get(desktopComputerSelectionKey(sibling.scope)), siblingSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), siblingHolderRaw);

  // Account epoch changes invalidate the same currentCredential predicate used
  // by maintain, locked action authorization, and dispatch verification. The
  // other device's scope is genuine and usable immediately before the change,
  // and its SQL session/grant are still unrevoked when both checks deny.
  assert.equal(await devices.maintain(foreignDeviceRecord, otherConnection), "online");
  // Capture the exact permit the action authority returns and reuse that same
  // admission for the positive and negative dispatch checks below, so the
  // post-epoch refusal cannot be explained by a malformed or already-unusable
  // admission.
  const otherAdmission = {
    ...await authorizeLocalComputerAction(db, { leases, connections: coordinator }, {
      scope: otherScope, capability: "computer.act", bundleId,
      runToken: otherRunToken, requestKind: "act",
    }),
    requestKind: "act" as const,
  };
  assert.equal(otherAdmission.sessionId, otherSelection.sessionId);
  assert.equal(otherAdmission.grantId, otherGrant.id);
  await assert.doesNotReject(verifyLocalComputerDispatch(db, otherAdmission));
  await db.user.update({
    where: { id: other.id },
    data: { authValidAfter: new Date(other.authValidAfter.getTime() + 1_000) },
  });
  assert.equal(await devices.maintain(foreignDeviceRecord, otherConnection), "revoked");
  // The revoked verdict comes from the credential predicate alone and leaves
  // the canonical connection current, so the denials below are attributable to
  // the epoch rather than an absent presence key.
  assert.equal(await coordinator.isCurrentConnection(otherDevice.id, otherConnection), true);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: otherSelection.sessionId },
  })).status, "active");
  assert.equal((await db.computerPermissionGrant.findUniqueOrThrow({
    where: { id: otherGrant.id },
  })).revokedAt, null);
  await assert.rejects(authorizeLocalComputerAction(db, { leases, connections: coordinator }, {
    scope: otherScope, capability: "computer.act", bundleId,
    runToken: otherRunToken, requestKind: "act",
  }), { code: "FORBIDDEN" });
  await assert.rejects(verifyLocalComputerDispatch(db, otherAdmission), { code: "FORBIDDEN" });

  // The exact connection walk still retires that scope under the retirement
  // lock and ends only its database session/grants. The revoked device's
  // pending and fieldless fences survive untouched.
  await otherReplica.releaseConnection(otherDevice.id, otherConnection);
  assert.equal(await store.read(otherScope), null);
  assert.equal(await redis.client.exists(desktopComputerSelectionKey(otherScope)), 0);
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(otherDevice.id)), 0);
  assert.equal((await db.localComputerSession.findUniqueOrThrow({
    where: { id: otherSelection.sessionId },
  })).status, "ended");
  const otherGrants = await db.computerPermissionGrant.findMany({ where: { sessionId: otherSelection.sessionId } });
  assert.ok(otherGrants.length > 0 && otherGrants.every(row => row.revokedAt !== null));
  assert.equal(await db.localComputerSession.count({
    where: { ownerId: other.id, deviceId: otherDevice.id },
  }), 1);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(sibling.scope)), siblingSelectionRaw);
  assert.equal(await redis.client.get(localComputerGuiOccupancyKey(device.id)), siblingHolderRaw);
  assert.equal(await redis.client.get(desktopComputerSelectionKey(legacy.scope)), legacyFieldlessRaw);

  // The epoch change also still refuses a native select of the original valid
  // scope after its cleanup, without consulting the retired selection. The
  // exact canonical connection remains current, so presence cannot explain
  // the refusal.
  assert.equal(await coordinator.isCurrentConnection(otherDevice.id, otherConnection), true);
  await assert.rejects(
    store.select({ scope: otherScope, selectionId: otherSelection.selectionId, bundleId }),
    { code: "FORBIDDEN" },
  );

  // The dedicated audit client closes cleanly and leaves no server session.
  await auditDb.$disconnect();
  auditDb = undefined;
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  const auditSessions = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM pg_stat_activity
    WHERE application_name = ${desktopComputerPauseAuditPoolConfig.application_name}`;
  assert.equal(Number(auditSessions[0]?.count), 0, "the dedicated audit client left no connection");

  console.log("desktop computer control postgres: ok");
} finally {
  await auditDb?.$disconnect().catch(() => undefined);
  await db?.$disconnect().catch(() => undefined);
  await redis.close().catch(() => undefined);
  if (pgStarted) {
    await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}
