import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PrismaPg } from "@prisma/adapter-pg";
import Fastify from "fastify";
import { readConversationReferenceResultSchema, RUNNER_TURN_INTERRUPT_REQUESTED } from "@linksense/shared";

import { sha256 } from "../../src/lib/crypto.js";
import { AppError } from "../../src/lib/errors.js";
import { sendAppError } from "../../src/lib/http.js";
import { createPrismaClient } from "../../src/db.js";
import { Prisma, PrismaClient } from "../../src/generated/prisma/client.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { RunnerStartInput, RunnerStartOperation } from "../../src/adapters/runner.js";
import { conversationContinuationId } from "../../src/modules/conversations/execution-target.js";
import { internalConversationReferenceRoutes } from "../../src/modules/conversations/reference-routes.js";
import { ConversationService, type ConversationPreflight } from "../../src/modules/conversations/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { registerRunnerRuntimeScope } from "../../src/modules/events/runtime-scope.js";
import type { ResolvedModelRuntime } from "../../src/modules/system/model-provider-settings.js";
import { createRedisFixture } from "../fixtures/redis.js";
import { testConfig } from "../test-config.js";

/**
 * Disposable PostgreSQL/Redis white-box for explicit Mac<->cloud continuation.
 * It owns a temporary cluster, never loads the application environment, and
 * only reads or writes its own fixtures.
 */
