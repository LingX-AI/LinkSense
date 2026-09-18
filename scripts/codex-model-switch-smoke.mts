import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import pino from "../apps/runner/node_modules/pino/pino.js";

import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts";
import {
  CODEX_SCHEMA_VERSION,
  type CodexThread,
  type CodexTurn,
  type JsonRpcNotification,
} from "../apps/runner/src/codex/protocol.ts";
import {
  ModelGateway,
  modelGatewayEnvironmentKey,
} from "../apps/runner/src/model-gateway/model-gateway.ts";

type JsonObject = Record<string, unknown>;
type ResponseStreamEvent = { event: string; data: JsonObject };

const execFileAsync = promisify(execFile);
const deepSeekToLuna = process.argv.includes("--deepseek-to-luna");
const sourceModel = deepSeekToLuna ? "deepseek-flash" : "gpt-5.6-luna";
const targetModel = deepSeekToLuna ? "gpt-5.6-luna" : "qwen3.8-27b";
const encryptedReasoning = "ZW5jcnlwdGVkLXByb3ZpZGVyLXN0YXRl";
const sourceReasoningText = "Synthetic source-provider reasoning for the model switch regression.";
const compactedContext = "The source task completed and its relevant context was compacted.";
const sourceMarker = "LINKSENSE_SOURCE_REASONING_OK";
const targetMarker = "LINKSENSE_MODEL_SWITCH_OK";
const codexVersionOutput = await codexVersion();
const actualCodexVersion = codexVersionOutput.match(
  /\bcodex-cli\s+(\d+\.\d+\.\d+)\b/u,
)?.[1];
if (actualCodexVersion !== CODEX_SCHEMA_VERSION) {
  throw new Error(
    `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${actualCodexVersion ?? "unknown"}`,
  );
}

const root = await mkdtemp(path.join(tmpdir(), "linksense-model-switch-smoke-"));
const userHome = path.join(root, "home");
const codexHome = path.join(userHome, ".codex");
const workspace = path.join(userHome, "workspace");
await Promise.all([
  mkdir(codexHome, { recursive: true }),
  mkdir(workspace, { recursive: true }),
]);

const logger = pino({ enabled: false });
const requests: Array<{
  route: "source" | "target";
  authorization: string | undefined;
  body: JsonObject;
}> = [];
let sourceGeneratedRequestCount = 0;
let targetGeneratedRequestCount = 0;
const compactionNotifications: Partial<Record<"item/started" | "item/completed", JsonObject>> = {};
let compactionResponseReleased = false;
let compactionCompletedBeforeResponse = false;

const upstream = createServer((request, response) => {
  void handleUpstream(request, response).catch((error: unknown) => {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "upstream failed",
        }),
      );
    } else {
      response.destroy(error instanceof Error ? error : undefined);
    }
  });
});
await new Promise<void>((resolve, reject) => {
  upstream.once("error", reject);
  upstream.listen(0, "127.0.0.1", resolve);
});
const upstreamAddress = upstream.address();
if (!upstreamAddress || typeof upstreamAddress === "string") {
  throw new Error("smoke upstream did not bind a TCP port");
}
const upstreamOrigin = `http://127.0.0.1:${upstreamAddress.port}`;
const sourceBaseUrl = `${upstreamOrigin}/source/v1`;
const targetBaseUrl = `${upstreamOrigin}/target/v1`;
const gateway = new ModelGateway({ logger });
await gateway.start();

