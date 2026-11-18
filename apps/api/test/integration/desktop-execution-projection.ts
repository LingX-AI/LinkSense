import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import {
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  desktopExecutionAckSchema,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopProtocolVersion,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
} from "@linksense/shared";
import { Queue } from "bullmq";
import Fastify from "fastify";
import { WebSocket } from "ws";

import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { RunnerClient } from "../../src/adapters/runner.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { ConversationService } from "../../src/modules/conversations/service.js";
import { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import { registerDesktopExecution } from "../../src/modules/desktop-devices/execution.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";
import { registerDesktopDeviceRoutes } from "../../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../../src/modules/desktop-devices/service.js";
import { TaskRecoveryScheduler, type TaskRecoveryQueueControl } from "../../src/modules/events/recovery-scheduler.js";
import { ConversationEventService } from "../../src/modules/events/service.js";
import { PrivacyMaskingSettingsService } from "../../src/modules/privacy-masking/service.js";
import { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import { CreditLimitService } from "../../src/modules/usage/credit-limit.js";
import { createRedisFixture } from "../fixtures/redis.js";
import { testConfig } from "../test-config.js";
import { verifyPackagedDesktopGateway } from "./desktop-package-roundtrip.js";

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
    const conversations = new ConversationService(
      prisma, redis, runner, new AuditService(prisma),
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
    const recovery = new TaskRecoveryScheduler(config, prisma, redis, events, conversations, queue);
    events.configureRecoveryScheduler(recovery);
    const execution = await registerDesktopExecution(app, {
      config, prisma, redis, runner, conversations, events,
      modelProviderSettings, creditLimits, privacyMaskingSettings,
    }, coordinator);
    assert(execution, "Mac execution must be enabled in this fixture");
    let rejectNextRecovery = false;
    app.decorate("authenticate", outsideFixture);
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
    const connect = async (expectRecovery = true) => {
      const url = new URL("/api/v1/desktop/devices/socket", address);
      url.protocol = "ws:";
      const socket = new WebSocket(url, {
        headers: { [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion) },
      });
      sockets.push(socket);
      await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
      const closed = once(socket, "close");
      const ready = desktopExecutionDeviceReadySchema.parse(await exchange(socket, {
        type: "hello", token, protocol_version: desktopProtocolVersion,
      }));
      assert.equal(ready.device_id, deviceId);
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
    const initial = await connect();
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
    assert.equal(await redis.client.pexpire(leaseKey, 1), 1);
    const expiryDeadline = Date.now() + 1_000;
    while (await redis.client.exists(leaseKey)) {
      assert(Date.now() < expiryDeadline, "fixture lease did not expire");
      await delay(10);
    }
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
        serverSecrets: [config.credentialMasterKey, config.runnerSharedSecret],
      });
    }
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
