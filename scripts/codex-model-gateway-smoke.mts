import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ModelProviderProtocolMode } from "@linksense/shared";
import WebSocket, { WebSocketServer, type RawData } from "ws";

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

const modes: ModelProviderProtocolMode[] = [
  "native_responses",
  "responses_tool_compat",
  "chat_completions_bridge",
];
const execFileAsync = promisify(execFile);
const model = "gpt-5.3-codex";
const forceWebSocketFallback =
  process.env.LINKSENSE_SMOKE_FORCE_WS_FALLBACK === "true";
const codexVersionOutput = await codexVersion();
const actualCodexVersion = codexVersionOutput.match(
  /\bcodex-cli\s+(\d+\.\d+\.\d+)\b/u,
)?.[1];
if (actualCodexVersion !== CODEX_SCHEMA_VERSION) {
  throw new Error(
    `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${actualCodexVersion ?? "unknown"}`,
  );
}
const root = await mkdtemp(
  path.join(tmpdir(), "linksense-model-gateway-smoke-"),
);
const logger = {
  warn: () => undefined,
  error: () => undefined,
} as never;
const requests: Array<{
  mode: ModelProviderProtocolMode;
  path: string;
  body: JsonObject;
  transport: "http" | "websocket";
}> = [];
let activeMode: ModelProviderProtocolMode = "native_responses";
const webSocketUpgradeAttempts: ModelProviderProtocolMode[] = [];