try {
  await writeFile(
    path.join(codexHome, "config.toml"),
    [
      "check_for_update_on_startup = false",
      'forced_login_method = "api"',
      "allow_login_shell = false",
      "",
      "[features]",
      "shell_snapshot = false",
      "apps = false",
      "plugins = false",
      "multi_agent = false",
      "",
      "[model_providers.link-sense]",
      'name = "LinkSense Model Switch Smoke"',
      `base_url = ${JSON.stringify(gateway.baseUrl)}`,
      'wire_api = "responses"',
      `env_key = ${JSON.stringify(modelGatewayEnvironmentKey)}`,
      "supports_websockets = false",
      "stream_max_retries = 2",
      "requires_openai_auth = false",
      "",
    ].join("\n"),
  );

  const sourceLease = gateway.issueLease({
    conversationId: "model-switch-smoke-source",
    ownerId: "10000000-0000-4000-8000-000000000001",
    revision: 1,
    upstreamBaseUrl: sourceBaseUrl,
    apiKey: "source-provider-key",
    protocolMode: "native_responses",
    model: sourceModel,
    pricing: zeroPricing(),
  });
  const sourceClient = createClient(sourceLease.token);
  let threadId: string;
  try {
    const completedTurns = collectCompletedTurns(sourceClient);
    await sourceClient.initialize();
    const started = await sourceClient.request<{ thread: CodexThread }>(
      "thread/start",
      {
        model: sourceModel,
        modelProvider: "link-sense",
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ephemeral: false,
      },
    );
    threadId = started.thread.id;
    const turn = await sourceClient.request<{ turn: CodexTurn }>(
      "turn/start",
      {
        threadId,
        model: sourceModel,
        clientUserMessageId: "01900000-0000-7000-8000-000000000001",
        input: [
          {
            type: "text",
            text: `Reply with exactly ${sourceMarker}. Do not call tools.`,
            text_elements: [],
          },
        ],
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    );
    const completed = await completedTurns.wait(turn.turn.id);
    if (completed.status !== "completed") {
      throw new Error(`source turn did not complete: ${completed.error?.message ?? completed.status}`);
    }
  } finally {
    await sourceClient.close().catch(() => undefined);
    sourceLease.release();
  }

  const targetLease = gateway.issueLease({
    conversationId: "model-switch-smoke-target",
    ownerId: "10000000-0000-4000-8000-000000000001",
    revision: 2,
    upstreamBaseUrl: targetBaseUrl,
    apiKey: "target-provider-key",
    protocolMode: "native_responses",
    model: targetModel,
    pricing: zeroPricing(),
  });
  const transitionNonce = "model-switch-smoke-transition-nonce";
  targetLease.setModelTransition(
    {
      revision: 1,
      upstreamBaseUrl: sourceBaseUrl,
      apiKey: "source-provider-key",
      protocolMode: "native_responses",
      model: sourceModel,
      pricing: zeroPricing(),
    },
    transitionNonce,
  );
  const targetClient = createClient(targetLease.token);
  targetClient.on("notification", (notification: JsonRpcNotification) => {
    if (notification.method !== "item/started" && notification.method !== "item/completed") return;
    const params = notification.params;
    if (!isRecord(params) || !isRecord(params.item) || params.item.type !== "contextCompaction") return;
    compactionNotifications[notification.method] = params;
    if (notification.method === "item/completed" && !compactionResponseReleased) {
      compactionCompletedBeforeResponse = true;
    }
  });
  let compactTurnId: string;
  let targetThreadId: string;
  let targetTurnId: string;
  try {
    const completedTurns = collectCompletedTurns(targetClient);
    await targetClient.initialize();
    const resumed = await targetClient.request<{
      thread: CodexThread;
      model: string;
      modelProvider: string;
    }>("thread/resume", {
      threadId,
      model: sourceModel,
      modelProvider: "link-sense",
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      excludeTurns: true,
    });
    if (
      resumed.thread.id !== threadId ||
      resumed.model !== sourceModel ||
      resumed.modelProvider !== "link-sense"
    ) {
      throw new Error(
        `Codex did not resume the exact source-model thread: ${JSON.stringify({
          expectedThreadId: threadId,
          actualThreadId: resumed.thread.id,
          expectedModel: sourceModel,
          actualModel: resumed.model,
          actualModelProvider: resumed.modelProvider,
        })}`,
      );
    }
    const beforeCompact = await targetClient.request<{ thread: CodexThread }>(
      "thread/read",
      { threadId, includeTurns: true },
    );
    const baselineTurnIds = new Set(
      beforeCompact.thread.turns?.map((turn) => turn.id) ?? [],
    );
    if (baselineTurnIds.size !== 1) {
      throw new Error("source thread did not contain exactly one baseline turn");
    }

    targetLease.setManualModelTransitionCompaction(true);
    try {
      await targetClient.request("thread/compact/start", { threadId });
      const compactTurn = await waitForCompactionTurn(
        targetClient,
        threadId,
        baselineTurnIds,
      );
      compactTurnId = compactTurn.id;
      for (const method of ["item/started", "item/completed"] as const) {
        if (compactionNotifications[method]?.turnId !== compactTurnId) {
          throw new Error(`native compaction did not stream ${method}`);
        }
      }
      if (compactionCompletedBeforeResponse) {
        throw new Error("native compaction completed before the upstream response");
      }
    } finally {
      targetLease.setManualModelTransitionCompaction(false);
    }

    const forked = await targetClient.request<{
      thread: CodexThread;
      model: string;
      modelProvider: string;
    }>("thread/fork", {
      threadId,
      model: targetModel,
      modelProvider: "link-sense",
      cwd: workspace,
      runtimeWorkspaceRoots: [workspace],
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      deferGoalContinuation: true,
    });
    if (
      !forked.thread.id ||
      forked.thread.id === threadId ||
      forked.model !== targetModel ||
      forked.modelProvider !== "link-sense"
    ) {
      throw new Error("Codex did not fork the compacted history to the target");
    }
    targetThreadId = forked.thread.id;
    const targetTurn = await targetClient.request<{ turn: CodexTurn }>(
      "turn/start",
      {
        threadId: targetThreadId,
        model: targetModel,
        clientUserMessageId: "01900000-0000-7000-8000-000000000002",
        responsesapiClientMetadata: {
          linksense_transition_nonce: transitionNonce,
        },
        input: [
          {
            type: "text",
            text: `Reply with exactly ${targetMarker}. Do not call tools.`,
            text_elements: [],
          },
        ],
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      },
    );
    targetTurnId = targetTurn.turn.id;
    const completed = await completedTurns.wait(targetTurnId);
    if (completed.status !== "completed") {
      throw new Error(`target turn did not complete: ${completed.error?.message ?? completed.status}`);
    }
    const read = await targetClient.request<{ thread: CodexThread }>(
      "thread/read",
      { threadId: targetThreadId, includeTurns: true },
    );
    const answer = agentText(requiredTurn(read.thread, targetTurnId)).trim();
    if (answer !== targetMarker) {
      throw new Error(
        `target returned an unexpected answer: ${JSON.stringify(answer)}`,
      );
    }
  } finally {
    await targetClient.close().catch(() => undefined);
    targetLease.release();
  }

  const sourceRequests = requests.filter(
    (request) => request.route === "source" && request.body.generate !== false,
  );
  const targetRequests = requests.filter(
    (request) => request.route === "target" && request.body.generate !== false,
  );
  if (sourceRequests.length !== 2 || targetRequests.length !== 1) {
    throw new Error(
      `unexpected generated request counts: source=${sourceRequests.length}, target=${targetRequests.length}`,
    );
  }
  console.log(
    JSON.stringify({
      status: "ok",
      codexVersion: codexVersionOutput,
      sourceModel,
      targetModel,
      sourceThreadId: threadId,
      compactTurnId,
      targetThreadId,
      targetTurnId,
      sourceRequestCount: sourceRequests.length,
      targetRequestCount: targetRequests.length,
      encryptedReasoningSeenBySourceCompaction: true,
      encryptedReasoningSeenByTarget: false,
      plaintextReasoningSeenBySourceCompaction: deepSeekToLuna,
      plaintextReasoningSeenByTarget: false,
      compactedContextSeenByTarget: true,
      compactionStartReceivedBeforeUpstreamResponse: true,
    }),
  );
} finally {
  await gateway.close().catch(() => undefined);
  await new Promise<void>((resolve) => {
    upstream.close(() => resolve());
    upstream.closeAllConnections();
  });
  await rm(root, { recursive: true, force: true });
}

function createClient(gatewayToken: string): CodexJsonRpcClient {
  return new CodexJsonRpcClient({
    command: process.env.CODEX_BIN?.trim() || "codex",
    userHome,
    codexHome,
    logger,
    requestTimeoutMs: 60_000,
    extraEnvironment: {
      [modelGatewayEnvironmentKey]: gatewayToken,
    },
  });
}

async function handleUpstream(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const route = routeFor(request.url);
  const expectedAuthorization =
    route === "source"
      ? "Bearer source-provider-key"
      : "Bearer target-provider-key";
  if (request.headers.authorization !== expectedAuthorization) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"error":"unauthorized"}');
    return;
  }
  const body = await readJson(request);
  requests.push({
    route,
    authorization: request.headers.authorization,
    body,
  });
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
  });
  if (body.generate === false) {
    writeEvents(
      response,
      buildResponsesTextEvents(
        "",
        "resp_warmup",
        route === "source" ? sourceModel : targetModel,
      ),
    );
    return;
  }

  if (route === "source") {
    sourceGeneratedRequestCount += 1;
    if (body.model !== sourceModel) {
      throw new Error("source channel received the wrong model");
    }
    if (sourceGeneratedRequestCount === 1) {
      writeEvents(
        response,
        buildReasoningTextEvents(
          sourceMarker,
          "resp_source_reasoning",
          encryptedReasoning,
        ),
      );
      return;
    }
    if (sourceGeneratedRequestCount === 2) {
      if (!JSON.stringify(body).includes(encryptedReasoning)) {
        throw new Error(
          "source compaction did not receive the encrypted reasoning item",
        );
      }
      if (deepSeekToLuna && !JSON.stringify(body).includes(sourceReasoningText)) {
        throw new Error("source compaction did not receive its plaintext reasoning");
      }
      const metadata = turnMetadata(body);
      if (
        metadata.request_kind !== "compaction" ||
        !isRecord(metadata.compaction) ||
        metadata.compaction.trigger !== "manual" ||
        metadata.compaction.reason !== "user_requested" ||
        metadata.compaction.phase !== "standalone_turn"
      ) {
        throw new Error("source compaction metadata was not native manual mode");
      }
      // Keep the actual upstream response pending until app-server emits the
      // start notification. Checking only thread/read after completion cannot
      // establish that clients can show progress while compaction is running.
      const startDeadline = Date.now() + 5_000;
      while (!compactionNotifications["item/started"]) {
        if (Date.now() >= startDeadline) {
          throw new Error("native compaction start was not streamed while the upstream response was pending");
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      compactionResponseReleased = true;
      writeEvents(
        response,
        buildResponsesTextEvents(
          compactedContext,
          "resp_source_compaction",
        ),
      );
      return;
    }
    throw new Error("source channel received an unexpected extra request");
  }

  targetGeneratedRequestCount += 1;
  if (body.model !== targetModel) {
    throw new Error("target channel received the wrong model");
  }
  if (JSON.stringify(body).includes(encryptedReasoning)) {
    throw new Error("target channel received provider-encrypted reasoning");
  }
  if (JSON.stringify(body).includes(sourceReasoningText)) {
    throw new Error("target channel received provider-private plaintext reasoning");
  }
  if (!JSON.stringify(body).includes(compactedContext)) {
    throw new Error("target channel did not receive the compacted context");
  }
  if (targetGeneratedRequestCount !== 1) {
    throw new Error("target channel received an unexpected extra request");
  }
  writeEvents(
    response,
    buildResponsesTextEvents(
      targetMarker,
      "resp_target_after_switch",
      targetModel,
    ),
  );
}

function routeFor(url: string | undefined): "source" | "target" {
  if (url === "/source/v1/responses") return "source";
  if (url === "/target/v1/responses") return "target";
  throw new Error(`unexpected upstream path: ${url ?? "<missing>"}`);
}

function turnMetadata(body: JsonObject): JsonObject {
  const clientMetadata = body.client_metadata;
  if (!isRecord(clientMetadata)) {
    throw new Error("compaction request omitted client metadata");
  }
  const serialized = clientMetadata["x-codex-turn-metadata"];
  if (typeof serialized !== "string") {
    throw new Error("compaction request omitted Codex turn metadata");
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!isRecord(parsed)) {
    throw new Error("Codex turn metadata was not an object");
  }
  return parsed;
}

function buildReasoningTextEvents(
  text: string,
  responseId: string,
  encryptedContent: string,
): ResponseStreamEvent[] {
  const reasoning = {
    id: "rs_source_reasoning",
    type: "reasoning",
    summary: [],
    encrypted_content: encryptedContent,
    ...(deepSeekToLuna
      ? { content: [{ type: "reasoning_text", text: sourceReasoningText }] }
      : {}),
  };
  const textEvents = buildResponsesTextEvents(text, responseId);
  const created = textEvents.shift();
  const completed = textEvents.pop();
  if (!created || !completed) {
    throw new Error("failed to build source response stream");
  }
  let sequence = 1;
  const resequence = (event: ResponseStreamEvent): ResponseStreamEvent => ({
    event: event.event,
    data: { ...event.data, sequence_number: sequence++ },
  });
  const body = completed.data.response;
  if (!isRecord(body) || !Array.isArray(body.output)) {
    throw new Error("failed to build source response completion");
  }
  return [
    {
      event: created.event,
      data: { ...created.data, sequence_number: 0 },
    },
    {
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: 0,
        sequence_number: sequence++,
        item: { id: reasoning.id, type: reasoning.type, summary: [] },
      },
    },
    {
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: sequence++,
        item: reasoning,
      },
    },
    ...textEvents.map((event) => {
      const outputIndex =
        typeof event.data.output_index === "number"
          ? event.data.output_index + 1
          : event.data.output_index;
      return resequence({
        event: event.event,
        data: {
          ...event.data,
          ...(outputIndex === undefined ? {} : { output_index: outputIndex }),
        },
      });
    }),
    {
      event: completed.event,
      data: {
        ...completed.data,
        sequence_number: sequence++,
        response: {
          ...body,
          output: [reasoning, ...body.output],
        },
      },
    },
  ];
}