const execute = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "linksense-continuation-pg-"));
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
    server.close((error) => (error ? reject(error) : resolve(address.port)));
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
  await execute(
    "initdb",
    ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"],
    { timeout: 30_000 },
  );
  await execute(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(root, "server.log"),
      "-w",
      "start",
      "-o",
      `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
    ],
    { timeout: 30_000 },
  );
  pgStarted = true;
  const control = createPrismaClient(databaseUrl("postgres"));
  try {
    await control.$executeRawUnsafe("CREATE DATABASE conversation_continuation");
  } finally {
    await control.$disconnect();
  }
  await execute(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--config",
      "apps/api/test/integration/prisma.config.ts",
    ],
    {
      cwd: repositoryRoot,
      timeout: 180_000,
      maxBuffer: 8_000_000,
      env: { ...process.env, DATABASE_URL: databaseUrl("conversation_continuation") },
    },
  );
  db = createPrismaClient(databaseUrl("conversation_continuation"));

  const owner = await db.user.create({
    data: {
      email: "continuation-owner@example.test",
      name: "Owner",
      role: "user",
      status: "active",
    },
  });
  const other = await db.user.create({
    data: {
      email: "continuation-other@example.test",
      name: "Other",
      role: "user",
      status: "active",
    },
  });
  const mac = await db.desktopDevice.create({
    data: {
      ownerId: owner.id,
      tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: owner.authValidAfter,
      name: "Mac",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
    },
  });
  const windows = await db.desktopDevice.create({
    data: {
      ownerId: owner.id,
      tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: owner.authValidAfter,
      name: "Windows",
      platform: "windows",
      arch: "amd64",
      appVersion: "0.1.0",
    },
  });
  const stale = await db.desktopDevice.create({
    data: {
      ownerId: owner.id,
      tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: new Date(owner.authValidAfter.getTime() - 1_000),
      name: "Stale Mac",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
    },
  });
  const revoked = await db.desktopDevice.create({
    data: {
      ownerId: owner.id,
      tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: owner.authValidAfter,
      revokedAt: new Date(),
      name: "Revoked Mac",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
    },
  });
  const otherMac = await db.desktopDevice.create({
    data: {
      ownerId: other.id,
      tokenHash: sha256(randomBytes(32).toString("hex")),
      authValidAfter: other.authValidAfter,
      name: "Other Mac",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
    },
  });

  const createSource = (overrides: Record<string, unknown> = {}) =>
    db!.conversation.create({
      data: {
        ownerId: owner.id,
        title: "Source task",
        titleSource: "manual",
        archiveStatus: "active",
        workspaceRelPath: `${owner.id}/home/workspace`,
        runtimeGeneration: randomUUID(),
        executionTarget: "cloud",
        ...overrides,
      },
    });
  const cloudSource = await createSource();
  const localSource = await createSource({
    executionTarget: "local",
    desktopDeviceId: mac.id,
  });
  const archived = await createSource({
    archiveStatus: "archived",
    archivedAt: new Date(),
  });
  const side = await createSource({ sideChatParentId: randomUUID() });
  const app = await createSource({
    applicationId: randomUUID(),
    applicationNameSnapshot: "Managed app",
  });
  const builder = await createSource();
  await db.applicationDevelopment.create({
    data: {
      ownerId: owner.id,
      conversationId: builder.id,
      workspaceRelPath: `${owner.id}/home/workspace`,
      name: "Builder",
      directory: "builder",
    },
  });
  const foreign = await db.conversation.create({
    data: {
      ownerId: other.id,
      title: "Foreign source",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `${other.id}/home/workspace`,
      runtimeGeneration: randomUUID(),
      executionTarget: "cloud",
    },
  });

  const workspaceRoot = join(root, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const config = testConfig();
  const redisClient = new LinkSenseRedis(config, redis.client);
  const runnerStarts = new Map<string, RunnerStartOperation>();
  const runner = {
    assertDesktopDeviceAvailable: async () => undefined,
    isDesktopConversation: async () => false,
    inspectRuntime: async () => null,
    acceptStartTurn: async (input: RunnerStartInput): Promise<RunnerStartOperation> => {
      assert(!runnerStarts.has(input.projectionTurnId), "the accepted start was replayed");
      const now = new Date().toISOString();
      const receipt = {
        status: "starting", conversationId: input.conversationId,
        projectionTurnId: input.projectionTurnId, createdAt: now, updatedAt: now,
      } as const;
      runnerStarts.set(input.projectionTurnId, receipt);
      return receipt;
    },
    inspectStartOperation: async (_conversationId: string, turnId: string) => runnerStarts.get(turnId) ?? null,
    interruptStartOperation: async () => ({ code: RUNNER_TURN_INTERRUPT_REQUESTED }),
    prepareRuntime: async (
      _conversationId: string,
      runOwnerId: string,
      workspacePath = "workspace",
      serviceSessionId?: string,
    ) => {
      await mkdir(
        serviceSessionId
          ? join(workspaceRoot, runOwnerId, "services", serviceSessionId, "home", workspacePath)
          : join(workspaceRoot, runOwnerId, "home", workspacePath),
        { recursive: true },
      );
      return {
        agentsTemplateVersion: "test",
        runtimeGeneration: randomUUID(),
      };
    },
  };
  const digest = sha256("");
  const modelRuntime = async (): Promise<ResolvedModelRuntime> => ({
    model: "fixture-model", reasoningEffort: "low",
    provider: { revision: 1, baseUrl: "https://model.example.test", apiKey: randomUUID(), protocolMode: "native_responses" },
  });
  const service = new ConversationService(
    db,
    redisClient,
    runner as never,
    new AuditService(db),
    {
      ensureUserHome: async () => undefined,
      resolve: async () => ({
        capabilities: [], capabilityGeneration: digest,
        capabilityVerification: { generation: digest, contentDigest: digest, sourceDigest: digest, pluginNames: [] },
      }),
      resolveRecovery: async () => ({}),
      resolveStartIntentRecovery: async () => ({}),
      withCapabilityStartBarrier: async (_input, action) => action(),
    } satisfies ConversationPreflight,
    workspaceRoot,
    {
      enqueueRuntimeCleanup: async () => undefined,
      enqueueConversationPrewarm: async () => undefined,
      enqueueFormRecommendation: async () => undefined,
    } as never,
    undefined,
    {
      resolveRuntime: modelRuntime,
      resolveRuntimeForSelection: modelRuntime,
      resolveModelTransitionRuntime: modelRuntime,
    },
  );
  const context = {
    actorId: owner.id,
    ipAddress: null,
    userAgent: null,
  };
  const run = (
    sourceId: string,
    requestId: string,
    executionTarget: "cloud" | "local",
    desktopDeviceId: string | null,
  ) =>
    service.continueConversation(
      owner.id,
      sourceId,
      { requestId, executionTarget, desktopDeviceId },
      context,
    );
  const destinationId = (sourceId: string, requestId: string) =>
    conversationContinuationId(owner.id, sourceId, requestId);
  const rejection = async (
    action: Promise<unknown>,
    code: string,
  ): Promise<void> => {
    await assert.rejects(action, (error: unknown) => {
      assert.equal((error as { code?: string }).code, code);
      return true;
    });
  };
  const auditRows = (targetId: string) =>
    db!.auditLog.findMany({ where: { targetId } });
  const receipt: string[] = [];

  // cloud -> local, independent workspace, fresh thread, one identity audit.
  const firstRequest = randomUUID();
  const first = await run(cloudSource.id, firstRequest, "local", mac.id);
  assert.equal(first.source.id, cloudSource.id);
  assert.equal(first.source.title, "Source task");
  assert.equal(first.conversation.id, destinationId(cloudSource.id, firstRequest));
  const firstRow = await db.conversation.findUniqueOrThrow({
    where: { id: first.conversation.id },
  });
  assert.equal(firstRow.ownerId, owner.id);
  assert.equal(firstRow.executionTarget, "local");
  assert.equal(firstRow.desktopDeviceId, mac.id);
  assert.equal(firstRow.codexThreadId, null);
  assert.equal(firstRow.applicationId, null);
  assert.equal(firstRow.projectId, null);
  assert.equal(firstRow.pinnedAt, null);
  assert.equal(firstRow.collaborationMode, "default");
  assert.equal(
    firstRow.workspaceRelPath,
    `${owner.id}/services/${firstRow.id}/home/workspace`,
  );
  assert.deepEqual(
    await db.conversation.findUniqueOrThrow({ where: { id: cloudSource.id } }),
    cloudSource,
  );
  const firstAudits = await auditRows(firstRow.id);
  assert.equal(firstAudits.length, 1);
  assert.equal(firstAudits[0]?.actorId, owner.id);
  assert.equal(firstAudits[0]?.action, "conversation_continued");
  assert.equal(firstAudits[0]?.targetType, "conversation");
  assert.equal(firstAudits[0]?.targetId, firstRow.id);
  assert.equal(firstAudits[0]?.result, "success");
  assert.deepEqual(firstAudits[0]?.metadataJson, {
    source_conversation_id: cloudSource.id,
    source_target: "cloud",
    execution_target: "local",
  });
  assert.equal(
    await db.conversationTurn.count({ where: { conversationId: firstRow.id } }),
    0,
  );
  assert.equal(
    await db.conversationFile.count({ where: { conversationId: firstRow.id } }),
    0,
  );
  assert.equal(
    await db.conversationTurn.count({ where: { conversationId: cloudSource.id } }),
    0,
  );
  assert.equal(
    await db.conversationFile.count({ where: { conversationId: cloudSource.id } }),
    0,
  );
  receipt.push("cloud_to_local");

  // local -> cloud.
  const secondRequest = randomUUID();
  const second = await run(localSource.id, secondRequest, "cloud", null);
  const secondRow = await db.conversation.findUniqueOrThrow({
    where: { id: second.conversation.id },
  });
  assert.equal(secondRow.executionTarget, "cloud");
  assert.equal(secondRow.desktopDeviceId, null);
  assert.equal(secondRow.workspaceRelPath, `${owner.id}/home/workspace`);
  assert.deepEqual(
    await db.conversation.findUniqueOrThrow({ where: { id: localSource.id } }),
    localSource,
  );
  assert.equal((await auditRows(secondRow.id)).length, 1);
  receipt.push("local_to_cloud");

  // Exact retry returns the same destination and source without new audit/work.
  const replay = await run(cloudSource.id, firstRequest, "local", mac.id);
  assert.deepEqual(replay, first);
  assert.equal((await auditRows(firstRow.id)).length, 1);
  assert.equal(
    await db.conversation.count({
      where: { id: destinationId(cloudSource.id, firstRequest) },
    }),
    1,
  );
  receipt.push("exact_replay");

  // Same request with a changed device or target conflicts without mutation.
  await rejection(
    run(cloudSource.id, firstRequest, "local", windows.id),
    "CONFLICT",
  );
  await rejection(
    run(cloudSource.id, firstRequest, "cloud", null),
    "CONFLICT",
  );
  const unchanged = await db.conversation.findUniqueOrThrow({
    where: { id: firstRow.id },
  });
  assert.equal(unchanged.executionTarget, "local");
  assert.equal(unchanged.desktopDeviceId, mac.id);
  assert.equal((await auditRows(firstRow.id)).length, 1);
  receipt.push("changed_destination_conflict");

  // UUID case variants are the same request and destination.
  const caseRequest = randomUUID();
  const caseLower = await run(cloudSource.id, caseRequest, "local", mac.id);
  const caseUpper = await run(
    cloudSource.id.toUpperCase(),
    caseRequest.toUpperCase(),
    "local",
    mac.id.toUpperCase(),
  );
  assert.equal(caseUpper.conversation.id, caseLower.conversation.id);
  assert.equal(caseUpper.conversation.id, destinationId(cloudSource.id, caseRequest));
  assert.equal((await auditRows(caseLower.conversation.id)).length, 1);
  receipt.push("uuid_case_normalized");

  // A seeded deterministic row is not a receipt and is never returned.
  const seededRequest = randomUUID();
  const seededId = destinationId(cloudSource.id, seededRequest);
  await db.conversation.create({
    data: {
      id: seededId,
      ownerId: owner.id,
      title: "Seeded without receipt",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `${owner.id}/services/${seededId}/home/workspace`,
      runtimeGeneration: randomUUID(),
      executionTarget: "local",
      desktopDeviceId: mac.id,
    },
  });
  await rejection(
    run(cloudSource.id, seededRequest, "local", mac.id),
    "CONFLICT",
  );
  assert.equal((await auditRows(seededId)).length, 0);
  await db.conversation.delete({ where: { id: seededId } });
  receipt.push("seeded_row_without_receipt");

  // A committed request whose destination was deleted cannot be recreated.
  const deletedRequest = randomUUID();
  const deletedDestination = await run(cloudSource.id, deletedRequest, "local", mac.id);
  await db.conversation.delete({ where: { id: deletedDestination.conversation.id } });
  await rejection(
    run(cloudSource.id, deletedRequest, "local", mac.id),
    "CONFLICT",
  );
  assert.equal(
    await db.conversation.count({ where: { id: deletedDestination.conversation.id } }),
    0,
  );
  assert.equal((await auditRows(deletedDestination.conversation.id)).length, 1);
  receipt.push("deleted_destination_not_recreated");

  // A later archived/renamed destination is replayed as-is, without reseeding.
  const modifiedRequest = randomUUID();
  const modifiedDestination = await run(cloudSource.id, modifiedRequest, "local", mac.id);
  await db.conversation.update({
    where: { id: modifiedDestination.conversation.id },
    data: { title: "Renamed after acceptance", titleSource: "manual", archiveStatus: "archived", archivedAt: new Date() },
  });
  const modifiedReplay = await run(cloudSource.id, modifiedRequest, "local", mac.id);
  assert.equal(modifiedReplay.conversation.title, "Renamed after acceptance");
  assert.equal(modifiedReplay.conversation.archive_status, "archived");
  assert.equal((await auditRows(modifiedDestination.conversation.id)).length, 1);
  receipt.push("modified_destination_preserved");

  // Concurrent retries serialize into one row and one audit.
  const concurrentRequest = randomUUID();
  const [concurrentA, concurrentB] = await Promise.all([
    run(cloudSource.id, concurrentRequest, "local", mac.id),
    run(cloudSource.id, concurrentRequest, "local", mac.id),
  ]);
  assert.equal(concurrentA.conversation.id, concurrentB.conversation.id);
  assert.equal(
    await db.conversation.count({
      where: { id: concurrentA.conversation.id },
    }),
    1,
  );
  assert.equal(
    (await auditRows(concurrentA.conversation.id)).length,
    1,
  );
  receipt.push("concurrent");

  // Ineligible or unavailable sources and devices are rejected.
  await rejection(
    run(cloudSource.id, randomUUID(), "cloud", null),
    "VALIDATION_ERROR",
  );
  await rejection(
    run(randomUUID(), randomUUID(), "local", mac.id),
    "CONVERSATION_NOT_FOUND",
  );
  await rejection(
    run(foreign.id, randomUUID(), "local", mac.id),
    "CONVERSATION_NOT_FOUND",
  );
  await rejection(
    run(archived.id, randomUUID(), "local", mac.id),
    "CONFLICT",
  );
  await rejection(
    run(side.id, randomUUID(), "local", mac.id),
    "CONVERSATION_NOT_FOUND",
  );
  await rejection(
    run(app.id, randomUUID(), "local", mac.id),
    "CONVERSATION_NOT_FOUND",
  );
  await rejection(
    run(builder.id, randomUUID(), "local", mac.id),
    "CONVERSATION_NOT_FOUND",
  );
  await rejection(
    run(cloudSource.id, randomUUID(), "local", randomUUID()),
    "FORBIDDEN",
  );
  await rejection(
    run(cloudSource.id, randomUUID(), "local", windows.id),
    "FORBIDDEN",
  );
  await rejection(
    run(cloudSource.id, randomUUID(), "local", stale.id),
    "FORBIDDEN",
  );
  await rejection(
    run(cloudSource.id, randomUUID(), "local", revoked.id),
    "FORBIDDEN",
  );
  await rejection(
    run(cloudSource.id, randomUUID(), "local", otherMac.id),
    "FORBIDDEN",
  );
  receipt.push("eligibility_and_device_rejections");

  // A failed audit insert rolls back the destination and its usage row.
  const rollbackRequest = randomUUID();
  const rollbackDestination = destinationId(localSource.id, rollbackRequest);
  await db.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION fail_continuation_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action = 'conversation_continued'
         AND NEW.target_id = '${rollbackDestination}' THEN
        RAISE EXCEPTION 'continuation audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER fail_continuation_audit_trigger
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fail_continuation_audit()`);
  try {
    await assert.rejects(
      run(localSource.id, rollbackRequest, "cloud", null),
      /continuation audit failure/u,
    );
    assert.equal(
      await db.conversation.findUnique({
        where: { id: rollbackDestination },
      }),
      null,
    );
    assert.equal((await auditRows(rollbackDestination)).length, 0);
    assert.equal(
      await db.usageActivityRecord.count({
        where: { conversationId: rollbackDestination },
      }),
      0,
    );
  } finally {
    await db.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS fail_continuation_audit_trigger ON audit_logs",
    );
    await db.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS fail_continuation_audit()",
    );
  }
  receipt.push("atomic_audit_rollback");

  // Historical cloud source (all existing columns, no new metadata) still works.
  const historical = await db.conversation.findUniqueOrThrow({
    where: { id: cloudSource.id },
  });
  assert.equal(historical.executionTarget, "cloud");
  receipt.push("historical_cloud_source");

  // Hold the mock runner receipt after real cloud start admission. The read
  // uses the deployed worker request shape and real HTTP response close.
  const capacity = await redisClient.acquireRunningTurnReconcileLease();
  assert(capacity);
  try {
    const attempt = await redisClient.beginRunningTurnRecoveryAttempt(capacity, new Date().toISOString());
    assert(attempt);
    assert(await redisClient.completeRunningTurnRecoveryAttempt(attempt, {
      outcome: "succeeded", completedAt: new Date().toISOString(),
    }));
  } finally {
    await redisClient.releaseRunningTurnReconcileLease(capacity);
  }
  const historyText = `Fixture reference history ${randomUUID()}`;
  const sourceThread = randomUUID();
  await db.conversation.update({ where: { id: localSource.id }, data: { codexThreadId: sourceThread } });
  const sourceTurn = await db.conversationTurn.create({ data: {
    conversationId: localSource.id, submittedBy: owner.id, sequenceNo: 1,
    codexThreadId: sourceThread, codexTurnId: randomUUID(), status: "completed", submitMode: "normal",
    capabilityGeneration: digest, capabilitiesJson: [], startedAt: new Date(), completedAt: new Date(),
  } });
  const sourceMessage = await db.conversationMessage.create({ data: {
    conversationId: localSource.id, turnId: sourceTurn.id, sequenceNo: 1, role: "assistant", contentText: historyText,
  } });

  // Observe read-only database traffic, without replacing any Prisma queries.
  const readDb = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl("conversation_continuation") }),
    log: [{ level: "query", emit: "event" }],
  });
  let projectionProbes = 0;
  let historyReads = 0;
  let onProbe: (() => void) | undefined;
  readDb.$on("query", ({ query }) => {
    if (/\bconversation_turns\b/u.test(query)) {
      projectionProbes++;
      onProbe?.();
    }
    if (/\bconversation_messages\b/u.test(query)) historyReads++;
  });
  const readApi = Fastify();
  let onAbortError: ((error: unknown) => void) | undefined;
  const aborted = new Promise<unknown>(resolve => { onAbortError = resolve; });
  readApi.addHook("onError", async (request, _reply, error) => {
    if (request.headers["x-fixture-abort"]) onAbortError?.(error);
  });
  readApi.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  registerRunnerRuntimeScope(readApi, readDb, config.runnerSharedSecret);
  try {
    await readApi.register(internalConversationReferenceRoutes, {
      prefix: "/internal", prisma: readDb, sharedSecret: config.runnerSharedSecret,
    });
    const origin = await readApi.listen({ host: "127.0.0.1", port: 0 });
    const post = (conversationId: string, turnId: string, sourceId = localSource.id, cancel?: AbortController) =>
      fetch(`${origin}/internal/conversation-references/read`, {
        method: "POST",
        headers: { authorization: `Bearer ${config.runnerSharedSecret}`, "x-linksense-owner-id": owner.id,
          "content-type": "application/json", ...(cancel && { "x-fixture-abort": "1" }) },
        body: JSON.stringify({ conversationId, turnId, input: { conversation_id: sourceId } }),
        signal: cancel ? AbortSignal.any([cancel.signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
      });
    const assertError = async (response: Response, status: number, code: string) => {
      assert.equal(response.status, status);
      const body = await response.text();
      assert.equal(JSON.parse(body).error_code, code);
      assert(!body.includes(historyText));
    };
    const readBeforeProjection = async (send: () => Promise<Response>) => {
      const before = projectionProbes;
      const probed = new Promise<"probed">(resolve => {
        onProbe = () => { if (projectionProbes >= before + 2) resolve("probed"); };
      });
      const response = send();
      // Attach both settle handlers immediately, including on the red path.
      try {
        const first = await Promise.race([probed, response.then(res => res.status)]);
        assert.equal(first, "probed", "the reference read returned before the running projection committed");
      } finally {
        onProbe = undefined;
      }
      return { response };
    };
    const holdStart = async (conversationId: string) => {
      // Leave settlement to the exact start.settled callback path, rather than
      // the background recovery observer racing this test to the same receipt.
      assert(await redisClient.acquireRecoveryLock(conversationId, 30_000));
      const accepted = await service.acceptTurn(owner.id, conversationId, {
        officeAnnotation: { kind: "task_references", request: "Read the selected task", conversation_ids: [localSource.id] },
        submitMode: "normal", priorityCapabilityIds: [], idempotencyKey: randomUUID(),
      }, context);
      assert.equal(accepted.status, "starting");
      const intent = await db!.conversationTurnStartIntent.findUniqueOrThrow({ where: { projectionTurnId: accepted.turn_id } });
      assert.equal(intent.runnerStatus, "prepared");
      assert.equal(await db!.conversationTurn.findUnique({ where: { id: accepted.turn_id } }), null);
      return intent;
    };
    const nativeStarted = (turnId: string) => {
      const start = runnerStarts.get(turnId);
      assert(start?.status === "starting");
      const result = { codexThreadId: randomUUID(), codexTurnId: randomUUID() };
      runnerStarts.set(turnId, { ...start, status: "succeeded", result });
      return result;
    };
    const firstIntent = await holdStart(secondRow.id);
    const early = await readBeforeProjection(() => post(secondRow.id, firstIntent.projectionTurnId));
    assert.equal(historyReads, 0);
    nativeStarted(firstIntent.projectionTurnId);
    assert(await service.settleStartOperation(owner.id, {
      conversationId: secondRow.id, projectionTurnId: firstIntent.projectionTurnId, runtimeGeneration: firstIntent.runtimeGeneration,
    }));
    const result = await early.response;
    assert.equal(result.status, 200);
    const messages = readConversationReferenceResultSchema.parse(await result.json()).messages;
    assert.deepEqual(messages, [{ id: sourceMessage.id, role: "assistant", text: historyText }]);
    assert.equal(await db.conversationTurnStartIntent.findUnique({ where: { projectionTurnId: firstIntent.projectionTurnId } }), null);
    assert.equal(historyReads, 1);

    // Archived sources with an already-committed grant are still readable.
    await db.conversation.update({ where: { id: localSource.id }, data: { archiveStatus: "archived", archivedAt: new Date() } });
    const archivedRead = await post(secondRow.id, firstIntent.projectionTurnId);
    assert.equal(archivedRead.status, 200);
    assert.deepEqual(readConversationReferenceResultSchema.parse(await archivedRead.json()).messages, messages);
    assert.equal(historyReads, 2);
    const deny = async (conversationId: string, turnId: string, sourceId?: string) => {
      const before = projectionProbes;
      await assertError(await post(conversationId, turnId, sourceId), 403, "FORBIDDEN");
      assert(projectionProbes - before <= 2, "an ineligible read polled for a projection");
      assert.equal(historyReads, 2);
    };
    const firstStartedTurn = { id: firstIntent.projectionTurnId };
    await db.conversationTurn.update({ where: firstStartedTurn, data: { interruptRequestedAt: new Date() } });
    await deny(secondRow.id, firstIntent.projectionTurnId);
    await db.conversationTurn.update({ where: firstStartedTurn, data: { status: "completed", completedAt: new Date() } });
    await deny(secondRow.id, firstIntent.projectionTurnId);
    await db.conversationTurn.update({ where: firstStartedTurn, data: { status: "running", completedAt: null, interruptRequestedAt: null } });
    assert.equal((await db.conversationEvent.deleteMany({ where: {
      conversationId: secondRow.id, turnId: firstIntent.projectionTurnId, eventType: "conversation.message.display_context",
    } })).count, 1);
    await deny(secondRow.id, firstIntent.projectionTurnId);

    const pending = await holdStart((await createSource()).id);
    const { conversationId, projectionTurnId: turnId } = pending;
    await deny(conversationId, turnId, cloudSource.id);
    await deny(conversationId, randomUUID());
    await db.conversation.update({ where: { id: conversationId }, data: { runtimeGeneration: randomUUID() } });
    await deny(conversationId, turnId);
    await db.conversation.update({ where: { id: conversationId }, data: { runtimeGeneration: pending.runtimeGeneration } });
    await db.conversationTurnStartIntent.update({ where: { projectionTurnId: turnId }, data: { messageDisplayJson: Prisma.DbNull } });
    await deny(conversationId, turnId); // The raw input still carries the original reference annotation.
    assert(pending.messageDisplayJson !== null);
    await db.conversationTurnStartIntent.update({ where: { projectionTurnId: turnId }, data: { messageDisplayJson: pending.messageDisplayJson } });
    const cancel = new AbortController();
    const reading = await readBeforeProjection(() => post(conversationId, turnId, undefined, cancel));
    cancel.abort();
    await assert.rejects(reading.response, { name: "AbortError" });
    const abortOutcome = await Promise.race([aborted, delay(1_000, null, { ref: false })]);
    assert(abortOutcome instanceof AppError && abortOutcome.code === "RUNNER_UNAVAILABLE", "response close did not promptly stop the fence");
    assert.equal(historyReads, 2);

    // Also bound a read while runner success is durable but not yet projected.
    await db.conversationTurnStartIntent.update({ where: { projectionTurnId: turnId }, data: {
      runnerStatus: "runner_succeeded", ...nativeStarted(turnId),
    } });
    const waiting = await readBeforeProjection(() => post(conversationId, turnId));
    await assertError(await waiting.response, 503, "RUNNER_UNAVAILABLE");
    assert.equal(historyReads, 2);
    assert.equal(await db.conversationTurn.findUnique({ where: { id: turnId } }), null);
    assert.equal((await service.interrupt(owner.id, conversationId, turnId, context)).code, RUNNER_TURN_INTERRUPT_REQUESTED);
    await deny(conversationId, turnId);
    assert(await service.settleStartOperation(owner.id, {
      conversationId, projectionTurnId: turnId, runtimeGeneration: pending.runtimeGeneration,
    }));
    await deny(conversationId, turnId); // Stop preceded the running projection, which cannot clear it.
    receipt.push("cloud_first_read_projection_fence");
  } finally {
    await readApi.close();
    await readDb.$disconnect();
  }

  console.log(JSON.stringify({ ok: true, checks: receipt }));
} finally {
  await db?.$disconnect();
  await redis.close();
  if (pgStarted) {
    await execute("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
      timeout: 30_000,
    }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
}
