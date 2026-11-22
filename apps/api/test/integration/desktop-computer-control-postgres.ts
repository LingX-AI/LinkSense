import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPrismaClient } from "../../src/db.js";
import { sha256 } from "../../src/lib/crypto.js";
import {
  DesktopComputerControl,
  DesktopComputerRedisSelection,
  PrismaDesktopComputerControl,
  desktopComputerSelectionKey,
  type DesktopComputerControlHost,
  type DesktopComputerSelection,
} from "../../src/modules/desktop-devices/computer-control.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import {
  desktopRunLeaseKey,
  DesktopRunLeases,
  type DesktopRunScope,
} from "../../src/modules/desktop-credentials/run-leases.js";
import {
  authorizeLocalComputerAction,
  verifyLocalComputerDispatch,
} from "../../src/modules/local-computer/authorization.js";
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
let pgStarted = false;
const redis = await createRedisFixture();
let db: ReturnType<typeof createPrismaClient> | undefined;
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
  await db.conversationTurn.create({
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
  });
  assert.equal(pauseResult.ok, true);
  if (!pauseResult.ok) throw new Error("pause failed");
  assert.equal(pauseResult.data.state, "paused");
  assert.deepEqual(transportCalls, [{
    holderId: pendingHolder, selectionId: pending.selection.selectionId, kind: "quiesce",
  }]);
  assert.equal((await store.read(pending.scope))?.pendingInput, null);
  assert.equal(await redis.client.exists(localComputerGuiOccupancyKey(device.id)), 0);
  await otherReplica.revokeTurn(pending.turn.id);

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

  // Account epoch changes invalidate the locked authority.
  await db.user.update({ where: { id: other.id }, data: { authValidAfter: new Date(other.authValidAfter.getTime() + 1_000) } });
  await coordinator.connect(otherDevice.id, randomUUID());
  await assert.rejects(
    store.select({ scope: { ...foreignScope, connectionId: randomUUID() }, selectionId: randomUUID(), bundleId }),
    { code: "FORBIDDEN" },
  );

  console.log("desktop computer control postgres: ok");
} finally {
  await db?.$disconnect().catch(() => undefined);
  await redis.close().catch(() => undefined);
  if (pgStarted) {
    await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}
