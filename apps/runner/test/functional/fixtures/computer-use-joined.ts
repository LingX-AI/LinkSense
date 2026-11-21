import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { desktopRuntimeOutputSchema, runnerNativeIdSchema } from "@linksense/shared";
import pino from "pino";
import type { z } from "zod";

import { DesktopWorkerProvider } from "../../../src/controller/desktop-worker-provider.js";
import { DesktopLink } from "../../../src/desktop/link.js";
import { DesktopTurns, type DesktopRuntimeRun } from "../../../src/desktop/turns.js";
import {
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
} from "../../../src/mcp/core-services/computer-use-service.js";
import { createCoreMcpRegistry } from "../../../src/mcp/core-service-registry.js";
import { desktopComputerUseExecutor } from "./desktop-computer-use-executor.js";
import { computerFixtureEnvironment } from "./fixture-environment.js";

const logger = pino({ enabled: false });
type RuntimeOutput = z.infer<typeof desktopRuntimeOutputSchema>;

/**
 * The joined fixture's runtime half. A real DesktopLink writes the exact
 * production `link.frame` output into the child Go bridge; the child's
 * runtime-pipe output is fed back through `link.receive`. Only the executor is
 * synthetic: the same production computer.use adapter that maps MCP tools onto
 * `link.requestTool`.
 */
export async function createJoinedDesktopLink(input: {
  linkId: string;
  ownerId: string;
  scope: { owner_id: string; conversation_id: string; runtime_generation: string; turn_id: string };
  write: (output: RuntimeOutput) => Promise<void>;
}): Promise<{
  link: DesktopLink;
  runFor(token: string): { run: DesktopRuntimeRun; executor: ComputerUseExecutor };
  failures: Error[];
  close(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-joined-"));
  const failures: Error[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const provider = new DesktopWorkerProvider({
    dataRoot: path.join(root, "sessions"), runtimeRoot: root, controlToken: "a".repeat(64),
  }, logger);
  const turns = new DesktopTurns(provider, root, "http://127.0.0.1:9", () => undefined, logger, ["computer.execute"]);
  const link = new DesktopLink(input.linkId, input.ownerId, turns, input.write, () => {
    failures.push(new Error("desktop link write failed"));
  }, ["computer.execute"]);
  return {
    link,
    failures,
    runFor(token: string) {
      const timer = setTimeout(() => undefined, 60_000);
      timer.unref();
      timers.add(timer);
      const run: DesktopRuntimeRun = {
        scope: input.scope, token, expiresAt: Date.now() + 60_000, timer,
      };
      return { run, executor: desktopComputerUseExecutor(link, run) };
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await link.close().catch((error: unknown) => { failures.push(asError(error)); });
      await provider.shutdown().catch((error: unknown) => { failures.push(asError(error)); });
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * One in-process, loopback, official-SDK MCP endpoint for the joined proof.
 * Codex connects to it through `mcp_servers.<name>.url`; there is no bespoke
 * IPC between Codex and the runner beyond the real `link.frame` Go seam.
 */
export async function startComputerUseMcpFixture(input: {
  executor: ComputerUseExecutor;
  target: { bundleId: string };
  mode?: "default" | "plan";
}): Promise<{ url: string; close(): Promise<void> }> {
  const mode = input.mode ?? "default";
  const registry = createCoreMcpRegistry({
    mode,
    environment: computerFixtureEnvironment(mode),
    workspaceRoot: process.cwd(),
    extraModules: [createComputerUseCoreMcpModule({ mode, target: input.target, executor: input.executor })],
  });
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32_000, message: "Method not allowed" }, id: null }));
      return;
    }
    const body = await readJson(request);
    const mcp = new McpServer(
      { name: "computer_fixture", version: "1.0.0" },
      { capabilities: { tools: {} }, ...(registry.instructions ? { instructions: registry.instructions } : {}) },
    );
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...registry.tools] }));
    mcp.setRequestHandler(CallToolRequestSchema, async (call, extra) => {
      const nativeCallId = runnerNativeIdSchema.safeParse(call.params._meta?.callId);
      return registry.callTool({
        toolName: call.params.name,
        argumentsValue: call.params.arguments,
        ...(nativeCallId.success ? { nativeCallId: nativeCallId.data } : {}),
        signal: extra.signal,
      });
    });
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await mcp.connect(attemptTransport(transport));
      await transport.handleRequest(request, response, body);
    } finally {
      response.once("close", () => void mcp.close());
    }
  });
  await listen(server);
  return { url: `http://127.0.0.1:${port(server)}/mcp`, close: () => closeServer(server) };
}

