import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import {
  conversationStartFailurePayloadSchema,
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  desktopExecutionAckSchema,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopProtocolVersion,
  desktopToolMaxInFlight,
  desktopToolProtocolVersion,
  desktopToolRequestLifetimeMs,
  desktopToolResultSchema,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
  type DesktopToolRequest,
} from "@linksense/shared";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { WebSocket } from "ws";

import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { RunnerClient } from "../../src/adapters/runner.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { projectWorkspaceRelativePath } from "../../src/lib/user-runtime-paths.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { ConversationService } from "../../src/modules/conversations/service.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { registerDesktopExecution } from "../../src/modules/desktop-devices/execution.js";
import { desktopNoticeChannel, type DesktopNotice } from "../../src/modules/desktop-devices/notices.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { registerDesktopDeviceRoutes } from "../../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { TaskRecoveryScheduler, type TaskRecoveryQueueControl } from "../../src/modules/events/recovery-scheduler.js";
import { ConversationEventService } from "../../src/modules/events/service.js";
import { PrivacyMaskingSettingsService } from "../../src/modules/privacy-masking/service.js";
import { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import { WebSearchSettingsService } from "../../src/modules/system/web-search-settings.js";
import { CreditLimitService } from "../../src/modules/usage/credit-limit.js";
import { createRedisFixture } from "../fixtures/redis.js";
import { testConfig } from "../test-config.js";
import { verifyPackagedDesktopGateway } from "./desktop-package-roundtrip.js";
import { verifyLocalComputerSessions } from "./local-computer-sessions.js";

const capabilityGeneration = "0".repeat(64);
type RecoveryJobData = Parameters<TaskRecoveryQueueControl["add"]>[1];
type RecoveryJobName = RecoveryJobData["type"];

export async function verifyDesktopExecutionProjection(input: {
  prisma: PrismaClient;
  ownerId: string;
  deviceId: string;
  token: string;
  databaseUrl: string;
  workspaceRoot: string;
  otherOwnerId: string;
  legacyConversationId: string;
  cloudConversationId: string;
}): Promise<void> {
  const { prisma, ownerId, deviceId, token } = input;
  const config = testConfig({
    DATABASE_URL: input.databaseUrl,
    LINKSENSE_USER_DATA_ROOT: input.workspaceRoot,
    LINKSENSE_RUNNER_URL: "http://127.0.0.1:1",
    LINKSENSE_DESKTOP_LOCAL_EXECUTION_ENABLED: "true",
    LINKSENSE_CREDENTIAL_MASTER_KEY: randomBytes(32).toString("base64"),
    LINKSENSE_RUNNER_SHARED_SECRET: randomUUID(),
  });
  const fixture = await createRedisFixture();
  const socketPath = fixture.client.options.path;
  assert(socketPath, "fixture Redis must use its private socket");
  const queue = new Queue<RecoveryJobData, void, RecoveryJobName>(
    "desktop-projection-fixture", { connection: { path: socketPath } },
  );
  const app = Fastify();
  const sockets: WebSocket[] = [];
  try {
    const redis = new LinkSenseRedis(config, fixture.client);
    const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
    const runner = new RunnerClient(config, async (owner, conversationId) => {
      const row = await prisma.conversation.findFirst({
        where: { id: conversationId, ownerId: owner },
        select: { executionTarget: true },
      });
      return row?.executionTarget === "local" ? "local" : null;
    });
    const outsideFixture = async (): Promise<never> => { throw new Error("Unexpected cloud or user-authentication call"); };
    const modelProviderSettings = new ModelProviderSettingsService(prisma, config);
    const creditLimits = new CreditLimitService(prisma, { timeZone: config.billingTimeZone });
    const privacyMaskingSettings = new PrivacyMaskingSettingsService(prisma, config);
    const audit = new AuditService(prisma);
    const searchKey = randomUUID();
    const searchCalls: string[] = [];
    const searchMarker = `desktop-search-result-${randomUUID()}`;
    let searchAborts = 0;
    const webSearchSettings = new WebSearchSettingsService(prisma, config, async (_runtime, request, signal) => {
      searchCalls.push(request.query);
      if (request.query === "fixture pending search") {
        try { await delay(15_000, null, { signal }); } finally { if (signal?.aborted) searchAborts++; }
      }
      return {
        success: true, provider: "brave", query: request.query,
        results: [{ title: searchMarker, url: "https://fixture.example.test/", snippet: "Isolated search result", summary: null, published_at: null }],
      };
    });
    await webSearchSettings.update(ownerId, {
      enabled: true, provider: "brave", base_url: null, search_engine_id: null,
      default_max_results: 1, timeout_ms: 20_000, expected_revision: 0, api_key: searchKey,
    }, {});
    const conversations = new ConversationService(
      prisma, redis, runner, audit,
      {
        ensureUserHome: outsideFixture, resolve: outsideFixture, resolveRecovery: outsideFixture,
        resolveStartIntentRecovery: outsideFixture, withCapabilityStartBarrier: outsideFixture,
      },
      input.workspaceRoot,
      {
        enqueueRuntimeCleanup: outsideFixture, enqueueConversationPrewarm: outsideFixture,
        enqueueFormRecommendation: outsideFixture,
      },
      undefined, modelProviderSettings, undefined, creditLimits,
    );
    const events = new ConversationEventService(prisma, redis, conversations);
    const local = await verifyLocalComputerSessions({ ...input, conversations });
    const recovery = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    events.configureRecoveryScheduler(recovery);
    const execution = await registerDesktopExecution(app, {
      config, prisma, redis, runner, conversations, events,
      modelProviderSettings, creditLimits, privacyMaskingSettings, webSearchSettings, audit,
    }, coordinator);
    assert(execution, "Mac execution must be enabled in this fixture");
    let rejectNextRecovery = false;
    app.decorate("authenticate", async request => {
      request.authUser = {
        id: ownerId, name: "Desktop owner", email: "desktop-owner@example.test",
        role: "user", status: "active", preferredLocale: null, avatarObjectKey: null, authValidAfter: new Date(0),
      };
    });
    await registerDesktopDeviceRoutes(app, {
      service: new DesktopDeviceService(new PrismaDesktopDeviceRepository(prisma), coordinator),
      redis: redis.client, rateLimitHmacSecret: config.loginRateLimitHmacSecret, execution,
      onExecutionReady: binding => {
        if (!rejectNextRecovery) return events.scheduleDesktopRecovery(binding);
        rejectNextRecovery = false;
        return Promise.reject(new Error("fixture recovery dispatch is unavailable"));
      },
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const connect = async (expectRecovery = true, tools = false) => {
      const url = new URL("/api/v1/desktop/devices/socket", address);
      url.protocol = "ws:";
      const socket = new WebSocket(url, {
        headers: {
          [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion),
          ...(tools ? { [DESKTOP_TOOL_PROTOCOL_HEADER]: String(desktopToolProtocolVersion) } : {}),
        },
      });
      sockets.push(socket);
      await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
      const closed = once(socket, "close");
      const ready = desktopExecutionDeviceReadySchema.parse(await exchange(socket, {
        type: "hello", token, protocol_version: desktopProtocolVersion,
      }));
      assert.equal(ready.device_id, deviceId);
      assert.equal(ready.tool_protocol_version, tools ? desktopToolProtocolVersion : undefined);
      if (!expectRecovery) {
        await Promise.race([closed, delay(5_000, null, { ref: false }).then(() => { throw new Error("socket did not close"); })]);
        return { socket, connectionId: ready.connection_id, recoveryJob: null };
      }
      const deadline = Date.now() + 1_000;
      for (;;) {
        const recoveryJob = await queue.getJob(`desktop-${ready.connection_id}-first`);
        if (recoveryJob) return { socket, connectionId: ready.connection_id, recoveryJob };
        assert(Date.now() < deadline, "execution-ready hook did not enqueue reconnect recovery");
        await delay(10);
      }
    };
    rejectNextRecovery = true;
    await connect(false);
    const initial = await connect(true, true);
    await initial.recoveryJob?.remove();
    await events.recoverRunningTurns();

    const threadId = randomUUID(), nativeTurnId = randomUUID(), turnId = randomUUID();
    const conversation = await prisma.conversation.create({ data: {
      ownerId, title: "Desktop execution projection", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${ownerId}/home/workspaces/${randomUUID()}`, runtimeGeneration: randomUUID(),
      executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: threadId,
    } });
    const conversationId = conversation.id;
    const runtimeGeneration = conversation.runtimeGeneration;
    await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: turnId, ownerId, conversationId, runtimeGeneration, capabilityGeneration,
      inputText: "Confirm this Mac can publish", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared",
    } });
    assert.equal((await redis.acquireTurnSlot(conversationId, turnId, ownerId)).acquired, true);

    const callbackScope = { conversation_id: conversationId, turn_id: turnId, runtime_generation: runtimeGeneration };
    const receiptBase = {
      conversationId, projectionTurnId: turnId,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const commandScope = (command: DesktopExecutionCommand) => {
      assert.equal(command.conversation_id, conversationId);
      assert.equal(command.owner_id, ownerId);
      assert.equal(command.runtime_generation, runtimeGeneration);
      assert.equal(command.turn_id, turnId);
    };
    const [, start] = await Promise.all([
      runner.acceptStartTurn({
        ownerId, conversationId, projectionTurnId: turnId, expectedRuntimeGeneration: runtimeGeneration,
        appServerProcessLimit: 1, capabilityGeneration, mcpGeneration: capabilityGeneration,
        codexThreadId: threadId, collaborationMode: "default", mcpServers: [], capabilities: [], environment: {},
        context: { userInput: "Confirm this Mac can publish", attachments: [], priorityPlugins: [], prioritySkills: [] },
        model: "fixture-model", reasoningEffort: "low",
        modelProvider: {
          revision: 1, baseUrl: "https://fixture-provider.example.test", apiKey: randomUUID(),
          protocolMode: "native_responses",
        },
      }),
      readCommand(initial.socket).then(command => {
        commandScope(command);
        assert(command.operation === "turn.start");
        assert.equal(command.body.native_thread_id, threadId);
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: true,
          result: { ...receiptBase, status: "starting" },
        });
        return command;
      }),
    ]);
    const inspect = desktopExecutionCommandSchema.parse(await exchange(initial.socket, {
      type: "execution.callback", id: randomUUID(), operation: "start.settled", ...callbackScope,
      run_token: start.body.credentials.run_token,
      body: { conversationId, projectionTurnId: turnId, runtimeGeneration },
    } satisfies DesktopExecutionCallback));
    commandScope(inspect);
    assert.equal(inspect.operation, "turn.inspect");
    const settlement = desktopExecutionAckSchema.parse(await exchange(initial.socket, {
      type: "command.result", id: inspect.id, operation: inspect.operation, ok: true,
      result: { ...receiptBase, status: "succeeded", result: { codexThreadId: threadId, codexTurnId: nativeTurnId } },
    }));
    assert(settlement.ok && settlement.operation === "start.settled" && settlement.data.settled);

    const tool: DesktopToolRequest = {
      type: "tool.request", id: randomUUID(), operation: "web.search", ...callbackScope,
      expires_at: new Date(Date.now() + desktopToolRequestLifetimeMs).toISOString(),
      run_token: start.body.credentials.run_token, body: { query: "fixture search" },
    };
    const invokeTool = async (frame = tool) => desktopToolResultSchema.parse(await exchange(initial.socket, frame));
    const unauthorized = await invokeTool({ ...tool, turn_id: randomUUID() });
    assert(!unauthorized.ok && unauthorized.error_code === "FORBIDDEN");
    const expired = await invokeTool({ ...tool, expires_at: new Date(Date.now() - 1).toISOString() });
    assert(!expired.ok && expired.error_code === "RUNNER_UNAVAILABLE");
    assert.equal(searchCalls.length, 0);
    const search = await invokeTool();
    assert(search.ok && search.data.results[0]?.title === searchMarker);
    const replay = await invokeTool({ ...tool, id: tool.id.toUpperCase() });
    assert(!replay.ok && replay.error_code === "RUNNER_OPERATION_UNCERTAIN");
    assert.deepEqual(searchCalls, [tool.body.query]);
    const audits = await prisma.auditLog.findMany({
      where: { action: "desktop_tool_requested", targetId: tool.id },
      select: { result: true, actorId: true, metadataJson: true },
    });
    assert.deepEqual(audits, [{
      result: "success", actorId: ownerId,
      metadataJson: { operation: "web.search", conversation_id: conversationId, turn_id: turnId, device_id: deviceId },
    }]);
    const pendingTool = { ...tool, id: randomUUID(), body: { query: "fixture pending search" } };
    const searches = [pendingTool, ...Array.from({ length: desktopToolMaxInFlight - 1 }, () =>
      ({ ...pendingTool, id: randomUUID() }))];
    const expectedSearchCalls = searchCalls.length + searches.length;
    for (const request of searches) send(initial.socket, request);
    for (let retry = 0; searchCalls.length < expectedSearchCalls && retry < 100; retry++) await delay(10);
    assert.equal(searchCalls.length, expectedSearchCalls);
    const full = await invokeTool({ ...tool, id: randomUUID() });
    assert(!full.ok && full.error_code === "RUNNER_UNAVAILABLE");

    const answer = {
      deliveryId: randomUUID(),
      event: {
        method: "item/completed", visibility: "user_visible",
        params: {
          threadId, turnId: nativeTurnId,
          item: { id: randomUUID(), type: "agentMessage", phase: "final_answer", text: "Mac output was projected." },
        },
      },
    } satisfies EventDelivery;
    const terminal = {
      deliveryId: randomUUID(),
      event: {
        method: "turn/completed", visibility: "user_visible",
        params: { threadId, turn: { id: nativeTurnId, status: "completed" } },
      },
    } satisfies EventDelivery;
    const sendLive = (socket: WebSocket, entries: EventDelivery[], scope = callbackScope) => sendEvents(socket, {
      type: "execution.callback", operation: "events", id: randomUUID(), ...scope,
      run_token: start.body.credentials.run_token, body: { conversationId, events: entries },
    });
    const foreignNativeTurn = { ...answer, event: { ...answer.event, params: { ...answer.event.params, turnId: randomUUID() } } };
    for (const response of [
      await sendLive(initial.socket, [answer], { ...callbackScope, turn_id: randomUUID() }),
      await sendLive(initial.socket, [answer], { ...callbackScope, runtime_generation: randomUUID() }),
      await sendLive(initial.socket, [foreignNativeTurn]),
    ]) assert(!response.ok && response.error_code === "FORBIDDEN");
    const history = () => events.historyPage(ownerId, conversationId, { afterSequence: 0n, limit: 50 });
    assert.deepEqual((await history()).items, []);
    assertAccepted(await sendLive(initial.socket, [answer]), [answer.deliveryId]);
    for (const request of searches) {
      send(initial.socket, { type: "tool.cancel", ...callbackScope, id: request.id, operation: tool.operation });
    }
    for (let retry = 0; searchAborts < searches.length && retry < 100; retry++) await delay(10);
    assert.equal(searchAborts, searches.length);
    const unsupportedGoal = {
      deliveryId: randomUUID(),
      event: {
        method: "thread/goal/updated", visibility: "user_visible",
        params: {
          threadId, turnId: nativeTurnId, goal: {
            threadId, objective: "Not a supported task mode", status: "active",
            tokenBudget: null, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
          },
        },
      },
    } satisfies EventDelivery;
    assertAccepted(await sendLive(initial.socket, [unsupportedGoal]), [unsupportedGoal.deliveryId]);
    assert.equal(await prisma.conversationGoal.count({ where: { conversationId } }), 0);

    await redis.recordRunnerHeartbeat(ownerId);
    const exit = {
      type: "execution.callback", id: randomUUID(), operation: "turn.exited", ...callbackScope,
      run_token: start.body.credentials.run_token,
    } satisfies DesktopExecutionCallback;
    const wrongExit = desktopExecutionAckSchema.parse(await exchange(initial.socket, { ...exit, turn_id: randomUUID() }));
    assert(!wrongExit.ok && wrongExit.error_code === "FORBIDDEN");
    assert.deepEqual(desktopExecutionAckSchema.parse(await exchange(initial.socket, exit)), {
      type: "execution.ack", ok: true, operation: "turn.exited", id: exit.id,
    });
    const exitJobs = await queue.getJobs(["waiting"]);
    assert.equal(exitJobs.length, 1);
    const [exitJob] = exitJobs;
    assert(exitJob && exitJob.data.type === "desktop-turn");
    assert.equal(exitJob.data.connectionId, initial.connectionId);
    await Promise.all([
      assert.rejects(recovery.process(exitJob), { message: "RUNNING_TURN_RECOVERY_FAILED" }),
      readCommand(initial.socket).then(command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: false,
          error_code: "RUNNER_OPERATION_UNCERTAIN",
        });
      }),
    ]);
    await exitJob.remove();

    const [expiryJob] = await queue.getJobs(["delayed"]);
    assert(expiryJob && expiryJob.data.type === "desktop-turn");
    assert.equal(expiryJob.data.projectionTurnId, turnId);
    assert.equal(expiryJob.data.connectionId, initial.connectionId);
    assert((expiryJob.opts.delay ?? 0) > 0);
    // Accelerate Redis expiry; neither the Mac nor its cloud runner disconnects.
    const leaseKey = `linksense:desktop-run:${turnId}`;
    const revokingTool = {
      ...pendingTool, id: randomUUID(),
      expires_at: new Date(Date.now() + desktopToolRequestLifetimeMs).toISOString(),
    };
    send(initial.socket, revokingTool);
    for (let retry = 0; searchCalls.length <= expectedSearchCalls && retry < 100; retry++) await delay(10);
    assert.equal(searchCalls.length, expectedSearchCalls + 1);
    assert.equal(await redis.client.pexpire(leaseKey, 1), 1);
    const expiryDeadline = Date.now() + 1_000;
    while (await redis.client.exists(leaseKey)) {
      assert(Date.now() < expiryDeadline, "fixture lease did not expire");
      await delay(10);
    }
    await redis.client.publish(desktopNoticeChannel, JSON.stringify({ type: "run_revoked", turnId } satisfies DesktopNotice));
    for (let retry = 0; searchAborts <= searches.length && retry < 100; retry++) await delay(10);
    assert.equal(searchAborts, searches.length + 1);
    const expiredAck = await sendLive(initial.socket, [terminal]);
    assert(!expiredAck.ok && expiredAck.error_code === "FORBIDDEN");
    await Promise.all([
      assert.rejects(recovery.process(expiryJob), { message: "RUNNING_TURN_RECOVERY_FAILED" }),
      readCommand(initial.socket).then(async command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        const ack = await sendEvents(initial.socket, {
          type: "execution.recovery", operation: "events", id: randomUUID(), drain_id: command.id,
          ...callbackScope, body: { conversationId, events: [answer] },
        });
        assertAccepted(ack, [answer.deliveryId]);
        send(initial.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: false,
          error_code: "RUNNER_OPERATION_UNCERTAIN",
        });
      }),
    ]);
    await expiryJob.remove();

    const replacement = await connect();
    assert.notEqual(replacement.connectionId, initial.connectionId);
    const stale = await sendLive(replacement.socket, [terminal]);
    assert(!stale.ok && stale.error_code === "FORBIDDEN", "Reconnect must not adopt the prior connection's lease");
    const [recovered] = await Promise.all([
      events.reconcileAfterProcessExit(
        { conversationId, projectionTurnId: turnId, capabilityGeneration },
        { desktopConnectionId: replacement.connectionId },
      ),
      readCommand(replacement.socket).then(async command => {
        commandScope(command);
        assert.equal(command.operation, "turn.drain");
        const replay = (entries: EventDelivery[]) => sendEvents(replacement.socket, {
          type: "execution.recovery", operation: "events", id: randomUUID(), drain_id: command.id,
          ...callbackScope, body: { conversationId, events: entries },
        });
        const ids = [answer.deliveryId, terminal.deliveryId];
        assertAccepted(await replay([answer, terminal]), ids);
        assertAccepted(await replay([answer, terminal]), ids);
        const duplicateNativeTerminal = { ...terminal, deliveryId: randomUUID() };
        assertAccepted(await replay([duplicateNativeTerminal]), [duplicateNativeTerminal.deliveryId]);
        send(replacement.socket, {
          type: "command.result", id: command.id, operation: command.operation, ok: true,
          result: { drained: true },
        });
      }),
    ]);
    assert.equal(recovered.outcome, "succeeded");
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);
    const turn = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    assert.equal(turn.status, "completed");
    const projected = (await history()).items.filter(item =>
      item.event_type === "item/completed" || item.event_type === "turn/completed",
    );
    assert.deepEqual(projected.map(({ id, turn_id }) => [id, turn_id]), [
      [answer.deliveryId, turnId], [terminal.deliveryId, turnId],
    ]);
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId, turnId, role: "assistant" } }), 1);
    assert.equal((await redis.acquireTurnSlot(conversationId, turnId, ownerId)).acquired, true);
    const reconnect = replacement.recoveryJob;
    assert(reconnect && reconnect.data.type === "desktop");
    await recovery.process(reconnect);
    const release = (await queue.getJobs(["waiting"])).find(job =>
      job.data.type === "desktop-turn" && job.data.projectionTurnId === turnId,
    );
    assert(release, "reconnect must discover a terminal turn with a surviving slot");
    await recovery.process(release);
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);

    const runtimeRoot = process.env.LINKSENSE_DESKTOP_RUNTIME_DIST;
    if (runtimeRoot) {
      replacement.socket.terminate();
      await verifyPackagedDesktopGateway({
        runtimeRoot, scratch: input.workspaceRoot, address, prisma, redis, coordinator, conversations,
        events, modelProviderSettings, ownerId, deviceId, token, previousConnectionId: replacement.connectionId,
        serverSecrets: [config.credentialMasterKey, config.runnerSharedSecret, searchKey],
        searchMarker,
      });
    }
    const revokedThread = randomUUID();
    const running = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task awaiting a native outcome", titleSource: "manual", archiveStatus: "archived",
      archivedAt: new Date(),
      workspaceRelPath: `${ownerId}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: revokedThread,
    } });
    const runningTurn = await prisma.conversationTurn.create({ data: {
      conversationId: running.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: revokedThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const partial = await prisma.conversationMessage.create({ data: {
      conversationId: running.id, turnId: runningTurn.id, sequenceNo: 1,
      role: "assistant", contentText: "Already delivered output",
    } });
    const completeItem = "completed-mac-item";
    const streamingItem = "streaming-mac-item";
    const nativeParams = { threadId: revokedThread, turnId: runningTurn.codexTurnId };
    for (const [index, [method, params]] of ([
      ["item/agentMessage/delta", { ...nativeParams, itemId: completeItem, delta: partial.contentText }],
      ["item/completed", { ...nativeParams, item: { type: "agentMessage", id: completeItem, text: partial.contentText, phase: "commentary" } }],
      ["item/agentMessage/delta", { ...nativeParams, itemId: streamingItem, delta: "Streamed " }],
      ["item/agentMessage/delta", { ...nativeParams, itemId: streamingItem, delta: "before revocation" }],
    ] as const).entries()) {
      await prisma.conversationEvent.create({ data: {
        conversationId: running.id, turnId: runningTurn.id, sequenceNo: index + 1,
        sseEventId: `${running.id}:${index + 1}`, eventType: method, visibility: "user_visible",
        payloadJson: { schema_version: 2, source: "codex_app_server", method, params },
      } });
    }
    const starting = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task waiting for a receipt", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `${ownerId}/services/${randomUUID()}/home/workspace`,
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const intent = await prisma.conversationTurnStartIntent.create({ data: {
      projectionTurnId: randomUUID(), ownerId, conversationId: starting.id, runtimeGeneration: starting.runtimeGeneration,
      capabilityGeneration, inputText: "Preserve this input", capabilitiesJson: [], attachmentsJson: [],
      submitMode: "normal", runnerStatus: "prepared", idempotencyKey: "mac-revoked-before-projection",
    } });
    const queuedIds = Array.from({ length: 5 }, () => randomUUID());
    await prisma.pendingRequest.createMany({ data: queuedIds.map((id, index) => ({
      id, conversationId: starting.id, submittedBy: ownerId, queueNo: index + 1,
      inputText: `Queued request ${index + 1}`, status: "waiting_previous_turn",
    })) });
    const discardedThread = randomUUID();
    const discarded = await prisma.conversation.create({ data: {
      ownerId, title: "Mac task deleted after settlement", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId, codexThreadId: discardedThread,
    } });
    const discardedTurn = await prisma.conversationTurn.create({ data: {
      conversationId: discarded.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: discardedThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const cloudThread = randomUUID();
    const cloud = await prisma.conversation.create({ data: {
      ownerId, title: "Unrelated cloud task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), codexThreadId: cloudThread,
    } });
    const cloudTurn = await prisma.conversationTurn.create({ data: {
      conversationId: cloud.id, submittedBy: ownerId, sequenceNo: 1, status: "running",
      codexThreadId: cloudThread, codexTurnId: randomUUID(), startedAt: new Date(), submitMode: "normal",
      capabilityGeneration, capabilitiesJson: [],
    } });
    const legacy = await prisma.conversation.create({ data: {
      ownerId, title: "Legacy terminal Mac task", titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
      runtimeGeneration: randomUUID(), executionTarget: "local", desktopDeviceId: deviceId,
    } });
    const legacyTurn = await prisma.conversationTurn.create({ data: {
      conversationId: legacy.id, submittedBy: ownerId, sequenceNo: 1, status: "completed",
      codexThreadId: randomUUID(), codexTurnId: randomUUID(), startedAt: new Date(),
      completedAt: new Date(), submitMode: "normal", capabilityGeneration, capabilitiesJson: [],
    } });
    // The start intent has no reservation: PostgreSQL must still discover it.
    for (const [id, turn] of [[running.id, runningTurn.id], [discarded.id, discardedTurn.id], [conversationId, turnId], [cloud.id, cloudTurn.id], [legacy.id, legacyTurn.id]] as const) {
      assert.equal((await redis.acquireTurnSlot(id, turn, ownerId, 10)).acquired, true);
    }
    // Drop every queued wake-up and fail the Redis notification after the DB commit.
    await queue.drain(true);
    const revoke = coordinator.revoke;
    coordinator.revoke = async () => { throw new Error("fixture notification unavailable"); };
    try {
      const [revocation] = await Promise.all([
        app.inject({ method: "DELETE", url: `/api/v1/desktop/devices/${deviceId}` }),
        conversations.patch(ownerId, local.conversationId, { archiveStatus: "archived" }),
      ]);
      assert.equal(revocation.statusCode, 500);
    } finally {
      coordinator.revoke = revoke;
    }
    assert((await prisma.desktopDevice.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt);
    assert.equal((await prisma.localComputerSession.findUniqueOrThrow({ where: { id: local.sessionId } })).status, "ended");
    assert((await prisma.computerPermissionGrant.findUniqueOrThrow({ where: { id: local.grantId } })).revokedAt);
    await conversations.delete(ownerId, legacy.id, {});
    assert.equal(await redis.hasTurnSlot(legacy.id, legacyTurn.id, ownerId), true);
    // A new scheduler can finish without any in-memory state, retry, or current socket.
    const restartedRecovery = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    const releaseTurnSlot = redis.releaseTurnSlot;
    redis.releaseTurnSlot = async (id, turn, options) => {
      if (turn === discardedTurn.id) throw new Error("fixture Redis release unavailable after commit");
      await releaseTurnSlot.call(redis, id, turn, options);
    };
    try {
      await restartedRecovery.process({ data: { type: "maintenance" } });
    } finally {
      redis.releaseTurnSlot = releaseTurnSlot;
    }
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: discardedTurn.id } })).status, "failed");
    assert.equal(await redis.hasTurnSlot(discarded.id, discardedTurn.id, ownerId), true);
    await conversations.delete(ownerId, discarded.id, {});
    await queue.drain(true);
    const afterDeletion = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    await afterDeletion.process({ data: { type: "maintenance" } });
    await restartedRecovery.process({ data: { type: "maintenance" } });
    assert.equal(await redis.hasTurnSlot(legacy.id, legacyTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(discarded.id, discardedTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(running.id, runningTurn.id, ownerId), false);
    assert.equal(await redis.hasTurnSlot(starting.id, intent.projectionTurnId, ownerId), false);
    assert.equal(await redis.hasTurnSlot(conversationId, turnId, ownerId), false);
    assert.equal(await redis.hasTurnSlot(cloud.id, cloudTurn.id, ownerId), true);
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: cloudTurn.id } })).status, "running");
    const failed = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: runningTurn.id } });
    assert.equal(failed.status, "failed");
    assert.equal(failed.errorCode, "DESKTOP_DEVICE_REVOKED");
    assert.equal((await prisma.conversationMessage.findUniqueOrThrow({ where: { id: partial.id } })).contentText, partial.contentText);
    const reloaded = await conversations.get(ownerId, running.id);
    assert.deepEqual(reloaded.messages.map(message => message.content_text), [partial.contentText, "Streamed before revocation"]);
    assert.equal(await prisma.conversationTurnStartIntent.findUnique({ where: { projectionTurnId: intent.projectionTurnId } }), null);
    const draft = await prisma.pendingRequest.findUniqueOrThrow({ where: { id: intent.projectionTurnId } });
    assert.equal(draft.status, "blocked_preflight");
    assert.equal(draft.inputText, intent.inputText);
    assert.equal((await conversations.get(ownerId, starting.id)).pending_requests.find(row => row.id === draft.id)?.block_code, "desktop_device_revoked");
    const draftEvents = (await events.historyPage(ownerId, starting.id, { afterSequence: 0n, limit: 50 })).items;
    assert.deepEqual(draftEvents.map(event => event.event_type), [
      "conversation.pending_request.updated", "conversation.error", "conversation.error",
    ]);
    assert.deepEqual(conversationStartFailurePayloadSchema.parse(draftEvents[1]?.payload), {
      schema_version: 1, error_code: "RUNNER_UNAVAILABLE", message_key: "errors.runnerUnavailable", retryable: true,
      start_failure: { turn_id: intent.projectionTurnId, idempotency_key: intent.idempotencyKey },
    });
    const reordered = [draft.id, ...[...queuedIds].reverse()];
    assert.deepEqual((await conversations.reorderPending(ownerId, starting.id, reordered, {})).items.map(item => item.id), reordered);
    assert.equal((await conversations.restorePendingToInput(ownerId, starting.id, draft.id, {})).input_text, intent.inputText);
    const revokedEvents = (await events.historyPage(ownerId, running.id, { afterSequence: 0n, limit: 50 })).items;
    assert.deepEqual(revokedEvents.slice(4).map(event => event.event_type), [
      "conversation.message.completed", "conversation.status.changed", "conversation.error",
    ]);
    assert.equal((await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } })).status, "completed");
  } finally {
    for (const socket of sockets) socket.terminate();
    await app.close().finally(() => queue.close()).finally(() => fixture.close());
  }
}