const upstream = createServer((request, response) => {
  void handleUpstream(request, response).catch(() => {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"smoke upstream failed"}');
    } else {
      response.destroy();
    }
  });
});
const upstreamWebSocketServer = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  perMessageDeflate: false,
});
upstream.on("upgrade", (request, socket, head) => {
  webSocketUpgradeAttempts.push(activeMode);
  if (
    request.url !== "/v1/responses" ||
    request.headers.authorization !== "Bearer smoke-upstream-key"
  ) {
    socket.end(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  if (forceWebSocketFallback && activeMode === "native_responses") {
    socket.end(
      "HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nUpgrade: websocket\r\nContent-Length: 0\r\n\r\n",
    );
    return;
  }
  const mode = activeMode;
  upstreamWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.on("message", (data, isBinary) => {
      void handleUpstreamWebSocketMessage(
        webSocket,
        mode,
        data,
        isBinary,
      ).catch(() => webSocket.terminate());
    });
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
const upstreamBaseUrl = `http://127.0.0.1:${upstreamAddress.port}/v1`;
const gateway = new ModelGateway({ logger });
await gateway.start();

try {
  const results: Array<{
    mode: ModelProviderProtocolMode;
    threadId: string;
    turnId: string;
    answer: string;
  }> = [];
  for (const [index, mode] of modes.entries()) {
    activeMode = mode;
    const marker = `LINKSENSE_GATEWAY_${mode.toUpperCase()}_OK`;
    const requiresTool = mode !== "native_responses";
    const modeRoot = path.join(root, String(index));
    const userHome = path.join(modeRoot, "home");
    const codexHome = path.join(userHome, ".codex");
    const workspace = path.join(userHome, "workspace");
    await Promise.all([
      mkdir(codexHome, { recursive: true }),
      mkdir(workspace, { recursive: true }),
    ]);
    await writeFile(
      path.join(codexHome, "config.toml"),
      [
        // The hosting application selects the provider explicitly for every
        // thread. Keep the top-level selector absent so this smoke test fails
        // if thread/start ever falls back to Codex's built-in OpenAI provider.
        `model = ${JSON.stringify(model)}`,
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
        'name = "LinkSense Gateway Smoke"',
        `base_url = ${JSON.stringify(gateway.baseUrl)}`,
        'wire_api = "responses"',
        `env_key = ${JSON.stringify(modelGatewayEnvironmentKey)}`,
        `supports_websockets = ${mode !== "chat_completions_bridge"}`,
        "stream_max_retries = 2",
        "websocket_connect_timeout_ms = 12000",
        "requires_openai_auth = false",
        "",
      ].join("\n"),
    );
    const lease = gateway.issueLease({
      conversationId: `gateway-smoke-${index}`,
      ownerId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      revision: index + 1,
      upstreamBaseUrl,
      apiKey: "smoke-upstream-key",
      protocolMode: mode,
      model,
      pricing: {
        input_price_per_million: "0",
        cached_input_price_per_million: "0",
        output_price_per_million: "0",
      },
    });
    const client = new CodexJsonRpcClient({
      command: process.env.CODEX_BIN?.trim() || "codex",
      userHome,
      codexHome,
      logger,
      requestTimeoutMs: 60_000,
      extraEnvironment: {
        [modelGatewayEnvironmentKey]: lease.token,
      },
    });
    try {
      const completedTurns = collectCompletedTurns(client);
      await client.initialize();
      const started = await client.request<{ thread: CodexThread }>(
        "thread/start",
        {
          model,
          modelProvider: "link-sense",
          cwd: workspace,
          runtimeWorkspaceRoots: [workspace],
          approvalPolicy: "never",
          sandbox: "danger-full-access",
          ephemeral: false,
        },
      );
      const turn = await client.request<{ turn: CodexTurn }>("turn/start", {
        threadId: started.thread.id,
        model,
        clientUserMessageId: `01900000-0000-7000-8000-${String(
          index + 1,
        ).padStart(12, "0")}`,
        input: [
          {
            type: "text",
            text: requiresTool
              ? `Create gateway-tool.txt with the model gateway tool, then reply with exactly ${marker}.`
              : `Reply with exactly ${marker}. Do not call tools.`,
            text_elements: [],
          },
        ],
        cwd: workspace,
        runtimeWorkspaceRoots: [workspace],
        approvalPolicy: "never",
        sandboxPolicy: { type: "dangerFullAccess" },
      });
      const completed = await completedTurns.wait(turn.turn.id);
      if (completed.status !== "completed") {
        throw new Error(`${mode} turn did not complete`);
      }
      const read = await client.request<{ thread: CodexThread }>(
        "thread/read",
        { threadId: started.thread.id, includeTurns: true },
      );
      const answer = agentText(requiredTurn(read.thread, turn.turn.id)).trim();
      if (answer !== marker) {
        throw new Error(
          `${mode} returned an unexpected answer: ${JSON.stringify(answer)}`,
        );
      }
      if (requiresTool) {
        const toolOutput = await readFile(
          path.join(workspace, "gateway-tool.txt"),
          "utf8",
        ).catch((error: unknown) => {
          const modeRequests = requests
            .filter((entry) => entry.mode === mode)
            .map((entry) => summarizeUpstreamRequest(entry));
          const turnItems = requiredTurn(read.thread, turn.turn.id).items.map(
            (item) => summarizeValue(item),
          );
          throw new Error(
            `${mode} did not create gateway-tool.txt: ${
              error instanceof Error ? error.message : "unknown"
            }; requests=${JSON.stringify(
              modeRequests,
            )}; turnItems=${JSON.stringify(turnItems)}`,
          );
        });
        if (toolOutput !== `${mode}\n`) {
          throw new Error(`${mode} did not execute exec_command in Codex`);
        }
      }
      results.push({
        mode,
        threadId: started.thread.id,
        turnId: turn.turn.id,
        answer,
      });
    } finally {
      await client.close().catch(() => undefined);
      lease.release();
    }
  }

  assertUpstreamRequests(requests, webSocketUpgradeAttempts);
  console.log(
    JSON.stringify({
      status: "ok",
      codexVersion: codexVersionOutput,
      forcedWebSocketFallback: forceWebSocketFallback,
      modes: results,
      upstreamRequestCount: requests.length,
    }),
  );
} finally {
  await gateway.close().catch(() => undefined);
  await new Promise<void>((resolve) => {
    upstreamWebSocketServer.close(() => undefined);
    upstream.close(() => resolve());
    upstream.closeAllConnections();
  });
  await rm(root, { recursive: true, force: true });
}

async function handleUpstream(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.headers.authorization !== "Bearer smoke-upstream-key") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"error":"unauthorized"}');
    return;
  }
  const body = await readJson(request);
  requests.push({
    mode: activeMode,
    path: request.url ?? "",
    body,
    transport: "http",
  });
  const marker = `LINKSENSE_GATEWAY_${activeMode.toUpperCase()}_OK`;
  const modeRequestCount = requests.filter(
    (entry) => entry.mode === activeMode,
  ).length;
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
  });
  if (activeMode === "chat_completions_bridge") {
    if (modeRequestCount === 1) {
      const toolName = findChatExecCommandTool(body);
      response.write(
        `data: ${JSON.stringify({
          id: "chat-smoke-tool",
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_gateway_patch",
                    type: "function",
                    function: {
                      name: toolName,
                      arguments: JSON.stringify({
                        cmd: commandFor(activeMode),
                      }),
                    },
                  },
                ],
              },
            },
          ],
        })}\n\n`,
      );
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }
    response.write(
      `data: ${JSON.stringify({
        id: "chat-smoke",
        model,
        choices: [{ index: 0, delta: { content: marker } }],
      })}\n\n`,
    );
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }
  if (activeMode === "responses_tool_compat" && modeRequestCount === 1) {
    writeResponsesToolCallStream(
      response,
      findResponsesExecCommandTool(body),
      commandFor(activeMode),
    );
    return;
  }
  writeResponsesTextStream(response, marker);
}