function buildResponsesTextEvents(
  text: string,
  responseId: string,
  responseModel = sourceModel,
): ResponseStreamEvent[] {
  const messageId = `msg_${responseId}`;
  let sequence = 0;
  const inProgress = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status: "in_progress",
    model: responseModel,
    output: [],
  };
  const content = { type: "output_text", text, annotations: [] };
  const item = {
    id: messageId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [content],
  };
  return [
    {
      event: "response.created",
      data: {
        type: "response.created",
        sequence_number: sequence++,
        response: inProgress,
      },
    },
    {
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: 0,
        sequence_number: sequence++,
        item: {
          id: messageId,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      },
    },
    {
      event: "response.content_part.added",
      data: {
        type: "response.content_part.added",
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        sequence_number: sequence++,
        part: { type: "output_text", text: "", annotations: [] },
      },
    },
    {
      event: "response.output_text.delta",
      data: {
        type: "response.output_text.delta",
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        sequence_number: sequence++,
        delta: text,
      },
    },
    {
      event: "response.output_text.done",
      data: {
        type: "response.output_text.done",
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        sequence_number: sequence++,
        text,
      },
    },
    {
      event: "response.content_part.done",
      data: {
        type: "response.content_part.done",
        item_id: messageId,
        output_index: 0,
        content_index: 0,
        sequence_number: sequence++,
        part: content,
      },
    },
    {
      event: "response.output_item.done",
      data: {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: sequence++,
        item,
      },
    },
    {
      event: "response.completed",
      data: {
        type: "response.completed",
        sequence_number: sequence++,
        response: {
          ...inProgress,
          status: "completed",
          output: [item],
          output_text: text,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    },
  ];
}

function writeEvents(
  response: ServerResponse,
  events: ResponseStreamEvent[],
): void {
  for (const event of events) {
    response.write(
      `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`,
    );
  }
  response.end();
}

async function waitForCompactionTurn(
  client: CodexJsonRpcClient,
  threadId: string,
  baselineTurnIds: ReadonlySet<string>,
): Promise<CodexTurn> {
  const deadline = Date.now() + 60_000;
  do {
    const response = await client.request<{ thread: CodexThread }>(
      "thread/read",
      { threadId, includeTurns: true },
    );
    const newTurns = (response.thread.turns ?? []).filter(
      (turn) => !baselineTurnIds.has(turn.id),
    );
    const compactTurn = newTurns.find((turn) =>
      turn.items.some((item) => item.type === "contextCompaction"),
    );
    if (compactTurn && compactTurn.status !== "inProgress") {
      if (compactTurn.status !== "completed") {
        throw new Error(
          `native compaction ended with status ${compactTurn.status}`,
        );
      }
      return compactTurn;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error("timed out waiting for native model-switch compaction");
}

function collectCompletedTurns(client: CodexJsonRpcClient): {
  wait(turnId: string): Promise<CodexTurn>;
} {
  const completed = new Map<string, CodexTurn>();
  const waiters = new Map<string, (turn: CodexTurn) => void>();
  client.on("notification", (notification: JsonRpcNotification) => {
    if (notification.method !== "turn/completed") return;
    const turn = (notification.params as { turn?: CodexTurn } | undefined)
      ?.turn;
    if (!turn?.id) return;
    const waiter = waiters.get(turn.id);
    if (waiter) {
      waiters.delete(turn.id);
      waiter(turn);
    } else {
      completed.set(turn.id, turn);
    }
  });
  return {
    wait(turnId) {
      const existing = completed.get(turnId);
      if (existing) return Promise.resolve(existing);
      return new Promise<CodexTurn>((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(turnId);
          reject(new Error(`timed out waiting for Codex turn ${turnId}`));
        }, 60_000);
        timeout.unref();
        waiters.set(turnId, (turn) => {
          clearTimeout(timeout);
          resolve(turn);
        });
      });
    },
  };
}

function agentText(turn: CodexTurn): string {
  return turn.items
    .filter(
      (
        item,
      ): item is Extract<
        (typeof turn.items)[number],
        { type: "agentMessage" }
      > => item.type === "agentMessage",
    )
    .map((item) => item.text)
    .join("\n");
}

function requiredTurn(thread: CodexThread, turnId: string): CodexTurn {
  const turn = thread.turns?.find((candidate) => candidate.id === turnId);
  if (!turn) throw new Error(`Codex thread is missing turn ${turnId}`);
  return turn;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) {
    throw new Error("smoke request was not a JSON object");
  }
  return parsed;
}

function zeroPricing() {
  return {
    input_price_per_million: "0",
    cached_input_price_per_million: "0",
    output_price_per_million: "0",
  };
}

async function codexVersion(): Promise<string> {
  const { stdout } = await execFileAsync(
    process.env.CODEX_BIN?.trim() || "codex",
    ["--version"],
  );
  return stdout.trim();
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
