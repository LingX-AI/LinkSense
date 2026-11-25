import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { conversationStartFailurePayloadSchema, desktopModelProxyUrl, RUNNER_TURN_INTERRUPT_REQUESTED, runtimeEnvironmentPath } from "@linksense/shared";
import Fastify from "fastify";
import { z } from "zod";

import { DesktopCommandUncertainError, type DesktopDeviceTransport } from "../../src/adapters/desktop-device-transport.js";
import type { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import { desktopRunLeaseKey } from "../../src/modules/desktop-credentials/run-leases.js";
import type { RedisDesktopDeviceCoordinator } from "../../src/modules/desktop-devices/coordinator.js";
import type { ModelProviderSettingsService } from "../../src/modules/system/model-provider-settings.js";
import type { ConversationEventService } from "../../src/modules/events/service.js";

const source = "fixture-model-a";
const target = "fixture-model-b";
const initialQuestion = "Remember the synthetic orchard.";
const initialAnswer = "The orchard has a synthetic pear tree.";
const compacted = "The retained context is the synthetic pear tree.";
const switchQuestion = "Continue the synthetic task with the second model.";
const switchAnswer = "The second model retained the synthetic pear tree.";

export async function verifyPackagedDesktopModelSwitch(input: {
  runtimeRoot: string;
  scratch: string;
  address: string;
  server: Server;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  coordinator: RedisDesktopDeviceCoordinator;
  execution: DesktopDeviceTransport;
  conversations: ConversationService;
  events: ConversationEventService;
  modelProviderSettings: ModelProviderSettingsService;
  ownerId: string;
  deviceId: string;
  token: string;
  serverSecrets: readonly string[];
}): Promise<void> {
  assert(process.platform === "darwin" && process.arch === "arm64" && isAbsolute(input.runtimeRoot));
  const { prisma, redis, conversations, events, coordinator, execution, ownerId, deviceId } = input;
  await mkdir(input.scratch, { mode: 0o700 });
  const scratch = await realpath(input.scratch);
  const binary = join(scratch, "bridge-test");
  const dataRoot = join(scratch, "native-runtime");
  await promisify(execFile)("go", ["test", "-c", "-tags", "desktop_runtime_package", "-o", binary, "."], {
    cwd: new URL("../../../desktop/", import.meta.url), timeout: 60_000, env: { ...process.env, GOPROXY: "off" },
  });
  const provider = Fastify();
  const sourceKey = randomUUID(), targetKey = randomUUID();
  const secrets = [...input.serverSecrets, sourceKey, targetKey];
  const requests: { model: string; context: string[]; answer?: string }[] = [
    { model: source, context: [initialQuestion], answer: initialAnswer },
    { model: source, context: [initialAnswer], answer: compacted },
    { model: target, context: [compacted, switchQuestion], answer: switchAnswer },
  ];
  const modelCalls: string[] = [];
  let heldResponse: ServerResponse | undefined;
  let aborted = false;
  let invalidProviderRequest = false;
  provider.setErrorHandler((_error, _request, reply) => {
    invalidProviderRequest = true;
    void reply.code(400).send({ error: { code: "invalid_fixture_request" } });
  });
  for (const [model, key] of [[source, sourceKey], [target, targetKey]] as const) {
    provider.post(`/${model}/v1/responses`, async (request, reply) => {
      assert(request.headers.authorization === `Bearer ${key}`, "incorrect provider key or channel");
      const body = z.object({ model: z.literal(model), input: z.unknown(), stream: z.literal(true) }).parse(request.body);
      const context = JSON.stringify(body.input);
      assert(!secrets.some(secret => context.includes(secret)), "server credential appeared in inference input");
      const step = requests[modelCalls.length];
      assert(step?.model === model && step.context.every(text => context.includes(text)),
        "unexpected model call or missing native context");
      modelCalls.push(model);
      if (step.answer === undefined) {
        reply.hijack();
        reply.raw.writeHead(200, { "content-type": "text/event-stream" });
        reply.raw.flushHeaders();
        heldResponse = reply.raw;
        reply.raw.once("close", () => { aborted = true; });
        return;
      }
      const item = { type: "message", id: `msg_${randomUUID()}`, role: "assistant", status: "completed", phase: "final_answer",
        content: [{ type: "output_text", text: step.answer, annotations: [] }] };
      const id = `resp_${randomUUID()}`;
      return reply.type("text/event-stream").send([
        { type: "response.created", response: { id, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: { id, status: "completed", output: [item],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
      ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""));
    });
  }
  let bridge: ReturnType<typeof launch> | undefined;
  let leaked = false;
  const launch = () => {
    const child = spawn(binary, ["-test.run=^TestPackagedDesktopGateway$", "-test.timeout=100s"], {
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LINKSENSE_DESKTOP_RUNTIME_DIST: input.runtimeRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exit = once(child, "close").then(([code]) => code);
    // Scan bounded output without logging the simulated credentials.
    for (const stream of [child.stdout, child.stderr]) {
      let tail = "";
      stream.on("data", (bytes: Buffer) => {
        const chunk = tail + bytes.toString();
        leaked ||= secrets.some(secret => chunk.includes(secret));
        tail = chunk.slice(-Math.max(...secrets.map(secret => secret.length)));
      });
    }
    child.stdin.write(`${JSON.stringify({
      origin: input.address, dataRoot, credential: { token: input.token, ownerId, deviceId, name: "Mac switch fixture" },
    })}\n`);
    return { child, exit };
  };
  const stop = async () => {
    if (!bridge) return;
    const { child, exit } = bridge;
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 8_000);
    try { assert.equal(await exit, 0, "the packaged Mac bridge did not stop cleanly"); }
    finally { clearTimeout(timer); bridge = undefined; }
  };
  const waitFor = async <T>(what: string, condition: () => Promise<T | false | null>): Promise<T> => {
    const deadline = Date.now() + 25_000;
    do {
      assert(!invalidProviderRequest, "the synthetic provider rejected a request");
      assert(bridge?.child.exitCode === null && bridge.child.signalCode === null, "the packaged Mac bridge exited");
      const result = await condition();
      if (result !== null && result !== false) return result;
      await delay(40);
    } while (Date.now() < deadline);
    throw new Error(`Mac switch fixture timed out waiting for ${what}`);
  };
  const connect = (previous: string | undefined) => waitFor("the Mac capability handshake", async () => {
    const binding = await coordinator.executionConnection(deviceId);
    return binding && binding.connectionId !== previous && await coordinator.supportsModelSwitch(binding) ? binding : false;
  });
  const reconnect = async (previous: string) => {
    await stop();
    bridge = launch();
    return connect(previous);
  };
  const proxyPurposes: string[] = [];
  let switchTurn: string | undefined;
  let lostSettlement = false, sawTerminal = false;
  let startCount = 0, recoveredByInspect = false;
  const observeProxy = (request: IncomingMessage) => {
    if (!switchTurn) return;
    for (const purpose of ["transition_source", "primary"] as const) {
      if (`${desktopModelProxyUrl(input.address, switchTurn, purpose)}/responses` === `${input.address}${request.url}`) {
        const auth = request.headers.authorization;
        if (!auth?.startsWith("Bearer lsdm_") || secrets.some(secret => auth.includes(secret))) invalidProviderRequest = true;
        proxyPurposes.push(purpose);
      }
    }
  };
  const originalSend = execution.send;
  const originalCallback = execution.receiveCallback;
  try {
    const origin = await provider.listen({ host: "127.0.0.1", port: 0 });
    const settings = await input.modelProviderSettings.getAdminSettings();
    await input.modelProviderSettings.update(ownerId, {
      expected_revision: settings.revision, default_model: source, title_model: null, memory_extraction_model: null,
      providers: [[source, sourceKey], [target, targetKey]].map(([model, key]) => ({
        id: model!, base_url: `${origin}/${model}/v1`, protocol_mode: "native_responses" as const, api_key: key!,
        models: [{
          kind: "chat" as const, id: model!, display_name: model!, enabled: true, context_window: 32768,
          supported_reasoning_efforts: ["low" as const], default_reasoning_effort: "low" as const, supports_image_input: true,
          input_price_per_million: "10", cached_input_price_per_million: "2", output_price_per_million: "20",
        }],
      })),
    }, {});
    const task = async (title: string) => {
      const id = randomUUID();
      await prisma.conversation.create({ data: {
        id, ownerId, title, titleSource: "manual", archiveStatus: "active",
        executionTarget: "local", desktopDeviceId: deviceId, runtimeGeneration: randomUUID(),
        workspaceRelPath: `${runtimeEnvironmentPath(ownerId, id)}/home/workspace`,
      } });
      return id;
    };
    const id = await task("Packaged Mac model switch");
    const previous = await coordinator.executionConnection(deviceId);
    bridge = launch();
    const { connectionId: oldConnection } = await connect(previous?.connectionId);
    const submission = (inputText: string, modelId: string, idempotencyKey = modelId) => ({
      inputText, idempotencyKey, submitMode: "normal" as const, priorityCapabilityIds: [],
      modelPreference: { modelId, reasoningEffort: "low" as const },
    });
    const waitForTerminal = (conversationId: string, turnId: string, status: "completed" | "interrupted" = "completed") =>
      waitFor(`a ${status} turn and released slot`, async () => {
        const turn = await prisma.conversationTurn.findUnique({ where: { id: turnId } });
        return turn?.status === status && !await redis.hasTurnSlot(conversationId, turnId, ownerId) ? turn : false;
      });
    const first = await conversations.acceptTurn(ownerId, id, submission(initialQuestion, source), {});
    const before = await waitForTerminal(id, first.turn_id);
    assert(before.codexThreadId && before.codexTurnId);
    const firstAttempt = await prisma.conversationTurnAttempt.findFirstOrThrow({ where: { turnId: before.id } });
    const firstUsage = await prisma.tokenUsageRecord.findMany({ where: { turnId: before.id } });
    assert.equal(firstUsage.length, 1);

    execution.send = async (binding, command, ...options) => {
      if (command.conversation_id === id && command.operation === "turn.start") {
        switchTurn = command.turn_id;
        startCount++;
        assert.equal(command.body.native_thread_id, before.codexThreadId);
        assert.equal(command.body.credentials.transition_source?.model, source);
        assert.equal(command.body.credentials.primary.model, target);
        assert(!secrets.some(secret => JSON.stringify(command).includes(secret)), "server credential on the device wire");
      }
      if (switchTurn && command.turn_id === switchTurn && command.operation === "turn.inspect" &&
          binding.connectionId === oldConnection) throw new DesktopCommandUncertainError();
      const result = await originalSend.call(execution, binding, command, ...options);
      if (command.turn_id === switchTurn && result.ok && result.operation === "turn.inspect" && result.result?.status === "succeeded") {
        assert.equal(result.result.result.forkedFromId, before.codexThreadId);
        recoveredByInspect = true;
      }
      return result;
    };
    execution.receiveCallback = async (connectionId, frame) => {
      if (connectionId === oldConnection && switchTurn && frame.turn_id === switchTurn) {
        if (frame.operation === "start.settled") {
          lostSettlement = true;
          return;
        }
        if (frame.operation === "events" && frame.body.events.some(({ event }) =>
          "method" in event && event.method === "turn/completed" && event.params.turn.status === "completed")) sawTerminal = true;
      }
      await originalCallback.call(execution, connectionId, frame);
    };
    input.server.on("request", observeProxy);
    const followup = await conversations.acceptTurn(ownerId, id, submission(switchQuestion, target), {});
    assert.equal(switchTurn, followup.turn_id);
    const turnId = followup.turn_id;
    await waitFor("an unacknowledged native start and terminal event", async () => lostSettlement && sawTerminal);
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id } })).codexThreadId, before.codexThreadId);
    assert.equal((await prisma.conversationTurnStartIntent.findUniqueOrThrow({ where: { projectionTurnId: turnId } })).runnerStatus, "prepared");
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: id } }), 1);

    const journal = join(dataRoot, runtimeEnvironmentPath(ownerId, id), "control", "workspaces", id, "start-operations", `${turnId}.json`);
    const journalBefore = await readFile(journal, "utf8");
    await stop();
    // Advance only this lease's Redis TTL, not the clock used by Codex or the API.
    const leaseKey = desktopRunLeaseKey(turnId);
    assert.equal(await redis.client.pexpire(leaseKey, 0), 1);
    bridge = launch();
    const reconnected = await connect(oldConnection);
    assert.equal(await conversations.recoverStartIntent(turnId, {
      resubmitNonTerminal: false, desktopConnectionId: reconnected.connectionId,
    }), "projected");
    assert(recoveredByInspect, "recovery did not inspect the native fork receipt");
    const running = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    assert.deepEqual(await events.reconcileAfterProcessExit({
      conversationId: id, projectionTurnId: turnId, capabilityGeneration: running.capabilityGeneration,
    }, { desktopConnectionId: reconnected.connectionId }), { outcome: "succeeded" });
    const after = await waitForTerminal(id, turnId);
    assert(after.codexThreadId && after.codexThreadId !== before.codexThreadId && after.codexTurnId !== before.codexTurnId);
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id } })).codexThreadId, after.codexThreadId);
    const historical = await prisma.conversationTurn.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(historical.codexThreadId, after.codexThreadId);
    assert.equal(historical.codexTurnId, before.codexTurnId);
    assert.equal(historical.model, source);
    assert.equal(after.model, target);
    assert.deepEqual(await prisma.conversationTurnAttempt.findUnique({ where: { id: firstAttempt.id } }), firstAttempt);
    assert.equal(await prisma.conversationTurnAttempt.count({ where: { turnId } }), 1);
    const messages = await prisma.conversationMessage.findMany({ where: { conversationId: id }, orderBy: { sequenceNo: "asc" } });
    assert.deepEqual(messages.map(message => message.contentText), [initialQuestion, initialAnswer, switchQuestion, switchAnswer]);
    assert.deepEqual(await prisma.tokenUsageRecord.findMany({ where: { turnId: before.id } }), firstUsage);
    const usage = await prisma.tokenUsageRecord.findMany({ where: { turnId: after.id }, orderBy: { model: "asc" } });
    assert.deepEqual(usage.map(row => [row.model, row.totalTokens, row.totalCostPicoUsd]),
      [[source, 5n, 70_000_000n], [target, 5n, 70_000_000n]]);
    assert.equal(await conversations.recoverStartIntent(turnId, { desktopConnectionId: reconnected.connectionId }), "missing");
    assert.equal(await redis.client.get(leaseKey), null, "read-only recovery must not renew execution authority");
    assert.equal(await readFile(journal, "utf8"), journalBefore, "read-only recovery must preserve the successful native journal");
    assert.equal(startCount, 1, "the native start was re-dispatched");
    assert.deepEqual(modelCalls, [source, source, target]);
    assert.deepEqual(proxyPurposes, ["transition_source", "primary"]);
    assert(!leaked && !invalidProviderRequest, "the packaged switch crossed its credential boundary");
    console.log("Packaged Mac model switch passed: one scoped compaction, one foreground call, journal-only recovery after reconnect, preserved history and provider usage.");

    const stopTask = await task("Packaged Mac stop after model switch");
    const again = "Continue after stopping the second model.";
    requests.push(
      { model: source, context: [initialQuestion], answer: initialAnswer },
      { model: source, context: [initialAnswer], answer: compacted },
      { model: target, context: [compacted, switchQuestion] },
      { model: target, context: [compacted, again], answer: switchAnswer },
    );
    const stopTrialStarts: { thread: string | null; model: string; source: string | undefined }[] = [];
    execution.receiveCallback = originalCallback;
    execution.send = async (binding, command, ...options) => {
      if (command.conversation_id === stopTask && command.operation === "turn.start") {
        stopTrialStarts.push({ thread: command.body.native_thread_id, model: command.body.credentials.primary.model,
          source: command.body.credentials.transition_source?.model });
        if (secrets.some(secret => JSON.stringify(command).includes(secret))) leaked = true;
      }
      return originalSend.call(execution, binding, command, ...options);
    };
    const seed = await conversations.acceptTurn(ownerId, stopTask, submission(initialQuestion, source), {});
    const seedTurn = await waitForTerminal(stopTask, seed.turn_id);
    const switching = await conversations.acceptTurn(ownerId, stopTask, submission(switchQuestion, target), {});
    const projected = await waitFor("projected model B and its held foreground request", async () => {
      const turn = await prisma.conversationTurn.findUnique({ where: { id: switching.turn_id } });
      return heldResponse && turn?.status === "running" ? turn : false;
    });
    assert.equal(projected.model, target);
    assert.notEqual(projected.codexThreadId, seedTurn.codexThreadId);
    assert.equal((await conversations.interrupt(ownerId, stopTask, switching.turn_id, {})).code, RUNNER_TURN_INTERRUPT_REQUESTED);
    const stopped = await waitForTerminal(stopTask, switching.turn_id, "interrupted");
    await waitFor("cancellation of the held provider request", async () => aborted);
    assert.equal(stopped.codexTurnId, projected.codexTurnId);
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: stopTask } })).codexThreadId, projected.codexThreadId);
    // PostgreSQL releases the slot before the Mac finishes retiring the old worker.
    const afterStop = await reconnect(reconnected.connectionId);
    const resumed = await conversations.acceptTurn(ownerId, stopTask, submission(again, target, "same-model-after-stop"), {});
    assert.deepEqual(stopTrialStarts, [
      { thread: null, model: source, source: undefined },
      { thread: seedTurn.codexThreadId, model: target, source },
      { thread: projected.codexThreadId, model: target, source: undefined },
    ], "continuing on model B must not compact model A or fork model B again");
    const continued = await waitForTerminal(stopTask, resumed.turn_id);
    assert.equal(continued.codexThreadId, projected.codexThreadId);
    assert.notEqual(continued.codexTurnId, projected.codexTurnId);
    assert.equal(await prisma.conversationTurnAttempt.count({ where: { turnId: switching.turn_id } }), 1);
    assert.equal(await prisma.conversationTurnStartIntent.count({ where: { conversationId: stopTask } }), 0);
    assert.deepEqual(modelCalls.slice(3), [source, source, target, target]);
    assert(!leaked && !invalidProviderRequest);
    console.log("Packaged Mac model switch Stop passed: the interrupted model B turn projected once and model B continued on the same native thread.");

    const switchBack = "Continue with the original model.";
    await reconnect(afterStop.connectionId);
    heldResponse = undefined;
    aborted = false;
    requests.push({ model: target, context: [switchAnswer] });
    const canceled = await conversations.acceptTurn(ownerId, stopTask, submission(switchBack, source, "stop-compaction"), {});
    await waitFor("the held source model B compaction", async () => heldResponse !== undefined);
    assert.equal(await prisma.conversationTurn.count({ where: { id: canceled.turn_id } }), 0);
    assert.equal((await prisma.conversationTurnStartIntent.findUniqueOrThrow({
      where: { projectionTurnId: canceled.turn_id },
    })).desktopTransitionSourceThreadId, continued.codexThreadId);
    assert.equal((await conversations.interrupt(ownerId, stopTask, canceled.turn_id, {})).code, RUNNER_TURN_INTERRUPT_REQUESTED);
    await waitFor("canceled source compaction and released start reservation", async () =>
      aborted &&
      !await redis.hasTurnSlot(stopTask, canceled.turn_id, ownerId) &&
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: canceled.turn_id } }),
    );
    const canceledHistory = await events.historyPage(ownerId, stopTask, { afterSequence: 0n, limit: 50 });
    assert.equal(canceledHistory.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const failure = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return failure.success && failure.data.error_code === "TURN_START_CLOSED" &&
        failure.data.start_failure.turn_id === canceled.turn_id;
    }).length, 1);
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: stopTask } }), 3);
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: stopTask } })).codexThreadId, continued.codexThreadId);
    assert.deepEqual(stopTrialStarts.slice(3), [{ thread: continued.codexThreadId, model: source, source: target }]);
    assert.deepEqual(modelCalls.slice(7), [target], "Stop during source compaction must prevent target inference");
    assert(!leaked && !invalidProviderRequest);
    console.log("Packaged Mac source compaction Stop passed: B-to-A used the scoped B grant and Stop released the start without A inference, a target turn, or replay.");
  } finally {
    input.server.off("request", observeProxy);
    execution.send = originalSend;
    execution.receiveCallback = originalCallback;
    await stop().finally(() => {
      heldResponse?.destroy();
      return provider.close();
    });
  }
}