export type ResponsesScript = (
  body: Record<string, unknown>, step: number,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** Same loopback Responses stream as the pinned computer-use functional fixture. */
export async function startResponsesFixture(script: ResponsesScript): Promise<{
  url: string;
  captures: Array<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  const captures: Array<Record<string, unknown>> = [];
  let step = 0;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw) as Record<string, unknown>;
    captures.push(body);
    step += 1;
    const item = await script(body, step);
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (type: string, value: object) =>
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    const id = `resp_${step}`;
    emit("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", {
      response: {
        id, object: "response", status: "completed", output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    });
    response.end();
  });
  await listen(server);
  return { url: `http://127.0.0.1:${port(server)}/v1`, captures, close: () => closeServer(server) };
}

export function message(text: string): Record<string, unknown> {
  return {
    id: "msg_fixture", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

export function functionCall(
  namespace: string, name: string, argumentsValue: unknown, callId: string,
): Record<string, unknown> {
  return {
    id: `fc_${callId}`, type: "function_call", call_id: callId,
    namespace, name, arguments: JSON.stringify(argumentsValue),
  };
}

export function toolCall(
  body: Record<string, unknown>, name: string, argumentsValue: unknown, callId: string,
): Record<string, unknown> | undefined {
  const namespace = namespaceFor(body, name);
  return namespace ? functionCall(namespace, name, argumentsValue, callId) : undefined;
}

export function noArgumentSchema(body: Record<string, unknown>, toolName: string): boolean {
  for (const candidate of tools(body)) {
    if (candidate.type !== "namespace") continue;
    const tool = candidate.tools?.find(entry => entry.name === toolName);
    if (!tool) continue;
    const parameters = tool.parameters;
    return parameters?.type === "object" && parameters.additionalProperties === false &&
      Object.keys((parameters.properties as Record<string, unknown> | undefined) ?? {}).length === 0;
  }
  return false;
}

export function namespaceFor(body: Record<string, unknown>, toolName: string): string | undefined {
  for (const candidate of tools(body)) {
    if (candidate.type === "namespace" && candidate.name &&
      candidate.tools?.some(tool => tool.name === toolName)) return candidate.name;
  }
  return undefined;
}

export type ToolResult = {
  ok?: boolean;
  effect?: string;
  observation_id?: string;
  nodes?: Array<{ name?: string; ref?: string; role?: string }>;
  [key: string]: unknown;
};

export function output(body: Record<string, unknown>, callId: string): ToolResult | undefined {
  for (const candidate of inputs(body)) {
    if (candidate.type !== "function_call_output" || candidate.call_id !== callId) continue;
    for (const part of candidate.output ?? []) {
      if (part.type !== "input_text" || typeof part.text !== "string") continue;
      try {
        return JSON.parse(part.text) as ToolResult;
      } catch {
        // Codex adds a "Wall time..." text part before the MCP content.
      }
    }
  }
  return undefined;
}

export function toolOutputText(body: Record<string, unknown>): string[] {
  return inputs(body).flatMap(item =>
    (item.output ?? []).flatMap(part =>
      part.type === "input_text" && typeof part.text === "string" ? [part.text] : []));
}

type ToolDescriptor = {
  type?: string;
  name?: string;
  tools?: Array<{ name?: string; parameters?: Record<string, unknown> }>;
};
type OutputPart = { type?: string; text?: string };
type InputItem = { type?: string; call_id?: string; output?: OutputPart[] };

function tools(body: Record<string, unknown>): ToolDescriptor[] {
  return Array.isArray(body.tools) ? body.tools as ToolDescriptor[] : [];
}

function inputs(body: Record<string, unknown>): InputItem[] {
  return Array.isArray(body.input) ? body.input as InputItem[] : [];
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  return JSON.parse(raw) as unknown;
}

/** Stable adapter used by the existing MCP HTTP fixtures in this repository. */
function attemptTransport(transport: StreamableHTTPServerTransport): Transport {
  const adapted: Transport = {
    start: async () => {
      transport.onclose = () => adapted.onclose?.();
      transport.onerror = error => adapted.onerror?.(error);
      transport.onmessage = message => adapted.onmessage?.(message);
      await transport.start();
    },
    send: (message, options) => transport.send(
      message,
      options?.relatedRequestId === undefined ? undefined : { relatedRequestId: options.relatedRequestId },
    ),
    close: () => transport.close(),
  };
  return adapted;
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function port(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a loopback port");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