async function handleUpstreamWebSocketMessage(
  webSocket: WebSocket,
  mode: ModelProviderProtocolMode,
  data: RawData,
  isBinary: boolean,
): Promise<void> {
  if (isBinary) throw new Error("smoke upstream received a binary frame");
  const body = parseJsonObject(data.toString());
  if (body.type !== "response.create") {
    throw new Error("smoke upstream received an unexpected websocket event");
  }
  requests.push({
    mode,
    path: "/v1/responses",
    body,
    transport: "websocket",
  });
  const modeRequests = requests.filter(
    (entry) => entry.mode === mode && entry.body.generate !== false,
  );
  let events: ResponseStreamEvent[];
  if (body.generate === false) {
    events = buildResponsesWarmupEvents(`resp_${mode}_warmup`);
  } else if (mode === "responses_tool_compat" && modeRequests.length === 1) {
    events = buildResponsesToolCallEvents(
      findResponsesExecCommandTool(body),
      commandFor(mode),
      `resp_${mode}_tool`,
    );
  } else {
    events = buildResponsesTextEvents(
      `LINKSENSE_GATEWAY_${mode.toUpperCase()}_OK`,
      `resp_${mode}_${modeRequests.length}`,
    );
  }
  for (const event of events) {
    await sendWebSocketJson(webSocket, event.data);
  }
}

function writeResponsesToolCallStream(
  response: ServerResponse,
  name: string,
  command: string,
): void {
  for (const event of buildResponsesToolCallEvents(
    name,
    command,
    "resp_gateway_tool_smoke",
  )) {
    writeSse(response, event.event, event.data);
  }
  response.end();
}

function buildResponsesWarmupEvents(responseId: string): ResponseStreamEvent[] {
  const inProgress = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status: "in_progress",
    model,
    output: [],
  };
  return [
    {
      event: "response.created",
      data: {
        type: "response.created",
        sequence_number: 0,
        response: inProgress,
      },
    },
    {
      event: "response.completed",
      data: {
        type: "response.completed",
        sequence_number: 1,
        response: {
          ...inProgress,
          status: "completed",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      },
    },
  ];
}

