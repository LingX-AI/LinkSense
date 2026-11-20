import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import type {
  PrivacyMaskingRuntime,
  RunnerMemoryUsageCapture,
  RunnerPrivacyMaskingCapture,
} from "@linksense/shared";

import { ModelGateway } from "../src/model-gateway/model-gateway.js";
import { parseSseStream } from "../src/model-gateway/sse.js";

type JsonObject = Record<string, unknown>;

const closers: Array<() => Promise<void>> = [];
const secret = `sk-proj-${"q".repeat(32)}`;
const placeholderKey = "d".repeat(64);

const masking: PrivacyMaskingRuntime = {
  revision: 1,
  secrets: true,
  personal: false,
  kinds: {},
  words: [],
  words_any_case: true,
  words_whole: true,
  actions: {},
  allow: [],
  placeholder_key: placeholderKey,
};

const leaseMetering = {
  ownerId: "10000000-0000-4000-8000-000000000001",
  pricing: {
    input_price_per_million: "1",
    cached_input_price_per_million: "0.1",
    output_price_per_million: "8",
  },
} as const;

afterEach(async () => {
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

async function startGateway(
  options: {
    fetch?: typeof fetch;
    onMemoryUsage?: (capture: RunnerMemoryUsageCapture) => Promise<void>;
    onPrivacyMasking?: (
      capture: RunnerPrivacyMaskingCapture,
    ) => Promise<void>;
  } = {},
): Promise<ModelGateway> {
  const gateway = new ModelGateway({
    logger: pino({ enabled: false }),
    ...options,
  });
  await gateway.start();
  closers.push(() => gateway.close());
  return gateway;
}

async function startUpstream(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
): Promise<{ baseUrl: string }> {
  const server: Server = createServer((request, response) => {
    void handler(request, response).catch(() => {
      if (!response.headersSent) writeJson(response, 500, { error: "test" });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test upstream has no address");
  }
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function requestGateway(
  gateway: ModelGateway,
  token: string,
  body: JsonObject,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${gateway.baseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isObject(parsed)) throw new Error("request is not an object");
  return parsed;
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: JsonObject,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function writeSse(
  response: ServerResponse,
  event: string,
  body: JsonObject,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readSse(
  response: Response,
): Promise<Array<{ event: string; data: JsonObject }>> {
  if (!response.body) throw new Error("response has no body");
  const events: Array<{ event: string; data: JsonObject }> = [];
  for await (const event of parseSseStream(response.body)) {
    const data: unknown = JSON.parse(event.data);
    if (!isObject(data)) throw new Error("event data is not an object");
    events.push({ event: event.event ?? "message", data });
  }
  return events;
}

function placeholderIn(value: unknown): string | null {
  const match = JSON.stringify(value).match(
    /\{\{[A-Z][A-Z0-9_]*_[0-9a-f]{16,32}\}\}/u,
  );
  return match?.[0] ?? null;
}

describe("ModelGateway privacy masking", () => {
  it("masks a native Responses request and restores the whole JSON reply", async () => {
    const received: { body: JsonObject | null } = { body: null };
    const upstream = await startUpstream(async (request, response) => {
      received.body = await readJson(request);
      const placeholder = placeholderIn(received.body);
      writeJson(response, 200, {
        id: "resp-masked",
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: `The key is ${placeholder}` }],
          },
        ],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "native-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: `my key is ${secret}`,
      tools: [
        {
          type: "function",
          name: "lookup",
          description: `find ${secret}`,
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      ],
      prompt_cache_key: "cache-key",
      metadata: { label: secret },
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as JsonObject;
    const upstreamBody = received.body;
    if (!upstreamBody) throw new Error("upstream body missing");
    expect(JSON.stringify(payload)).toContain(secret);
    expect(JSON.stringify(upstreamBody)).not.toContain(secret);
    expect(JSON.stringify(upstreamBody)).toContain("{{API_KEY_");
    expect(upstreamBody).toMatchObject({
      model: "model-a",
      prompt_cache_key: "cache-key",
      tools: [
        {
          type: "function",
          name: "lookup",
          parameters: { type: "object" },
        },
      ],
    });
    const tools = upstreamBody?.tools as Array<JsonObject>;
    expect(String(tools[0]?.description)).not.toContain(secret);
    expect(JSON.stringify(upstreamBody?.metadata)).not.toContain(secret);
  });

  it("tells the model placeholders are put back before anything runs", async () => {
    const received: { body: JsonObject | null } = { body: null };
    const upstream = await startUpstream(async (request, response) => {
      received.body = await readJson(request);
      writeJson(response, 200, {
        id: "resp-noted",
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "noted-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `write ${secret} to the file` }],
        },
      ],
    });
    expect(response.status).toBe(200);
    await response.text();

    const input = received.body?.input as Array<JsonObject>;
    expect(input).toHaveLength(2);
    expect(input[0]?.role).toBe("user");
    expect(input[1]).toMatchObject({ type: "message", role: "developer" });
    expect(JSON.stringify(input[1])).toContain("placeholders for real values");
    expect(JSON.stringify(received.body)).not.toContain(secret);
  });

  it("tells a chat-completions model the same way", async () => {
    const received: { body: JsonObject | null } = { body: null };
    const upstream = await startUpstream(async (request, response) => {
      received.body = await readJson(request);
      writeJson(response, 200, {
        id: "completion-noted",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "noted-chat",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "chat_completions_bridge",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `write ${secret} to the file` }],
        },
      ],
      stream: false,
    });
    expect(response.status).toBe(200);
    await response.text();

    const messages = received.body?.messages as Array<JsonObject>;
    expect(messages).toHaveLength(1);
    expect(JSON.stringify(messages[0]?.content)).toContain(
      "placeholders for real values",
    );
    expect(JSON.stringify(messages[0]?.content)).not.toContain(secret);
  });

  it("reports one counts-only capture per masked request", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 200, {
        id: "resp-activity",
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const reports: RunnerPrivacyMaskingCapture[] = [];
    const gateway = await startGateway({
      onPrivacyMasking: async (capture) => {
        reports.push(capture);
      },
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "activity-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: `my key is ${secret}`,
    });
    expect(response.status).toBe(200);
    await response.text();

    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({
      owner_id: leaseMetering.ownerId,
      conversation_id: "activity-masking",
      model: "model-a",
      kinds: { API_KEY: 1 },
      masked_count: 1,
      hints: [{ kind: "API_KEY", length: secret.length, location: "prompt", count: 1 }],
    });
  });

  it("does not report a request where nothing was masked", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 200, {
        id: "resp-clean",
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const reports: RunnerPrivacyMaskingCapture[] = [];
    const gateway = await startGateway({
      onPrivacyMasking: async (capture) => {
        reports.push(capture);
      },
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "clean-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "a request with nothing sensitive",
    });
    expect(response.status).toBe(200);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports).toHaveLength(0);
  });

  it("restores a placeholder split between two native stream deltas", async () => {
    let placeholder = "";
    const upstream = await startUpstream(async (request, response) => {
      const body = await readJson(request);
      placeholder = placeholderIn(body) ?? "";
      const split = Math.max(6, Math.floor(placeholder.length / 2));
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeSse(response, "response.created", {
        type: "response.created",
        response: { id: "resp-split", status: "in_progress" },
      });
      writeSse(response, "response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: "item-1",
        delta: placeholder.slice(0, split),
      });
      writeSse(response, "response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: "item-1",
        delta: placeholder.slice(split),
      });
      writeSse(response, "response.completed", {
        type: "response.completed",
        response: { id: "resp-split", status: "completed", output: [] },
      });
      response.end();
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "stream-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: `my key is ${secret}`,
      stream: true,
    });
    const events = await readSse(response);
    const text = events
      .filter((event) => event.event === "response.output_text.delta")
      .map((event) => String(event.data.delta))
      .join("");
    expect(placeholder).not.toBe("");
    expect(text).toBe(secret);
  });

  it("masks the chat-completions bridge and restores its reply", async () => {
    let upstreamBody: JsonObject | null = null;
    const upstream = await startUpstream(async (request, response) => {
      upstreamBody = await readJson(request);
      const placeholder = placeholderIn(upstreamBody);
      writeJson(response, 200, {
        id: "completion-1",
        choices: [
          {
            message: { role: "assistant", content: `found ${placeholder}` },
            finish_reason: "stop",
          },
        ],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "chat-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "chat_completions_bridge",
      model: "model-a",
      privacyMasking: masking,
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `my key is ${secret}` }],
        },
      ],
      stream: false,
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(secret);
    expect(JSON.stringify(upstreamBody)).not.toContain(secret);
    expect(JSON.stringify(upstreamBody)).toContain("{{API_KEY_");
  });

  it("blocks a request with a kind set to block without calling upstream", async () => {
    const fetchUpstream = vi.fn<typeof fetch>();
    const gateway = new ModelGateway({
      logger: pino({ enabled: false }),
      fetch: fetchUpstream,
    });
    await gateway.start();
    closers.push(() => gateway.close());
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "block-masking",
      revision: 1,
      upstreamBaseUrl: "https://provider.example.test/v1",
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: { ...masking, actions: { API_KEY: "block" } },
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: `my key is ${secret}`,
    });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(secret);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it("restores memory extraction usage before recording it", async () => {
    let placeholder = "";
    const upstream = await startUpstream(async (request, response) => {
      placeholder = placeholderIn(await readJson(request)) ?? "";
      writeJson(response, 200, {
        id: "resp-memory-masked",
        object: "response",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 21,
          output_tokens: 7,
          total_tokens: 28,
        },
      });
    });
    const captures: RunnerMemoryUsageCapture[] = [];
    const gateway = await startGateway({
      onMemoryUsage: async (capture) => {
        captures.push(capture);
      },
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "memory-masking",
      revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });
    const response = await requestGateway(
      gateway,
      lease.token,
      {
        model: "model-a",
        input: `my key is ${secret}`,
        stream: false,
      },
      {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "memory",
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(placeholder).not.toBe("");
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({
      operation: "extract",
      measurement_method: "provider",
      token_usage: { total_tokens: 28, input_tokens: 21, output_tokens: 7 },
    });
    expect(JSON.stringify(captures)).not.toContain(secret);
  });

  it("rejects a Responses WebSocket while masking is enabled", async () => {
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "ws-masking",
      revision: 1,
      upstreamBaseUrl: "https://provider.example.test/v1",
      apiKey: "provider-key",
      protocolMode: "native_responses",
      model: "model-a",
      privacyMasking: masking,
    });
    const socket = new WebSocket(
      `${gateway.baseUrl.replace(/^http/u, "ws")}/responses`,
      { headers: { authorization: `Bearer ${lease.token}` } },
    );
    const status = await new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      });
      socket.once("error", reject);
    });
    expect(status).toBe(426);
    socket.terminate();
  });
});