type EventCallback = Extract<DesktopExecutionCallback, { operation: "events" }>;
type EventDelivery = EventCallback["body"]["events"][number];

function send(socket: WebSocket, frame: unknown): void {
  socket.send(JSON.stringify(frame));
}

function readFrame(socket: WebSocket): Promise<unknown> {
  return once(socket, "message", { signal: AbortSignal.timeout(5_000) })
    .then(([data]) => JSON.parse(String(data)));
}

function readCommand(socket: WebSocket): Promise<DesktopExecutionCommand> {
  return readFrame(socket).then(frame => desktopExecutionCommandSchema.parse(frame));
}

function exchange(socket: WebSocket, frame: unknown): Promise<unknown> {
  const response = readFrame(socket);
  send(socket, frame);
  return response;
}

async function sendEvents(socket: WebSocket, frame: EventCallback) {
  const ack = desktopExecutionAckSchema.parse(await exchange(socket, frame));
  assert.equal(ack.id, frame.id);
  assert(ack.operation === "events");
  return ack;
}

function assertAccepted(ack: Awaited<ReturnType<typeof sendEvents>>, ids: string[]): void {
  assert(ack.ok, `Desktop event batch rejected: ${ack.ok ? "" : ack.error_code}`);
  assert.deepEqual(ack.data.accepted_delivery_ids, ids);
}