function buildResponsesToolCallEvents(
  name: string,
  command: string,
  responseId: string,
): ResponseStreamEvent[] {
  const itemId = "fc_gateway_tool_smoke";
  const callId = "call_gateway_patch";
  const args = JSON.stringify({ cmd: command });
  let sequence = 0;
  const item = {
    id: itemId,
    type: "function_call",
    status: "completed",
    call_id: callId,
    name,
    arguments: args,
  };
  return [
    {
      event: "response.created",
      data: {
        type: "response.created",
        sequence_number: sequence++,
        response: {
          id: responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1_000),
          status: "in_progress",
          model,
          output: [],
        },
      },
    },
    {
      event: "response.output_item.added",
      data: {
        type: "response.output_item.added",
        output_index: 0,
        sequence_number: sequence++,
        item: { ...item, status: "in_progress", arguments: "" },
      },
    },
    {
      event: "response.function_call_arguments.delta",
      data: {
        type: "response.function_call_arguments.delta",
        item_id: itemId,
        output_index: 0,
        sequence_number: sequence++,
        delta: args,
      },
    },
    {
      event: "response.function_call_arguments.done",
      data: {
        type: "response.function_call_arguments.done",
        item_id: itemId,
        output_index: 0,
        sequence_number: sequence++,
        arguments: args,
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
          id: responseId,
          object: "response",
          created_at: Math.floor(Date.now() / 1_000),
          status: "completed",
          model,
          output: [item],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      },
    },
  ];
}

function writeResponsesTextStream(
  response: ServerResponse,
  text: string,
): void {
  for (const event of buildResponsesTextEvents(text, "resp_gateway_smoke")) {
    writeSse(response, event.event, event.data);
  }
  response.end();
}

