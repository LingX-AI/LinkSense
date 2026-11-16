/** Upgrade real native history in a disposable HOME using a loopback model fixture. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import pino from "../apps/runner/node_modules/pino/pino.js";
import { z } from "zod";

import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts";
import {
  CODEX_SCHEMA_VERSION,
  type JsonRpcNotification,
} from "../apps/runner/src/codex/protocol.ts";

const previousVersion = "0.154.0";
const model = "gpt-6-astra";
const outputText = "HISTORY_UPGRADE_FIXTURE_OK";
const previousInputs = ["HISTORY_BEFORE_UPGRADE_FIRST", "HISTORY_BEFORE_UPGRADE_SECOND"];
const currentInput = "HISTORY_AFTER_UPGRADE";
const forkInput = "HISTORY_FORK_AFTER_UPGRADE";
const execFileAsync = promisify(execFile);
const nativeId = z.string().min(1);
const turnSchema = z.object({
  id: nativeId,
  status: z.enum(["inProgress", "completed", "interrupted", "failed"]),
  items: z.array(z.unknown()),
});
const threadResponseSchema = z.object({
  thread: z.object({
    id: nativeId,
    modelProvider: z.literal("link-sense"),
    turns: z.array(turnSchema).optional(),
  }),
});
const turnResponseSchema = z.object({ turn: z.object({ id: nativeId }) });
const turnNotificationSchema = z.object({
  method: z.enum(["turn/started", "turn/completed"]),
  params: z.object({ threadId: nativeId, turn: turnSchema }),
});
const userItemSchema = z.object({
  type: z.literal("userMessage"),
  clientId: nativeId.nullable(),
  content: z.array(z.unknown()),
});
const inputTextSchema = z.object({ type: z.literal("text"), text: z.string() });
const assistantItemSchema = z.object({
  type: z.literal("agentMessage"),
  phase: z.literal("final_answer"),
  text: z.string(),
});
const fixtureRequestSchema = z.object({ input: z.array(z.unknown()) });
type NativeTurn = z.infer<typeof turnSchema>;
type Session = {
  client: CodexJsonRpcClient;
  notifications: JsonRpcNotification[];
};

async function checkVersion(command: string, expected: string): Promise<void> {
  const { stdout } = await execFileAsync(command, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 4096,
  });
  assert.equal(stdout.trim(), `codex-cli ${expected}`);
}

async function waitForTurn(
  session: Session,
  threadId: string,
  turnId: string,
  method: "turn/started" | "turn/completed",
): Promise<NativeTurn> {
  const deadline = Date.now() + 20_000;
  do {
    for (const raw of session.notifications) {
      const event = turnNotificationSchema.safeParse(raw);
      if (
        event.success && event.data.method === method &&
        event.data.params.threadId === threadId &&
        event.data.params.turn.id === turnId
      ) return event.data.params.turn;
    }
    await delay(20);
  } while (Date.now() < deadline);
  throw new Error(`Native history probe did not observe ${method}`);
}

async function startTurn(
  session: Session,
  threadId: string,
  text: string,
  clientId: string,
): Promise<string> {
  const result = turnResponseSchema.parse(await session.client.request("turn/start", {
    threadId,
    model,
    clientUserMessageId: clientId,
    input: [{ type: "text", text, text_elements: [] }],
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  }));
  return result.turn.id;
}

async function completeTurn(
  session: Session,
  threadId: string,
  text: string,
  clientId = randomUUID(),
): Promise<string> {
  const turnId = await startTurn(session, threadId, text, clientId);
  const turn = await waitForTurn(session, threadId, turnId, "turn/completed");
  assert.equal(turn.status, "completed");
  return turnId;
}

async function readHistory(session: Session, threadId: string): Promise<NativeTurn[]> {
  const result = threadResponseSchema.parse(await session.client.request("thread/read", {
    threadId,
    includeTurns: true,
  }));
  assert.equal(result.thread.id, threadId);
  assert(result.thread.turns, "Native history must be hydrated");
  return result.thread.turns;
}

function assertUserInput(turns: NativeTurn[], text: string, clientId?: string): void {
  const users = turns.flatMap((turn) => turn.items.flatMap((item) => {
    const user = userItemSchema.safeParse(item);
    return user.success ? [user.data] : [];
  }));
  const matches = users.filter((user) => user.content.some((part) =>
    inputTextSchema.safeParse(part).data?.text === text,
  ));
  assert.equal(matches.length, 1, "Native input must remain present exactly once");
  if (clientId) assert.equal(matches[0]?.clientId, clientId);
}

function assertPreviousHistory(turns: NativeTurn[], clientIds: string[]): void {
  for (const [index, text] of previousInputs.entries()) {
    assertUserInput(turns, text, clientIds[index]);
    const turn = turns[index];
    assert(turn, "An original turn must remain present");
    assert.equal(turn.status, "completed");
    assert(turn.items.some((item) => assistantItemSchema.safeParse(item).data?.text === outputText));
  }
}

async function main(): Promise<void> {
  const commands = z.object({
    CODEX_PREVIOUS_BIN: z.string().trim().min(1),
    CODEX_BIN: z.string().trim().min(1),
  }).parse(process.env);
  await checkVersion(commands.CODEX_PREVIOUS_BIN, previousVersion);
  await checkVersion(commands.CODEX_BIN, CODEX_SCHEMA_VERSION);
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "linksense-history-upgrade-")));
  const home = path.join(root, "home");
  const codexHome = path.join(home, ".codex");
  const workspace = path.join(home, "workspace");
  const sessions: Session[] = [];
  const requests: z.infer<typeof fixtureRequestSchema>[] = [];
  const failures: unknown[] = [];
  let heldResponse: ServerResponse | undefined;
  let blockNextRequest: (() => void) | undefined;
  const provider = createServer((request, response) => {
    void respond(request, response).catch((error: unknown) => {
      failures.push(error);
      response.writeHead(500);
      response.end("Synthetic inference fixture failed");
    });
  });

  async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    assert.equal(request.headers.authorization, "Bearer history-upgrade-fixture-key");
    let body = "";
    for await (const chunk of request) {
      body += String(chunk);
      assert(Buffer.byteLength(body) <= 4 * 1024 * 1024, "Fixture request exceeded its limit");
    }
    requests.push(fixtureRequestSchema.parse(JSON.parse(body)));
    assert(requests.length <= 20, "Native probe must not create unbounded inference requests");
    response.writeHead(200, { "content-type": "text/event-stream" });
    if (blockNextRequest) {
      heldResponse = response;
      response.flushHeaders();
      const unblock = blockNextRequest;
      blockNextRequest = undefined;
      unblock();
      return;
    }
    const id = `history-fixture-response-${requests.length}`;
    const item = {
      id: `history-fixture-message-${requests.length}`,
      type: "message", role: "assistant", status: "completed", phase: "final_answer",
      content: [{ type: "output_text", text: outputText, annotations: [] }],
    };
    const result = {
      id, object: "response", status: "completed", model, output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
  }

  try {
    await mkdir(codexHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    // Deliberately retain a pre-upgrade HOME rather than generating only new-format state.
    await writeFile(path.join(codexHome, "config.toml"), [
      'model_provider="link-sense"', 'forced_login_method="api"',
      "check_for_update_on_startup=false", "allow_login_shell=false",
      'web_search="disabled"', "[features]", "multi_agent=false",
      "memories=false", "hooks=false", "plugins=false", "shell_snapshot=false",
      "[skills.bundled]", "enabled=false",
    ].join("\n"));
    await new Promise<void>((resolve, reject) => {
      provider.once("error", reject);
      provider.listen(0, "127.0.0.1", resolve);
    });
    const address = provider.address();
    assert(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}/v1`;
    const runtimeParams = {
      model, modelProvider: "link-sense", cwd: workspace,
      runtimeWorkspaceRoots: [workspace], approvalPolicy: "never", sandbox: "danger-full-access",
    };
    async function connect(command: string): Promise<Session> {
      const client = new CodexJsonRpcClient({
        command, userHome: home, codexHome, logger: pino({ enabled: false }),
        requestTimeoutMs: 20_000,
        extraEnvironment: { LINKSENSE_MODEL_GATEWAY_TOKEN: "history-upgrade-fixture-key" },
        configOverrides: [
          "agents.enabled=false", 'model_providers.link-sense.name="LinkSense"',
          `model_providers.link-sense.base_url=${JSON.stringify(baseUrl)}`,
          'model_providers.link-sense.wire_api="responses"',
          'model_providers.link-sense.env_key="LINKSENSE_MODEL_GATEWAY_TOKEN"',
          "model_providers.link-sense.requires_openai_auth=false",
          "model_providers.link-sense.supports_websockets=false",
        ],
      });
      const session: Session = { client, notifications: [] };
      client.on("notification", (event: JsonRpcNotification) => session.notifications.push(event));
      sessions.push(session);
      await client.initialize();
      return session;
    }
    const previous = await connect(commands.CODEX_PREVIOUS_BIN);
    const started = threadResponseSchema.parse(await previous.client.request("thread/start", runtimeParams));
    const threadId = started.thread.id;
    const clientIds = previousInputs.map(() => randomUUID());
    for (const [index, text] of previousInputs.entries()) {
      await completeTurn(previous, threadId, text, clientIds[index]);
    }
    const original = await readHistory(previous, threadId);
    assert.equal(original.length, 2);
    assertPreviousHistory(original, clientIds);
    await previous.client.close();

    let current = await connect(commands.CODEX_BIN);
    const upgraded = await readHistory(current, threadId);
    assert.equal(upgraded.length, 2);
    assert.deepEqual(upgraded.map((turn) => turn.id), original.map((turn) => turn.id));
    assertPreviousHistory(upgraded, clientIds);
    const resumed = threadResponseSchema.parse(await current.client.request("thread/resume", {
      ...runtimeParams, threadId, excludeTurns: true,
    }));
    assert.equal(resumed.thread.id, threadId);
    await completeTurn(current, threadId, currentInput);
    const continued = await readHistory(current, threadId);
    assert.equal(continued.length, 3);
    assertPreviousHistory(continued, clientIds);
    assertUserInput(continued, currentInput);
    const inferenceContext = JSON.stringify(requests.at(-1)?.input);
    for (const text of previousInputs) assert(inferenceContext.includes(text));
    assert(inferenceContext.includes(outputText), "Old assistant output must reach continued inference");

    const forked = threadResponseSchema.parse(await current.client.request("thread/fork", {
      ...runtimeParams, threadId, lastTurnId: original.at(-1)?.id, deferGoalContinuation: true,
    }));
    const forkId = forked.thread.id;
    assert.notEqual(forkId, threadId);
    const forkedHistory = await readHistory(current, forkId);
    assert.equal(forkedHistory.length, 2);
    assertPreviousHistory(forkedHistory, clientIds);
    await completeTurn(current, forkId, forkInput);
    const continuedFork = await readHistory(current, forkId);
    assert.equal(continuedFork.length, 3);
    assertUserInput(continuedFork, forkInput);
    assert.equal((await readHistory(current, threadId)).length, 3);

    const goalSchema = z.object({ goal: z.object({
      objective: z.literal("Synthetic historical upgrade check"),
      status: z.literal("paused"), tokenBudget: z.literal(1000),
    }) });
    goalSchema.parse(await current.client.request("thread/goal/set", {
      threadId, objective: "Synthetic historical upgrade check", status: "paused", tokenBudget: 1000,
    }));
    goalSchema.parse(await current.client.request("thread/goal/get", { threadId }));
    z.object({ cleared: z.literal(true) }).parse(await current.client.request("thread/goal/clear", { threadId }));
    z.object({ goal: z.null() }).parse(await current.client.request("thread/goal/get", { threadId }));

    const requestStarted = new Promise<void>((resolve) => { blockNextRequest = resolve; });
    const interruptedId = await startTurn(current, threadId, "HISTORY_INTERRUPT_ACTIVE_INFERENCE", randomUUID());
    await Promise.race([
      requestStarted,
      delay(20_000, undefined, { ref: false }).then(() => {
        throw new Error("Native inference did not start before interruption");
      }),
    ]);
    await waitForTurn(current, threadId, interruptedId, "turn/started");
    await current.client.request("turn/interrupt", { threadId, turnId: interruptedId });
    const interrupted = await waitForTurn(current, threadId, interruptedId, "turn/completed");
    assert.equal(interrupted.status, "interrupted");
    heldResponse?.end();
    await current.client.close();
    current = await connect(commands.CODEX_BIN);
    await current.client.request("thread/resume", { ...runtimeParams, threadId, excludeTurns: true });
    const recovered = await readHistory(current, threadId);
    assert.equal(recovered.length, 4);
    assertPreviousHistory(recovered, clientIds);
    assertUserInput(recovered, currentInput);
    assert.equal(recovered.at(-1)?.status, "interrupted");
    assert.equal(failures.length, 0, "The local model fixture must not fail");
    console.log(JSON.stringify({
      status: "ok", previousVersion, version: CODEX_SCHEMA_VERSION,
      oldTurns: original.length, historicalClientIdsPreserved: true,
      oldContextUsedByInference: true, continuedAfterUpgrade: true,
      forkContinuedIndependently: true, goalSetReadCleared: true,
      activeInferenceInterrupted: true, restartRecovered: true,
      fixtureModelRequests: requests.length, externalModelRequests: 0,
    }));
  } finally {
    heldResponse?.end();
    const closed = await Promise.allSettled(sessions.map((session) => session.client.close()));
    provider.closeAllConnections();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    if (closed.some((result) => result.status === "rejected")) {
      throw new Error("The historical upgrade probe could not close every native process");
    }
  }
}

await main();
