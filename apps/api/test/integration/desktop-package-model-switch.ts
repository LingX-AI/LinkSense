import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import {
  conversationStartFailurePayloadSchema, desktopAttachmentDownloadPath, desktopModelProxyUrl,
  RUNNER_TURN_INTERRUPT_REQUESTED, runtimeEnvironmentPath, type DesktopExecutionResult,
} from "@linksense/shared";
import Fastify from "fastify";
import { z } from "zod";

import { DesktopCommandUncertainError, type DesktopDeviceTransport } from "../../src/adapters/desktop-device-transport.js";
import type { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import { desktopStartStopEventId } from "../../src/modules/conversations/recovered-local-quote-draft.js";
import type { FileService } from "../../src/modules/files/service.js";
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
const returnQuestion = "Continue after the stopped return to the original model.";
const returnAnswer = "The original model continued after the stopped return.";

export async function verifyPackagedDesktopModelSwitch(input: {
  runtimeRoot: string;
  scratch: string;
  workspaceRoot: string;
  address: string;
  server: Server;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  coordinator: RedisDesktopDeviceCoordinator;
  execution: DesktopDeviceTransport;
  conversations: ConversationService;
  files: FileService;
  events: ConversationEventService;
  modelProviderSettings: ModelProviderSettingsService;
  ownerId: string;
  deviceId: string;
  token: string;
  serverSecrets: readonly string[];
}): Promise<void> {
  assert(process.platform === "darwin" && process.arch === "arm64" && isAbsolute(input.runtimeRoot));
  const { prisma, redis, conversations, files, events, coordinator, execution, ownerId, deviceId, workspaceRoot } = input;
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
  const providerInputs: string[] = [];
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
      providerInputs.push(context);
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
  let attachmentDownloads = 0;
  let captureAttachmentStarts = false;
  const attachmentStartResults: { turnId: string; result: DesktopExecutionResult }[] = [];
  const directReceiptEvidence = new Map<string, { intent: boolean; slot: boolean; lease: string | null }>();
  const droppedReceiptRecovery: { operation: "turn.inspect" | "turn.seal"; result: DesktopExecutionResult }[] = [];
  let dropSealedDirectReceipt = false;
  let droppedReceiptTurn: string | undefined;
  let lostSettlement = false, sawTerminal = false;
  let startCount = 0, recoveredByInspect = false;
  const observeProxy = (request: IncomingMessage) => {
    if (captureAttachmentStarts && request.url?.startsWith(`${desktopAttachmentDownloadPath}/`)) {
      attachmentDownloads++;
    }
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
    const taskWorkspace = (conversationId: string) =>
      `${runtimeEnvironmentPath(ownerId, conversationId)}/home/workspace`;
    const task = async (title: string) => {
      const id = randomUUID();
      await prisma.conversation.create({ data: {
        id, ownerId, title, titleSource: "manual", archiveStatus: "active",
        executionTarget: "local", desktopDeviceId: deviceId, runtimeGeneration: randomUUID(),
        workspaceRelPath: taskWorkspace(id),
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
    const stopTrialStarts: { turnId: string; thread: string | null; model: string; source: string | undefined }[] = [];
    execution.receiveCallback = originalCallback;
    execution.send = async (binding, command, ...options) => {
      if (command.conversation_id === stopTask && command.operation === "turn.start") {
        stopTrialStarts.push({ turnId: command.turn_id, thread: command.body.native_thread_id, model: command.body.credentials.primary.model,
          source: command.body.credentials.transition_source?.model });
        if (secrets.some(secret => JSON.stringify(command).includes(secret))) leaked = true;
      }
      const capture = captureAttachmentStarts && command.conversation_id === stopTask && command.operation === "turn.start";
      const result = await originalSend.call(execution, binding, command, ...options);
      if (capture) {
        attachmentStartResults.push({ turnId: command.turn_id, result });
        if (result.ok && result.operation === "turn.start" && result.result.status === "failed" &&
            result.result.errorCode === "RUNNER_TURN_START_SEALED") {
          // Observe the durable reservation through the transport seam, before
          // the API can consume this receipt and release anything.
          if (!directReceiptEvidence.has(command.turn_id)) {
            directReceiptEvidence.set(command.turn_id, {
              intent: await prisma.conversationTurnStartIntent.count({
                where: { projectionTurnId: command.turn_id },
              }) === 1,
              slot: await redis.hasTurnSlot(stopTask, command.turn_id, ownerId),
              lease: await redis.client.get(desktopRunLeaseKey(command.turn_id)),
            });
          }
          if (dropSealedDirectReceipt) {
            dropSealedDirectReceipt = false;
            // The server never ingests this verified receipt, as if it expired
            // before delivery. This is not a clock or transport outage test.
            throw new DesktopCommandUncertainError();
          }
        }
      }
      if (droppedReceiptTurn && command.turn_id === droppedReceiptTurn &&
          (command.operation === "turn.inspect" || command.operation === "turn.seal")) {
        droppedReceiptRecovery.push({ operation: command.operation, result });
      }
      return result;
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
      { turnId: seed.turn_id, thread: null, model: source, source: undefined },
      { turnId: switching.turn_id, thread: seedTurn.codexThreadId, model: target, source },
      { turnId: resumed.turn_id, thread: projected.codexThreadId, model: target, source: undefined },
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
    assert.deepEqual(stopTrialStarts.slice(3), [{ turnId: canceled.turn_id, thread: continued.codexThreadId, model: source, source: target }]);
    assert.deepEqual(modelCalls.slice(7), [target], "Stop during source compaction must prevent target inference");
    assert(!leaked && !invalidProviderRequest);
    console.log("Packaged Mac source compaction Stop passed: B-to-A used the scoped B grant and Stop released the start without A inference, a target turn, or replay.");

    // The released start must accept one fresh transition, not resume the stopped one.
    requests.push(
      { model: target, context: [switchAnswer], answer: compacted },
      { model: source, context: [compacted, returnQuestion], answer: returnAnswer },
    );
    const returnedStart = await conversations.acceptTurn(ownerId, stopTask,
      submission(returnQuestion, source, "return-after-stop"), {});
    const returned = await waitForTerminal(stopTask, returnedStart.turn_id);
    assert(returned.codexThreadId && returned.codexThreadId !== continued.codexThreadId);
    assert.notEqual(returned.codexTurnId, continued.codexTurnId);
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: stopTask } })).codexThreadId,
      returned.codexThreadId);
    assert.equal(await prisma.conversationTurn.count({ where: { id: canceled.turn_id } }), 0,
      "the stopped submission was projected instead of remaining closed");
    assert.equal(await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: canceled.turn_id } }), 0);
    assert.equal(await prisma.conversationTurnStartIntent.count({ where: { conversationId: stopTask } }), 0);
    assert.equal(await redis.hasTurnSlot(stopTask, returned.id, ownerId), false, "the return turn kept its slot");
    assert.deepEqual(stopTrialStarts.slice(4), [
      { turnId: returned.id, thread: continued.codexThreadId, model: source, source: target },
    ], "the new submission did not fork the current B thread with one fresh start");
    assert.equal(stopTrialStarts.filter(start => start.turnId === canceled.turn_id).length, 1,
      "the stopped submission was re-dispatched");
    const returnedAttempts = await prisma.conversationTurnAttempt.findMany({ where: { turnId: returned.id } });
    assert.deepEqual(returnedAttempts.map(attempt => [attempt.attemptNo, attempt.kind, attempt.status]),
      [[1, "primary", "completed"]], "the new submission does not have exactly one terminal attempt");
    assert.equal(await prisma.conversationTurn.count({ where: { conversationId: stopTask } }), 4);
    const earlierTurns = await Promise.all([seedTurn.id, switching.turn_id, resumed.turn_id].map(id =>
      prisma.conversationTurn.findUniqueOrThrow({
        where: { id },
        select: { id: true, status: true, model: true, codexTurnId: true, codexThreadId: true },
      })));
    assert.deepEqual(earlierTurns, [
      { id: seedTurn.id, status: "completed", model: source, codexTurnId: seedTurn.codexTurnId, codexThreadId: returned.codexThreadId },
      { id: switching.turn_id, status: "interrupted", model: target, codexTurnId: stopped.codexTurnId, codexThreadId: returned.codexThreadId },
      { id: resumed.turn_id, status: "completed", model: target, codexTurnId: continued.codexTurnId, codexThreadId: returned.codexThreadId },
    ], "the return switch lost or rewrote an earlier native turn");
    const stopMessages = await prisma.conversationMessage.findMany({ where: { conversationId: stopTask }, orderBy: { sequenceNo: "asc" } });
    assert.deepEqual(stopMessages.map(message => message.contentText),
      [initialQuestion, initialAnswer, switchQuestion, again, switchAnswer, returnQuestion, returnAnswer],
      "history did not preserve the earlier turns and the new source turn");
    assert(!stopMessages.some(message => message.contentText === switchBack), "the stopped submission was replayed into history");
    const returnUsage = await prisma.tokenUsageRecord.findMany({ where: { turnId: returned.id }, orderBy: { model: "asc" } });
    assert.deepEqual(returnUsage.map(row => [row.model, row.totalTokens, row.totalCostPicoUsd]),
      [[source, 5n, 70_000_000n], [target, 5n, 70_000_000n]],
      "the return switch did not bill one B compaction and one A inference");
    const returnHistory = await events.historyPage(ownerId, stopTask, { afterSequence: 0n, limit: 200 });
    assert.equal(returnHistory.items.filter(event =>
      event.turn_id === returned.id && event.event_type === "turn/completed").length, 1,
      "the new submission projected more than one terminal event");
    assert.equal(returnHistory.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const failure = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return failure.success && failure.data.start_failure.turn_id === canceled.turn_id;
    }).length, 1, "the stopped submission failure was replayed or duplicated");
    assert.deepEqual(modelCalls, [source, source, target, source, source, target, target, target, target, source],
      "the return switch replayed or skipped a model call");
    assert(providerInputs.slice(8).every(context => !context.includes(switchBack)),
      "the stopped submission was replayed to the provider");
    assert(!leaked && !invalidProviderRequest);
    console.log("Packaged Mac source compaction return passed: a new submission compacted model B once, inferred on model A once, forked the current B thread, preserved prior turns and events, and left no stopped work replayable.");

    const attachmentQuestion = "Continue with the synthetic attachment on the second model.";
    const attachmentKey = "return-attachment-switch";
    // These tasks bypass API workspace creation, so the server-side upload root must exist first.
    await mkdir(join(workspaceRoot, taskWorkspace(stopTask)), { recursive: true, mode: 0o700 });
    const staged = await files.uploadAttachment(ownerId, stopTask, {
      filename: "synthetic-switch.txt", reportedMimeType: "text/plain", data: Buffer.from("synthetic attachment"),
    }, {});
    assert.equal(staged.status, "staged");
    assert.equal(staged.turn_id, null);
    heldResponse = undefined;
    aborted = false;
    requests.push({ model: source, context: [returnAnswer] });
    const callsBeforeAttachmentSwitch = modelCalls.length;
    const downloadsBeforeAttachmentSwitch = attachmentDownloads;
    captureAttachmentStarts = true;
    const attached = await conversations.acceptTurn(ownerId, stopTask,
      submission(attachmentQuestion, target, attachmentKey), {});
    assert.equal(attached.status, "starting");
    const attachedTurn = attached.turn_id;
    await waitFor("the held source A compaction for the attached A-to-B switch", async () =>
      heldResponse !== undefined && providerInputs.at(-1)?.includes(returnAnswer));
    const attachedIntent = await prisma.conversationTurnStartIntent.findUniqueOrThrow({
      where: { projectionTurnId: attachedTurn },
    });
    assert.equal(attachedIntent.runnerStatus, "prepared");
    assert.equal(attachedIntent.model, target);
    assert.deepEqual(z.array(z.object({ id: z.uuid() })).parse(attachedIntent.attachmentsJson).map(file => file.id),
      [staged.id], "the attached switch did not snapshot the staged file");
    assert.equal(await redis.hasTurnSlot(stopTask, attachedTurn, ownerId), true,
      "the attached switch did not hold its exact turn slot");
    const unexpectedLock = await redis.acquireConversationLock(stopTask);
    if (unexpectedLock) await redis.releaseConversationLock(stopTask, unexpectedLock);
    assert.equal(unexpectedLock, null, "the attached switch did not hold the conversation dispatch lock");
    assert.equal(attachmentDownloads - downloadsBeforeAttachmentSwitch, 1,
      "the attached switch did not materialize its staged file exactly once");

    assert.equal((await conversations.interrupt(ownerId, stopTask, attachedTurn, {})).code,
      RUNNER_TURN_INTERRUPT_REQUESTED);
    await waitFor("cancellation of the held source A compaction", async () => aborted);
    const attachedDirect = await waitFor("the original attached turn.start failure", async () =>
      attachmentStartResults.find(entry => entry.turnId === attachedTurn)?.result ?? false);
    if (!attachedDirect.ok || attachedDirect.operation !== "turn.start") {
      assert.fail("the original attached turn.start did not return a scoped result");
    }
    assert.equal(attachedDirect.result.status, "failed", "the attached turn.start was not failed");
    assert.equal(attachedDirect.result.errorCode, "RUNNER_TURN_START_SEALED");
    const attachedReceipt = directReceiptEvidence.get(attachedTurn);
    assert(attachedReceipt, "the attached turn.start failure was not observed at the transport receipt");
    assert.equal(attachedReceipt.intent, true,
      "the failed attached receipt arrived after the API released its start intent");
    assert.equal(attachedReceipt.slot, true,
      "the failed attached receipt arrived after the API released its turn slot");
    assert(attachedReceipt.lease,
      "the failed attached receipt arrived after its execution lease was discarded");
    await waitFor("release of the failed attached switch", async () =>
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: attachedTurn } }) &&
      !await redis.hasTurnSlot(stopTask, attachedTurn, ownerId) &&
      await redis.client.get(desktopRunLeaseKey(attachedTurn)) === null,
    );
    assert.equal(await prisma.conversationTurn.count({
      where: { conversationId: stopTask },
    }), 4, "the stopped attached switch was projected as a new turn");
    const retainedAttachment = await prisma.conversationFile.findUniqueOrThrow({ where: { id: staged.id } });
    assert.equal(retainedAttachment.status, "staged");
    assert.equal(retainedAttachment.turnId, null);
    const materializedAttachments = await readdir(
      join(dataRoot, runtimeEnvironmentPath(ownerId, stopTask), "home", "workspace", "attachments"),
    ).catch(error => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    assert.equal(materializedAttachments.filter(name => name.includes(attachedTurn)).length, 0,
      "the failed attached switch left materialized device files");
    assert.deepEqual(modelCalls.slice(callsBeforeAttachmentSwitch), [source],
      "the stopped attached switch inferred on model B or replayed a call");
    assert.equal(attachmentDownloads - downloadsBeforeAttachmentSwitch, 1,
      "the stopped attached switch transferred its file again");
    const attachedFailure = await events.historyPage(ownerId, stopTask, { afterSequence: 0n, limit: 300 });
    assert.equal(attachedFailure.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const failure = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return failure.success && failure.data.error_code === "TURN_START_CLOSED" &&
        failure.data.start_failure.turn_id === attachedTurn;
    }).length, 1, "the stopped attached switch did not settle as TURN_START_CLOSED");

    const attachmentLeaseKey = desktopRunLeaseKey(attachedTurn);
    assert.equal(await redis.client.get(attachmentLeaseKey), null,
      "the stopped attached switch kept its old Redis grant");
    const startsBeforeRetry = attachmentStartResults.filter(entry => entry.turnId === attachedTurn).length;
    const callsBeforeRetry = modelCalls.length;
    const downloadsBeforeRetry = attachmentDownloads;
    assert.equal(await prisma.conversationTurn.count({ where: { id: attachedTurn } }), 0,
      "the same key had an existing turn to return synchronously");
    assert.equal(await prisma.conversationEvent.count({ where: { id: desktopStartStopEventId(attachedTurn) } }), 0,
      "the same key had a pre-admission stop result to return synchronously");
    const retried = await conversations.acceptTurn(ownerId, stopTask,
      submission(attachmentQuestion, target, attachmentKey), {});
    assert.equal(retried.turn_id, attachedTurn, "the same key created a different turn");
    assert.equal(retried.status, "starting",
      "the same key did not resubmit to the historical runner seal");
    const retryResults = await waitFor("the resubmitted attached turn.start result", async () => {
      const entries = attachmentStartResults.filter(entry => entry.turnId === attachedTurn);
      return entries.length > startsBeforeRetry ? entries : false;
    });
    assert.equal(retryResults.length, startsBeforeRetry + 1,
      "the same key dispatched more than one native start");
    const retryDirect = retryResults.at(-1)!.result;
    if (!retryDirect.ok || retryDirect.operation !== "turn.start") {
      assert.fail("the resubmitted attached turn.start did not return a scoped result");
    }
    assert.equal(retryDirect.result.status, "failed", "the resubmitted attached turn.start was not failed");
    assert.equal(retryDirect.result.errorCode, "RUNNER_TURN_START_SEALED");
    await waitFor("settlement of the resubmitted attached switch", async () =>
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: attachedTurn } }) &&
      !await redis.hasTurnSlot(stopTask, attachedTurn, ownerId) &&
      await redis.client.get(attachmentLeaseKey) === null,
    );
    assert.deepEqual(modelCalls.slice(callsBeforeRetry), [],
      "the same key replayed a native model request");
    assert.equal(attachmentStartResults.filter(entry => entry.turnId === attachedTurn).length, 2,
      "the same key did not dispatch exactly one sealed resubmission");
    assert.equal(attachmentDownloads - downloadsBeforeRetry, 0,
      "the same key transferred the attachment again");
    assert.equal(await prisma.conversationTurn.count({ where: { id: attachedTurn } }), 0,
      "the resubmitted attached switch was projected");
    const retriedAttachment = await prisma.conversationFile.findUniqueOrThrow({ where: { id: staged.id } });
    assert.equal(retriedAttachment.status, "staged");
    assert.equal(retriedAttachment.turnId, null);

    // Drop the verified failed receipt seam-side once. The runner has sealed the
    // start, but the API never ingests this result. Background recovery must
    // still match the exact failure and retire the old execution grant before
    // releasing the intent and slot; then the same key must reach that seal.
    const droppedQuestion = "Continue after the dropped attached receipt.";
    const droppedKey = "dropped-attached-receipt";
    requests.push({ model: source, context: [returnAnswer] });
    heldResponse = undefined;
    aborted = false;
    const callsBeforeDropped = modelCalls.length;
    const downloadsBeforeDropped = attachmentDownloads;
    dropSealedDirectReceipt = true;
    const dropped = await conversations.acceptTurn(ownerId, stopTask,
      submission(droppedQuestion, target, droppedKey), {});
    assert.equal(dropped.status, "starting");
    const droppedTurn = dropped.turn_id;
    droppedReceiptTurn = droppedTurn;
    await waitFor("the held source compaction for the dropped receipt", async () =>
      heldResponse !== undefined && providerInputs.at(-1)?.includes(returnAnswer));
    const droppedIntent = await prisma.conversationTurnStartIntent.findUniqueOrThrow({
      where: { projectionTurnId: droppedTurn },
    });
    assert.equal(droppedIntent.runnerStatus, "prepared");
    assert.equal(droppedIntent.model, target);
    assert.deepEqual(z.array(z.object({ id: z.uuid() })).parse(droppedIntent.attachmentsJson).map(file => file.id),
      [staged.id], "the dropped switch did not snapshot the staged file");
    assert.equal(await redis.hasTurnSlot(stopTask, droppedTurn, ownerId), true,
      "the dropped switch did not hold its exact turn slot");
    const droppedLock = await redis.acquireConversationLock(stopTask);
    if (droppedLock) await redis.releaseConversationLock(stopTask, droppedLock);
    assert.equal(droppedLock, null, "the dropped switch did not hold the conversation dispatch lock");
    const droppedLeaseKey = desktopRunLeaseKey(droppedTurn);
    const droppedLease = await redis.client.get(droppedLeaseKey);
    assert(droppedLease, "the dropped switch did not hold its execution lease");
    assert.equal(attachmentDownloads - downloadsBeforeDropped, 1,
      "the dropped switch did not materialize its staged file exactly once");

    assert.equal((await conversations.interrupt(ownerId, stopTask, droppedTurn, {})).code,
      RUNNER_TURN_INTERRUPT_REQUESTED);
    await waitFor("cancellation of the held source compaction for the dropped receipt", async () => aborted);
    const droppedDirect = await waitFor("the dropped attached turn.start failure", async () =>
      attachmentStartResults.find(entry => entry.turnId === droppedTurn)?.result ?? false);
    if (!droppedDirect.ok || droppedDirect.operation !== "turn.start") {
      assert.fail("the dropped attached turn.start did not return a scoped result");
    }
    assert.equal(droppedDirect.result.status, "failed", "the dropped attached turn.start was not failed");
    assert.equal(droppedDirect.result.errorCode, "RUNNER_TURN_START_SEALED");
    assert.equal(dropSealedDirectReceipt, false, "the fixture did not drop the sealed direct receipt");
    const droppedReceipt = directReceiptEvidence.get(droppedTurn);
    assert(droppedReceipt, "the dropped receipt was not observed at the transport seam");
    assert.equal(droppedReceipt.intent, true,
      "the dropped receipt arrived after the API released its start intent");
    assert.equal(droppedReceipt.slot, true,
      "the dropped receipt arrived after the API released its turn slot");
    assert.equal(droppedReceipt.lease, droppedLease,
      "the dropped receipt did not carry the exact old execution grant");

    const droppedJournal = join(dataRoot, runtimeEnvironmentPath(ownerId, stopTask), "control", "workspaces", stopTask,
      "start-operations", `${droppedTurn}.json`);
    const droppedJournalBefore = await readFile(droppedJournal, "utf8");
    await waitFor("release of the dropped switch intent and slot", async () =>
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: droppedTurn } }) &&
      !await redis.hasTurnSlot(stopTask, droppedTurn, ownerId));
    assert(droppedReceiptRecovery.some(entry => {
      if (entry.operation !== "turn.inspect" || !entry.result.ok || entry.result.operation !== "turn.inspect") return false;
      const receipt = entry.result.result;
      return receipt?.status === "failed" && receipt.errorCode === "RUNNER_TURN_START_SEALED";
    }), "recovery did not inspect the exact sealed native start before releasing it");
    assert.equal(await redis.client.get(droppedLeaseKey), null,
      "recovery released the failed start intent and slot but kept the stale execution lease");
    assert.equal(await prisma.conversationTurn.count({ where: { id: droppedTurn } }), 0,
      "the dropped switch was projected");
    assert.equal((await prisma.conversation.findUniqueOrThrow({ where: { id: stopTask } })).codexThreadId,
      returned.codexThreadId, "the dropped switch rewrote the conversation thread");
    const droppedAttachment = await prisma.conversationFile.findUniqueOrThrow({ where: { id: staged.id } });
    assert.equal(droppedAttachment.status, "staged");
    assert.equal(droppedAttachment.turnId, null);
    const droppedMaterialized = await readdir(
      join(dataRoot, runtimeEnvironmentPath(ownerId, stopTask), "home", "workspace", "attachments"),
    ).catch(error => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    });
    assert.equal(droppedMaterialized.filter(name => name.includes(droppedTurn)).length, 0,
      "the dropped switch left materialized device files");
    assert.deepEqual(modelCalls.slice(callsBeforeDropped), [source],
      "the dropped switch inferred on model B or replayed a call");
    assert.equal(attachmentDownloads - downloadsBeforeDropped, 1,
      "recovery transferred the dropped switch attachment");
    assert.equal(await readFile(droppedJournal, "utf8"), droppedJournalBefore,
      "recovery rewrote the dropped switch journal");
    const droppedHistory = await events.historyPage(ownerId, stopTask, { afterSequence: 0n, limit: 400 });
    const droppedFailures = droppedHistory.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const failure = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return failure.success && failure.data.error_code === "TURN_START_CLOSED" &&
        failure.data.start_failure.turn_id === droppedTurn;
    });
    assert.equal(droppedFailures.length, 1,
      "the dropped receipt did not settle exactly once as TURN_START_CLOSED");

    const startsBeforeDroppedRetry = attachmentStartResults.filter(entry => entry.turnId === droppedTurn).length;
    const callsBeforeDroppedRetry = modelCalls.length;
    const downloadsBeforeDroppedRetry = attachmentDownloads;
    assert.equal(await prisma.conversationTurn.count({ where: { id: droppedTurn } }), 0,
      "the dropped key had an existing turn to return synchronously");
    assert.equal(await prisma.conversationEvent.count({ where: { id: desktopStartStopEventId(droppedTurn) } }), 0,
      "the dropped key had a pre-admission stop result to return synchronously");
    const droppedRetried = await conversations.acceptTurn(ownerId, stopTask,
      submission(droppedQuestion, target, droppedKey), {});
    assert.equal(droppedRetried.turn_id, droppedTurn, "the dropped key created a different turn");
    assert.equal(droppedRetried.status, "starting",
      "the dropped key did not resubmit to the historical runner seal");
    const droppedRetryResults = await waitFor("the resubmitted dropped turn.start result", async () => {
      const entries = attachmentStartResults.filter(entry => entry.turnId === droppedTurn);
      return entries.length > startsBeforeDroppedRetry ? entries : false;
    });
    assert.equal(droppedRetryResults.length, startsBeforeDroppedRetry + 1,
      "the dropped key dispatched more than one native start");
    const droppedRetryDirect = droppedRetryResults.at(-1)!.result;
    if (!droppedRetryDirect.ok || droppedRetryDirect.operation !== "turn.start") {
      assert.fail("the resubmitted dropped turn.start did not return a scoped result");
    }
    assert.equal(droppedRetryDirect.result.status, "failed",
      "the resubmitted dropped turn.start was not failed");
    assert.equal(droppedRetryDirect.result.errorCode, "RUNNER_TURN_START_SEALED");
    await waitFor("settlement of the resubmitted dropped switch", async () =>
      !await prisma.conversationTurnStartIntent.count({ where: { projectionTurnId: droppedTurn } }) &&
      !await redis.hasTurnSlot(stopTask, droppedTurn, ownerId) &&
      await redis.client.get(droppedLeaseKey) === null,
    );
    assert.equal(attachmentStartResults.filter(entry => entry.turnId === droppedTurn).length, 2,
      "the dropped key dispatched an extra native start");
    assert.deepEqual(modelCalls.slice(callsBeforeDroppedRetry), [],
      "the dropped key replayed a native model request");
    assert.equal(attachmentDownloads - downloadsBeforeDroppedRetry, 0,
      "the dropped key transferred the attachment again");
    assert.equal(await prisma.conversationTurn.count({ where: { id: droppedTurn } }), 0,
      "the resubmitted dropped switch was projected");
    const droppedRetriedAttachment = await prisma.conversationFile.findUniqueOrThrow({ where: { id: staged.id } });
    assert.equal(droppedRetriedAttachment.status, "staged");
    assert.equal(droppedRetriedAttachment.turnId, null);
    assert.equal(await readFile(droppedJournal, "utf8"), droppedJournalBefore,
      "the resubmitted dropped switch rewrote the sealed journal");
    const droppedFinalHistory = await events.historyPage(ownerId, stopTask, { afterSequence: 0n, limit: 500 });
    assert.equal(droppedFinalHistory.items.filter(event => {
      if (event.event_type !== "conversation.error") return false;
      const failure = conversationStartFailurePayloadSchema.safeParse(event.payload);
      return failure.success && failure.data.error_code === "TURN_START_CLOSED" &&
        failure.data.start_failure.turn_id === droppedTurn;
    }).length, 2, "the resubmitted dropped switch did not settle exactly once more");
    assert(!leaked && !invalidProviderRequest);
    console.log("Packaged Mac dropped-receipt recovery passed: matched recovery retired the stale grant before releasing the failed start, and the exact resubmission reached the historical seal without inference or transfer.");
    console.log("Packaged Mac attached model-switch Stop passed: the held source compaction kept the dispatch lock, the direct start returned sealed after retirement, and the same key did not revive its grant or transfer the file again.");
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