function buildResponsesTextEvents(
  text: string,
  responseId: string,
): ResponseStreamEvent[] {
  const messageId = "msg_gateway_smoke";
  let sequence = 0;
  const inProgress = {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1_000),
    status: "in_progress",
    model,
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
      event: "response.in_progress",
      data: {
        type: "response.in_progress",
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

function assertUpstreamRequests(
  received: Array<{
    mode: ModelProviderProtocolMode;
    path: string;
    body: JsonObject;
    transport: "http" | "websocket";
  }>,
  upgradeAttempts: readonly ModelProviderProtocolMode[],
): void {
  for (const mode of [
    "native_responses",
    "responses_tool_compat",
  ] as const) {
    if (!upgradeAttempts.includes(mode)) {
      throw new Error(`${mode} did not attempt a websocket upgrade`);
    }
  }
  if (upgradeAttempts.includes("chat_completions_bridge")) {
    throw new Error("chat mode unexpectedly attempted a websocket upgrade");
  }
  const generated = received.filter((entry) => entry.body.generate !== false);
  if (generated.length !== 5) {
    throw new Error(
      `expected five generated upstream requests, got ${generated.length}`,
    );
  }
  for (const entry of received) {
    if (entry.mode === "chat_completions_bridge") {
      if (entry.path !== "/v1/chat/completions") {
        throw new Error("chat mode did not use /chat/completions");
      }
      if (!Array.isArray(entry.body.messages)) {
        throw new Error("chat mode did not translate Responses messages");
      }
      if (entry.transport !== "http") {
        throw new Error("chat mode unexpectedly used websocket upstream");
      }
      continue;
    }
    if (entry.path !== "/v1/responses") {
      throw new Error(`${entry.mode} did not use /responses`);
    }
    if (entry.mode === "responses_tool_compat") {
      const input = Array.isArray(entry.body.input) ? entry.body.input : [];
      if (
        input.some((item) => isRecord(item) && item.type === "additional_tools")
      ) {
        throw new Error("compat mode did not lift additional_tools");
      }
      const tools = Array.isArray(entry.body.tools) ? entry.body.tools : [];
      if (
        tools.some(
          (tool) =>
            isRecord(tool) &&
            ["namespace", "custom", "tool_search"].includes(String(tool.type)),
        )
      ) {
        throw new Error("compat mode left a non-function Codex tool");
      }
    }
    const expectedTransport =
      forceWebSocketFallback && entry.mode === "native_responses"
        ? "http"
        : "websocket";
    if (entry.transport !== expectedTransport) {
      throw new Error(
        `${entry.mode} used ${entry.transport} instead of ${expectedTransport}`,
      );
    }
  }
  for (const mode of modes) {
    const expected = mode === "native_responses" ? 1 : 2;
    const modeRequests = generated.filter((entry) => entry.mode === mode);
    if (modeRequests.length !== expected) {
      throw new Error(
        `${mode} made ${modeRequests.length} requests instead of ${expected}`,
      );
    }
    if (mode === "responses_tool_compat") {
      const secondInput = Array.isArray(modeRequests[1]?.body.input)
        ? modeRequests[1].body.input
        : [];
      if (
        !secondInput.some(
          (item) => isRecord(item) && item.type === "function_call_output",
        )
      ) {
        throw new Error(
          "compat mode did not return the Codex tool output upstream",
        );
      }
      if (typeof modeRequests[1]?.body.previous_response_id !== "string") {
        throw new Error(
          "compat websocket mode did not continue from previous_response_id",
        );
      }
    }
    if (mode === "chat_completions_bridge") {
      const secondMessages = Array.isArray(modeRequests[1]?.body.messages)
        ? modeRequests[1].body.messages
        : [];
      const hasAssistantToolCall = secondMessages.some(
        (message) =>
          isRecord(message) &&
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length > 0,
      );
      const hasToolOutput = secondMessages.some(
        (message) => isRecord(message) && message.role === "tool",
      );
      if (!hasAssistantToolCall || !hasToolOutput) {
        throw new Error(
          "chat mode did not return the assistant tool call and tool output upstream",
        );
      }
    }
  }
}

function findResponsesExecCommandTool(body: JsonObject): string {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const match = tools.find(
    (tool) =>
      isRecord(tool) &&
      tool.type === "function" &&
      tool.name === "exec_command",
  );
  if (!isRecord(match) || typeof match.name !== "string") {
    throw new Error("compat request did not expose exec_command as a function");
  }
  return match.name;
}

function findChatExecCommandTool(body: JsonObject): string {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const match = tools.find(
    (tool) =>
      isRecord(tool) &&
      isRecord(tool.function) &&
      tool.function.name === "exec_command",
  );
  if (
    !isRecord(match) ||
    !isRecord(match.function) ||
    typeof match.function.name !== "string"
  ) {
    throw new Error("chat request did not expose exec_command as a function");
  }
  return match.function.name;
}

function commandFor(mode: ModelProviderProtocolMode): string {
  return `printf '${mode}\\n' > gateway-tool.txt`;
}

function summarizeUpstreamRequest(entry: {
  path: string;
  body: JsonObject;
}): JsonObject {
  const input = Array.isArray(entry.body.input)
    ? entry.body.input.map((item) => summarizeResponseInput(item))
    : undefined;
  const messages = Array.isArray(entry.body.messages)
    ? entry.body.messages
        .filter(
          (message) =>
            isRecord(message) &&
            (message.role === "tool" || Array.isArray(message.tool_calls)),
        )
        .map((message) => summarizeValue(message))
    : undefined;
  const tools = Array.isArray(entry.body.tools)
    ? entry.body.tools.map((tool) => {
        if (!isRecord(tool)) return summarizeValue(tool);
        const definition = isRecord(tool.function) ? tool.function : tool;
        return {
          type: tool.type,
          name: definition.name,
        };
      })
    : undefined;
  return {
    path: entry.path,
    input,
    messages,
    tools,
  };
}

function summarizeResponseInput(value: unknown): unknown {
  if (!isRecord(value)) return summarizeValue(value);
  return Object.fromEntries(
    [
      "type",
      "role",
      "name",
      "namespace",
      "call_id",
      "status",
      "input",
      "output",
      "arguments",
    ].flatMap((key) =>
      value[key] === undefined ? [] : [[key, summarizeValue(value[key])]],
    ),
  );
}

function summarizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => summarizeValue(item));
  if (!isRecord(value)) {
    return typeof value === "string" && value.length > 800
      ? `${value.slice(0, 800)}…`
      : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["content", "instructions"].includes(key))
      .map(([key, item]) => [key, summarizeValue(item)]),
  );
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
  return parseJsonObject(Buffer.concat(chunks).toString("utf8"));
}

function parseJsonObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("smoke request was not a JSON object");
  return parsed;
}

function sendWebSocketJson(
  webSocket: WebSocket,
  value: JsonObject,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    webSocket.send(JSON.stringify(value), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function writeSse(
  response: ServerResponse,
  event: string,
  data: JsonObject,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
