import {
  createServer,
  request as requestHttp,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createConnection, type Socket } from "node:net";
import { Writable } from "node:stream";

import pino, { type Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import type { RunnerMemoryUsageCapture } from "@linksense/shared";

import { ModelGateway } from "../src/model-gateway/model-gateway.js";
import { parseSseStream } from "../src/model-gateway/sse.js";

type JsonObject = Record<string, unknown>;

const closers: Array<() => Promise<void>> = [];
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

describe("ModelGateway", () => {
  it("binds extraction WebSockets to the dedicated channel and rejects ordinary requests on that socket", async () => {
    const received: JsonObject[] = [];
    const captures: RunnerMemoryUsageCapture[] = [];
    const memoryUpstream = await startWebSocketUpstream({
      onConnection(socket, request) {
        expect(request.headers.authorization).toBe("Bearer memory-key");
        socket.on("message", (data) => {
          received.push(parseWebSocketJson(data.toString()));
          socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp-memory-ws", status: "completed", output: [], usage: { input_tokens: 20, output_tokens: 5 } } }));
        });
      },
    });
    const gateway = await startGateway({ onMemoryUsage: async (capture) => { captures.push(capture); } });
    const lease = gateway.issueLease({ ...leaseMetering, conversationId: "memory-ws", revision: 1, upstreamBaseUrl: "https://task.example/v1", apiKey: "task-key", protocolMode: "native_responses", model: "task-model",
      memoryExtraction: { model: "memory-model", reasoningEffort: "low", baseUrl: `${memoryUpstream.baseUrl}/v1`, apiKey: "memory-key", protocolMode: "native_responses", pricing: leaseMetering.pricing },
    });
    const metadata = { "x-codex-turn-metadata": '{"request_kind":"memory"}' };
    const downstream = await connectGatewayWebSocket(gateway, lease.token, metadata);
    const completion = nextWebSocketJson(downstream.socket);
    downstream.socket.send(JSON.stringify({ type: "response.create", model: "memory-model", input: "history", reasoning: { effort: "high" }, client_metadata: metadata }));
    await completion;
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(received).toEqual([expect.objectContaining({ model: "memory-model", reasoning: { effort: "low" } })]);
    expect(captures[0]).toMatchObject({ operation: "extract", model: "memory-model" });
    const denied = nextWebSocketJson(downstream.socket);
    downstream.socket.send(JSON.stringify({ type: "response.create", model: "memory-model", input: "ordinary" }));
    expect(await denied).toMatchObject({ type: "error", error: { code: "model_not_authorized" } });
    expect(received).toHaveLength(1);
    await closeWebSocket(downstream.socket);
  });

  it.each(["native_responses", "responses_tool_compat", "chat_completions_bridge"] as const)("routes only extraction to its configured %s channel with minimum reasoning and exact pricing", async (protocolMode) => {
    const received: Array<{ url: string; body: JsonObject; authorization: string | null }> = [];
    const captures: RunnerMemoryUsageCapture[] = [];
    const gateway = await startGateway({
      onMemoryUsage: async (capture) => { captures.push(capture); },
      fetch: async (url, init) => {
        received.push({ url: String(url), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
        return Response.json(protocolMode === "chat_completions_bridge" && String(url).includes("memory.example")
          ? { choices: [{ message: { content: '{"memory":"saved"}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }
          : { id: "resp-memory", status: "completed", output: [], usage: { input_tokens: 20, output_tokens: 5 } });
      },
    });
    const pricing = { input_price_per_million: "0.2", cached_input_price_per_million: "0.02", output_price_per_million: "0.5" };
    const lease = gateway.issueLease({ ...leaseMetering, conversationId: "memory-routing", revision: 1, upstreamBaseUrl: "https://task.example/v1", apiKey: "task-key", protocolMode: "native_responses", model: "task-model",
      memoryExtraction: { model: "memory-model", reasoningEffort: "minimal", baseUrl: "https://memory.example/v1", apiKey: "memory-key", protocolMode, pricing },
    });
    expect((await requestGateway(gateway, lease.token, { model: "memory-model", input: "history" })).status).toBe(403);
    const format = { type: "json_schema", name: "memory", strict: true, schema: { type: "object", properties: { memory: { type: "string" } }, required: ["memory"], additionalProperties: false } };
    const memoryResponse = await requestGateway(gateway, lease.token, { model: "memory-model", input: "history", reasoning: { effort: "high" }, text: { format } }, { "x-codex-turn-metadata": '{"request_kind":"memory"}' });
    expect(memoryResponse.status).toBe(200);
    await memoryResponse.text();
    expect(received[0]).toMatchObject({ url: `https://memory.example/v1/${protocolMode === "chat_completions_bridge" ? "chat/completions" : "responses"}`, authorization: "Bearer memory-key" });
    expect(received[0]?.body).toMatchObject(protocolMode === "chat_completions_bridge"
      ? { reasoning_effort: "minimal", response_format: { type: "json_schema", json_schema: { strict: true, schema: format.schema } } }
      : { reasoning: { effort: "minimal" }, text: { format } });
    expect(captures).toEqual([expect.objectContaining({ model: "memory-model", pricing, operation: "extract", owner_id: leaseMetering.ownerId })]);
    await requestGateway(gateway, lease.token, { model: "task-model", input: "answer", reasoning: { effort: "high" } });
    expect(received[1]).toMatchObject({ url: "https://task.example/v1/responses", authorization: "Bearer task-key", body: { reasoning: { effort: "high" } } });
    await requestGateway(gateway, lease.token, { model: "task-model", input: "consolidate", reasoning: { effort: "medium" } }, { "x-openai-subagent": "memory_consolidation" });
    expect(received[2]).toMatchObject({ url: "https://task.example/v1/responses", authorization: "Bearer task-key", body: { model: "task-model", reasoning: { effort: "medium" } } });
    expect(captures[1]).toMatchObject({ model: "task-model", pricing: leaseMetering.pricing, operation: "consolidate" });
  });

  it("lowers extraction effort when it uses the task model without changing ordinary requests", async () => {
    const received: JsonObject[] = [];
    const gateway = await startGateway({
      fetch: async (_url, init) => {
        received.push(JSON.parse(String(init?.body)));
        return Response.json({ id: "resp-same-model", status: "completed", output: [] });
      },
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "memory-fallback",
      revision: 1,
      upstreamBaseUrl: "https://task.example/v1",
      apiKey: "task-key",
      protocolMode: "native_responses",
      model: "task-model",
      memoryExtraction: {
        model: "task-model",
        reasoningEffort: "low",
        baseUrl: "https://task.example/v1",
        apiKey: "task-key",
        protocolMode: "native_responses",
        pricing: leaseMetering.pricing,
      },
    });
    const body = { model: "task-model", input: "history", reasoning: { effort: "high", summary: "auto" } };
    expect((await requestGateway(gateway, lease.token, body, { "x-codex-turn-metadata": '{"request_kind":"memory"}' })).status).toBe(200);
    expect((await requestGateway(gateway, lease.token, body)).status).toBe(200);
    expect(received).toEqual([
      { ...body, reasoning: { effort: "low", summary: "auto" } },
      body,
    ]);
  });

  it("records correlated first-text latency while forwarding native bytes unchanged", async () => {
    const { logger, logs } = createCapturingLogger();
    const bytes = 'data: {"type":"response.created"}\n\ndata: {"type":"response.output_text.delta","delta":"private answer"}\n\n';
    const gateway = await startGateway({ logger, fetch: async () => new Response(bytes, { headers: { "content-type": "text/event-stream" } }) });
    const lease = gateway.issueLease({ ...leaseMetering, conversationId: "latency-task", revision: 1, upstreamBaseUrl: "https://provider.example.test/v1", apiKey: "private-key", protocolMode: "native_responses", model: "model-a" });
    lease.setTurnCorrelation({ turnId: "latency-turn", codexTurnId: "native-turn", modelTransitionNonce: null });
    const response = await requestGateway(gateway, lease.token, { model: "model-a", input: "private question", stream: true });
    expect(await response.text()).toBe(bytes);
    const samples = logs.filter(log => log.msg === "model upstream latency");
    expect(samples.map(sample => sample.stage)).toEqual(["upstream_headers", "upstream_first_byte", "upstream_first_text", "upstream_end"]);
    expect(samples.every(sample => sample.turnId === "latency-turn" && sample.conversationId === "latency-task" && sample.upstreamStreaming === true)).toBe(true);
    expect(JSON.stringify(samples)).not.toContain("private");
  });
  it("forwards native Responses without exposing the upstream key", async () => {
    const received: Array<{
      path: string;
      authorization: string | undefined;
      body: JsonObject;
    }> = [];
    const upstream = await startUpstream(async (request, response) => {
      received.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body: await readJson(request),
      });
      writeJson(response, 200, {
        id: "resp-native",
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-native",
      revision: 3,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "native-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "hello",
      stream: false,
      tools: [{ type: "namespace", name: "unchanged" }],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "resp-native" });
    expect(received).toEqual([
      {
        path: "/v1/responses",
        authorization: "Bearer native-provider-secret",
        body: {
          model: "model-a",
          input: "hello",
          stream: false,
          tools: [{ type: "namespace", name: "unchanged" }],
        },
      },
    ]);

    lease.release();
    const revoked = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "hello",
    });
    expect(revoked.status).toBe(401);
    expect(await revoked.text()).not.toContain("native-provider-secret");
    expect(received).toHaveLength(1);
  });

  it("routes manual and automatic model-switch compaction to the exact source channel over HTTP", async () => {
    const primaryReceived: JsonObject[] = [];
    const sourceReceived: Array<{
      authorization: string | undefined;
      body: JsonObject;
    }> = [];
    const primaryUpstream = await startUpstream(async (request, response) => {
      primaryReceived.push(await readJson(request));
      writeJson(response, 200, {
        id: `resp-primary-${primaryReceived.length}`,
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const sourceUpstream = await startUpstream(async (request, response) => {
      sourceReceived.push({
        authorization: request.headers.authorization,
        body: await readJson(request),
      });
      writeJson(response, 200, {
        id: `resp-source-${sourceReceived.length}`,
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-model-transition-http",
      revision: 31,
      upstreamBaseUrl: `${primaryUpstream.baseUrl}/v1`,
      apiKey: "qwen-target-provider-secret",
      protocolMode: "native_responses",
      model: "model-c",
    });
    const nonce = "transition-nonce-http";
    const trustedMetadata = modelTransitionMetadata(nonce);
    const compactRequest = (model: string, metadata = trustedMetadata) => ({
      model,
      input: "compact prior context",
      stream: false,
      client_metadata: { "x-codex-turn-metadata": metadata },
    });
    lease.setModelTransition(
      {
        revision: 30,
        upstreamBaseUrl: `${sourceUpstream.baseUrl}/v1`,
        apiKey: "gpt-source-provider-secret",
        protocolMode: "native_responses",
        model: "model-a",
        pricing: leaseMetering.pricing,
      },
      nonce,
    );

    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a", manualModelTransitionMetadata()),
      )).status,
    ).toBe(403);
    lease.setManualModelTransitionCompaction(true);
    expect(
      (await requestGateway(gateway, lease.token, {
        model: "model-a",
        input: "ordinary old-model request",
      })).status,
    ).toBe(403);
    const manualMetadata = manualModelTransitionMetadata();
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a", manualMetadata),
        { "x-codex-turn-metadata": manualMetadata },
      )).status,
    ).toBe(200);
    lease.setManualModelTransitionCompaction(false);

    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a"),
      )).status,
    ).toBe(403);
    lease.setTurnCorrelation({
      turnId: "turn-transition-http",
      codexTurnId: null,
      modelTransitionNonce: nonce,
    });

    const rejectedMetadata = [
      "{",
      modelTransitionMetadata(nonce, { phase: "mid_turn" }),
      modelTransitionMetadata(nonce, { reason: "context_limit" }),
      modelTransitionMetadata("wrong-nonce"),
      modelTransitionMetadata(null),
    ];
    for (const metadata of rejectedMetadata) {
      expect(
        (await requestGateway(
          gateway,
          lease.token,
          compactRequest("model-a", metadata),
        )).status,
      ).toBe(403);
    }
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        { model: "model-a", input: "header-only metadata" },
        { "x-codex-turn-metadata": trustedMetadata },
      )).status,
    ).toBe(403);
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a"),
        {
          "x-codex-turn-metadata": modelTransitionMetadata(nonce, {
            reason: "model_downshift",
          }),
        },
      )).status,
    ).toBe(403);

    expect(
      (await requestGateway(gateway, lease.token, {
        model: "model-c",
        input: "primary model prewarm",
      })).status,
    ).toBe(200);
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a"),
        { "x-codex-turn-metadata": trustedMetadata },
      )).status,
    ).toBe(200);
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-b"),
      )).status,
    ).toBe(403);
    expect(primaryReceived.map((body) => body.model)).toEqual(["model-c"]);
    expect(sourceReceived).toEqual([
      {
        authorization: "Bearer gpt-source-provider-secret",
        body: expect.objectContaining({ model: "model-a" }),
      },
      {
        authorization: "Bearer gpt-source-provider-secret",
        body: expect.objectContaining({ model: "model-a" }),
      },
    ]);

    lease.setModelTransition(null, null);
    expect(
      (await requestGateway(
        gateway,
        lease.token,
        compactRequest("model-a"),
      )).status,
    ).toBe(403);
    expect(sourceReceived).toHaveLength(2);
  });

  it("bridges sequential native Responses over one WebSocket with provider credentials and safe response headers", async () => {
    const upstreamRequests: IncomingMessage[] = [];
    const upstreamMessages: JsonObject[] = [];
    let upstreamConnectionCount = 0;
    const upstream = await startWebSocketUpstream({
      responseHeaders: {
        "openai-model": "model-a",
        "x-codex-turn-state": "turn-state-1",
        "x-models-etag": "models-etag-1",
        "x-provider-private-secret": "must-not-be-forwarded",
        "x-reasoning-included": "true",
        "x-request-id": "provider-ws-request-1",
      },
      onConnection(socket, request) {
        upstreamConnectionCount += 1;
        upstreamRequests.push(request);
        socket.on("message", (data, isBinary) => {
          expect(isBinary).toBe(false);
          const message = parseWebSocketJson(data.toString());
          upstreamMessages.push(message);
          socket.send(
            JSON.stringify({
              type: "response.completed",
              response: {
                id: `resp-native-ws-${upstreamMessages.length}`,
                object: "response",
                status: "completed",
                output: [],
              },
            }),
          );
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-native-ws",
      revision: 13,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "native-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    const downstream = await connectGatewayWebSocket(gateway, lease.token);

    expect(upstreamConnectionCount).toBe(1);
    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]?.url).toBe("/v1/responses");
    expect(upstreamRequests[0]?.headers.authorization).toBe(
      "Bearer native-ws-provider-secret",
    );
    expect(upstreamRequests[0]?.headers.authorization).not.toBe(
      `Bearer ${lease.token}`,
    );
    expect(upstreamRequests[0]?.headers["openai-beta"]).toBe(
      "responses_websockets=2026-02-06",
    );
    expect(downstream.response.headers["openai-model"]).toBe("model-a");
    expect(downstream.response.headers["x-codex-turn-state"]).toBe(
      "turn-state-1",
    );
    expect(downstream.response.headers["x-models-etag"]).toBe("models-etag-1");
    expect(downstream.response.headers["x-reasoning-included"]).toBe("true");
    expect(downstream.response.headers["x-request-id"]).toBe(
      "provider-ws-request-1",
    );
    expect(
      downstream.response.headers["x-provider-private-secret"],
    ).toBeUndefined();

    const firstResponse = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "warm the connection",
        generate: false,
      }),
    );
    expect(await firstResponse).toMatchObject({
      type: "response.completed",
      response: { id: "resp-native-ws-1" },
    });

    const secondResponse = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "actual request",
        previous_response_id: "resp-native-ws-1",
      }),
    );
    expect(await secondResponse).toMatchObject({
      type: "response.completed",
      response: { id: "resp-native-ws-2" },
    });
    expect(upstreamConnectionCount).toBe(1);
    expect(upstreamMessages).toEqual([
      {
        type: "response.create",
        model: "model-a",
        input: "warm the connection",
        generate: false,
      },
      {
        type: "response.create",
        model: "model-a",
        input: "actual request",
        previous_response_id: "resp-native-ws-1",
      },
    ]);

    await closeWebSocket(downstream.socket);
  });

  it("delivers the final upstream frame before propagating an immediate close", async () => {
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", () => {
          socket.send(
            JSON.stringify({
              type: "response.completed",
              response: {
                id: "resp-close-after-completion",
                object: "response",
                status: "completed",
                output: [],
              },
            }),
          );
          socket.close();
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-final-frame-close",
      revision: 25,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "final-frame-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    const completed = nextWebSocketJson(downstream.socket);
    const closed = webSocketClosed(downstream.socket);

    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "close immediately after completion",
      }),
    );

    expect(await completed).toMatchObject({
      type: "response.completed",
      response: { id: "resp-close-after-completion" },
    });
    await closed;
  });

  it("returns 426 when the provider rejects WebSocket Upgrade and keeps the lease usable for HTTP", async () => {
    let upstreamUpgradeCount = 0;
    let upstreamHttpCount = 0;
    const upstream = await startWebSocketUpstream({
      rejectUpgradeStatus: 503,
      onUpgrade() {
        upstreamUpgradeCount += 1;
      },
      async onHttpRequest(request, response) {
        upstreamHttpCount += 1;
        expect(request.url).toBe("/v1/responses");
        expect(request.headers.authorization).toBe(
          "Bearer fallback-provider-secret",
        );
        expect(await readJson(request)).toMatchObject({
          model: "model-a",
          input: "fallback over http",
        });
        writeJson(response, 200, {
          id: "resp-http-fallback",
          object: "response",
          status: "completed",
          output: [],
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-fallback",
      revision: 14,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "fallback-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    expect(await rejectedWebSocketStatus(gateway, lease.token)).toBe(426);
    expect(upstreamUpgradeCount).toBe(1);

    const fallback = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "fallback over http",
      stream: false,
    });
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toMatchObject({ id: "resp-http-fallback" });
    expect(upstreamHttpCount).toBe(1);
  });

  it("uses HTTP_PROXY for both provider WebSocket and HTTP requests", async () => {
    let upstreamWebSocketMessages = 0;
    let upstreamHttpRequests = 0;
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", () => {
          upstreamWebSocketMessages += 1;
          socket.send(
            JSON.stringify({
              type: "response.completed",
              response: {
                id: "resp-proxied-ws",
                object: "response",
                status: "completed",
                output: [],
              },
            }),
          );
        });
      },
      async onHttpRequest(request, response) {
        upstreamHttpRequests += 1;
        await readJson(request);
        writeJson(response, 200, {
          id: "resp-proxied-http",
          object: "response",
          status: "completed",
          output: [],
        });
      },
    });
    const proxy = await startForwardProxy();
    const restoreProxyEnvironment = setProxyEnvironment(proxy.baseUrl);
    try {
      const gateway = await startGateway();
      const lease = gateway.issueLease({
        ...leaseMetering,
        conversationId: "conversation-proxied-transport",
        revision: 23,
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
        apiKey: "proxied-provider-secret",
        protocolMode: "native_responses",
        model: "model-a",
      });
      const downstream = await connectGatewayWebSocket(gateway, lease.token);
      const completed = nextWebSocketJson(downstream.socket);
      downstream.socket.send(
        JSON.stringify({
          type: "response.create",
          model: "model-a",
          input: "over websocket proxy",
        }),
      );
      expect(await completed).toMatchObject({
        type: "response.completed",
        response: { id: "resp-proxied-ws" },
      });
      await closeWebSocket(downstream.socket);

      const response = await requestGateway(gateway, lease.token, {
        model: "model-a",
        input: "over http proxy",
        stream: false,
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: "resp-proxied-http" });
      expect(proxy.httpRequests + proxy.upgradeRequests).toBe(2);
      expect(upstreamWebSocketMessages).toBe(1);
      expect(upstreamHttpRequests).toBe(1);

      const proxiedRequestCount = proxy.httpRequests + proxy.upgradeRequests;
      process.env.NO_PROXY = "127.0.0.1";
      const bypassGateway = await startGateway();
      const bypassLease = bypassGateway.issueLease({
        ...leaseMetering,
        conversationId: "conversation-no-proxy-transport",
        revision: 24,
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
        apiKey: "no-proxy-provider-secret",
        protocolMode: "native_responses",
        model: "model-a",
      });
      const bypassDownstream = await connectGatewayWebSocket(
        bypassGateway,
        bypassLease.token,
      );
      const bypassCompleted = nextWebSocketJson(bypassDownstream.socket);
      bypassDownstream.socket.send(
        JSON.stringify({
          type: "response.create",
          model: "model-a",
          input: "bypass websocket proxy",
        }),
      );
      await bypassCompleted;
      await closeWebSocket(bypassDownstream.socket);
      const bypassResponse = await requestGateway(
        bypassGateway,
        bypassLease.token,
        { model: "model-a", input: "bypass http proxy", stream: false },
      );
      expect(bypassResponse.status).toBe(200);
      await bypassResponse.body?.cancel();
      expect(proxy.httpRequests + proxy.upgradeRequests).toBe(
        proxiedRequestCount,
      );
    } finally {
      restoreProxyEnvironment();
    }
  });

  it("preserves an upstream WebSocket authentication failure instead of triggering transport fallback", async () => {
    const upstream = await startWebSocketUpstream({
      rejectUpgradeStatus: 401,
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-provider-auth",
      revision: 20,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "rejected-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    expect(await rejectedWebSocketStatus(gateway, lease.token)).toBe(401);
  });

  it.each([true, false])("rewrites WebSocket additional_tools with top-level tools present: %s", async (includeTopLevelTools) => {
    let upstreamRequest: JsonObject | undefined;
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", (data) => {
          upstreamRequest = parseWebSocketJson(data.toString());
          const tools = Array.isArray(upstreamRequest.tools)
            ? upstreamRequest.tools
            : [];
          const namespaceTool = tools.find(
            (tool) =>
              isRecord(tool) &&
              tool.type === "function" &&
              tool.description === "Read a workspace file",
          );
          const aliasedName =
            isRecord(namespaceTool) && typeof namespaceTool.name === "string"
              ? namespaceTool.name
              : "missing_translated_namespace_tool";
          socket.send(
            JSON.stringify({
              type: "response.completed",
              response: {
                id: "resp-compat-ws",
                object: "response",
                status: "completed",
                model: "model-a",
                output: [
                  {
                    id: "item-namespace-ws",
                    type: "function_call",
                    status: "completed",
                    call_id: "call-namespace-ws",
                    name: aliasedName,
                    arguments: '{"path":"README.md"}',
                  },
                ],
              },
            }),
          );
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-compat-ws",
      revision: 15,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "compat-ws-provider-secret",
      protocolMode: "responses_tool_compat",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);

    const completedEvent = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: [
          {
            type: "additional_tools",
            role: "developer",
            tools: [
              {
                type: "namespace",
                name: "mcp__workspace",
                tools: [
                  {
                    name: "read_file",
                    description: "Read a workspace file",
                    parameters: {
                      type: "object",
                      properties: { path: { type: "string" } },
                      required: ["path"],
                    },
                  },
                ],
              },
            ],
          },
          { type: "message", role: "user", content: "read it" },
        ],
        ...(includeTopLevelTools
          ? { tools: [{ type: "custom", name: "apply_patch" }] }
          : {}),
      }),
    );

    expect(await completedEvent).toMatchObject({
      type: "response.completed",
      response: {
        output: [
          {
            type: "function_call",
            namespace: "mcp__workspace",
            name: "read_file",
            arguments: '{"path":"README.md"}',
          },
        ],
      },
    });
    expect(upstreamRequest?.type).toBe("response.create");
    expect(upstreamRequest?.input).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "additional_tools" }),
      ]),
    );
    expect(upstreamRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function",
          description: "Read a workspace file",
        }),
        ...(includeTopLevelTools
          ? [expect.objectContaining({ type: "function", name: "apply_patch" })]
          : []),
      ]),
    );

    await closeWebSocket(downstream.socket);
  });

  it("retains tool aliases for incremental WebSocket responses after a non-generating warmup, but isolates new roots and sockets", async () => {
    const requests: JsonObject[] = [];
    let alias = "missing_tool";
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", (data) => {
          const request = parseWebSocketJson(data.toString());
          requests.push(request);
          const tool = Array.isArray(request.tools) ? request.tools[0] : null;
          if (isRecord(tool) && typeof tool.name === "string") alias = tool.name;
          socket.send(JSON.stringify({
            type: "response.completed",
            response: {
              id: `resp-${requests.length}`,
              status: "completed",
              output: request.generate === false ? [] : [{
                type: "function_call", id: "reused-item-id", call_id: "call-1",
                name: alias, arguments: JSON.stringify({ input: "text(1)" }),
              }],
            },
          }));
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering, conversationId: "conversation-ws-incremental", revision: 1,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`, apiKey: "test-provider-key",
      protocolMode: "responses_tool_compat", model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    const send = async (socket: WebSocket, body: JsonObject) => {
      const result = nextWebSocketJson(socket);
      socket.send(JSON.stringify({ type: "response.create", model: "model-a", input: [], ...body }));
      return result;
    };
    await send(downstream.socket, {
      generate: false,
      input: [{ type: "additional_tools", role: "developer", tools: [{ type: "custom", name: "exec" }] }],
    });
    for (const previousResponseId of ["resp-1", "resp-2", "resp-1"]) {
      expect(await send(downstream.socket, { previous_response_id: previousResponseId })).toMatchObject({
        response: { output: [{ type: "custom_tool_call", name: "exec", input: "text(1)" }] },
      });
    }
    expect(requests[0]?.tools).toMatchObject([{ type: "function", name: "exec" }]);
    expect(requests[1]).not.toHaveProperty("tools");
    expect(await send(downstream.socket, {})).toMatchObject({
      response: { output: [{ type: "function_call" }] },
    });
    const other = await connectGatewayWebSocket(gateway, lease.token);
    expect(await send(other.socket, { previous_response_id: "resp-1" })).toMatchObject({
      response: { output: [{ type: "function_call" }] },
    });
    await closeWebSocket(other.socket);
    await closeWebSocket(downstream.socket);
  });

  it("records client_metadata memory usage only after a WebSocket completion event", async () => {
    let completeResponse: (() => void) | undefined;
    let upstreamRequestCount = 0;
    const completionGate = new Promise<void>((resolve) => {
      completeResponse = resolve;
    });
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", () => {
          upstreamRequestCount += 1;
          if (upstreamRequestCount > 1) {
            socket.send(
              JSON.stringify({
                type: "response.completed",
                response: {
                  id: "resp-ordinary-ws",
                  object: "response",
                  status: "completed",
                  output: [],
                  usage: {
                    input_tokens: 3,
                    output_tokens: 2,
                    total_tokens: 5,
                  },
                },
              }),
            );
            return;
          }
          socket.send(
            JSON.stringify({
              type: "response.in_progress",
              response: {
                id: "resp-memory-ws",
                status: "in_progress",
                usage: {
                  input_tokens: 99,
                  output_tokens: 99,
                  total_tokens: 198,
                },
              },
            }),
          );
          void completionGate.then(() => {
            socket.send(
              JSON.stringify({
                type: "response.completed",
                response: {
                  id: "resp-memory-ws",
                  object: "response",
                  status: "completed",
                  output: [],
                  usage: {
                    input_tokens: 21,
                    input_tokens_details: { cached_tokens: 4 },
                    output_tokens: 7,
                    output_tokens_details: { reasoning_tokens: 2 },
                    total_tokens: 28,
                  },
                },
              }),
            );
          });
        });
      },
    });
    const captures: RunnerMemoryUsageCapture[] = [];
    const gateway = await startGateway({
      onMemoryUsage: async (capture) => {
        captures.push(capture);
      },
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "10000000-0000-4000-8000-000000000006",
      revision: 16,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "memory-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token, {
      "x-codex-turn-metadata": JSON.stringify({ request_kind: "memory" }),
    });

    const inProgressEvent = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "remember this",
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({
            request_kind: "memory",
          }),
        },
      }),
    );
    expect(await inProgressEvent).toMatchObject({
      type: "response.in_progress",
    });
    expect(captures).toHaveLength(0);

    const completedEvent = nextWebSocketJson(downstream.socket);
    completeResponse?.();
    expect(await completedEvent).toMatchObject({
      type: "response.completed",
    });
    await vi.waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({
      conversation_id: "10000000-0000-4000-8000-000000000006",
      operation: "extract",
      model: "model-a",
      measurement_method: "provider",
      token_usage: {
        total_tokens: 28,
        input_tokens: 21,
        cached_input_tokens: 4,
        output_tokens: 7,
        reasoning_output_tokens: 2,
      },
    });

    const ordinaryCompleted = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "ordinary follow-up",
      }),
    );
    expect(await ordinaryCompleted).toMatchObject({
      type: "response.completed",
      response: { id: "resp-ordinary-ws" },
    });
    expect(captures).toHaveLength(1);

    await closeWebSocket(downstream.socket);
  });

  it("returns 426 for Chat Completions bridge WebSocket requests without contacting the provider", async () => {
    let upstreamUpgradeCount = 0;
    const upstream = await startWebSocketUpstream({
      onUpgrade() {
        upstreamUpgradeCount += 1;
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-chat-ws",
      revision: 17,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "chat-ws-provider-secret",
      protocolMode: "chat_completions_bridge",
      model: "model-a",
    });

    expect(await rejectedWebSocketStatus(gateway, lease.token)).toBe(426);
    expect(upstreamUpgradeCount).toBe(0);
  });

  it("rejects invalid WebSocket credentials and never forwards an unauthorized model frame", async () => {
    let upstreamUpgradeCount = 0;
    const upstreamMessages: JsonObject[] = [];
    const upstream = await startWebSocketUpstream({
      onUpgrade() {
        upstreamUpgradeCount += 1;
      },
      onConnection(socket) {
        socket.on("message", (data) => {
          upstreamMessages.push(parseWebSocketJson(data.toString()));
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-auth",
      revision: 18,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "auth-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    expect(await rejectedWebSocketStatus(gateway, "invalid-lease-token")).toBe(
      401,
    );
    expect(upstreamUpgradeCount).toBe(0);

    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    const rejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-b",
        input: "must not reach the provider",
      }),
    );
    expect(await rejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_not_authorized" },
    });
    expect(upstreamUpgradeCount).toBe(1);
    expect(upstreamMessages).toHaveLength(0);
    await closeWebSocket(downstream.socket);
  });

  it("fails closed instead of sending a source-channel transition frame over the target WebSocket", async () => {
    const upstreamMessages: JsonObject[] = [];
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", (data) => {
          const message = parseWebSocketJson(data.toString());
          upstreamMessages.push(message);
          socket.send(
            JSON.stringify({
              type: "response.completed",
              response: {
                id: `resp-transition-ws-${upstreamMessages.length}`,
                object: "response",
                status: "completed",
                output: [],
              },
            }),
          );
        });
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-model-transition-ws",
      revision: 32,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "transition-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-c",
    });
    const nonce = "transition-nonce-ws";
    lease.setModelTransition(
      {
        revision: 31,
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
        apiKey: "source-transition-ws-provider-secret",
        protocolMode: "native_responses",
        model: "model-a",
        pricing: leaseMetering.pricing,
      },
      nonce,
    );
    const downstream = await connectGatewayWebSocket(gateway, lease.token);

    const uncorrelatedRejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "uncorrelated transition",
        client_metadata: {
          "x-codex-turn-metadata": modelTransitionMetadata(nonce),
        },
      }),
    );
    expect(await uncorrelatedRejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_not_authorized" },
    });

    lease.setTurnCorrelation({
      turnId: "turn-transition-ws",
      codexTurnId: null,
      modelTransitionNonce: nonce,
    });

    const ordinaryRejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "ordinary old-model frame",
      }),
    );
    expect(await ordinaryRejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_not_authorized" },
    });

    const wrongNonceRejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "wrong nonce",
        client_metadata: {
          "x-codex-turn-metadata": modelTransitionMetadata("wrong-nonce"),
        },
      }),
    );
    expect(await wrongNonceRejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_not_authorized" },
    });

    for (const metadata of [
      "{",
      modelTransitionMetadata(nonce, { trigger: "manual" }),
      modelTransitionMetadata(nonce, { phase: "mid_turn" }),
      modelTransitionMetadata(nonce, { reason: "context_limit" }),
      modelTransitionMetadata(null),
    ]) {
      const rejected = nextWebSocketJson(downstream.socket);
      downstream.socket.send(
        JSON.stringify({
          type: "response.create",
          model: "model-a",
          input: "untrusted compaction metadata",
          client_metadata: { "x-codex-turn-metadata": metadata },
        }),
      );
      expect(await rejected).toMatchObject({
        type: "error",
        status: 403,
        error: { code: "model_not_authorized" },
      });
    }

    const transportRejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "trusted transition compaction",
        client_metadata: {
          "x-codex-turn-metadata": modelTransitionMetadata(nonce),
        },
      }),
    );
    expect(await transportRejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_transition_requires_http" },
    });
    expect(upstreamMessages).toHaveLength(0);

    lease.setModelTransition(null, null);
    const clearedRejected = nextWebSocketJson(downstream.socket);
    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "cleared transition",
        client_metadata: {
          "x-codex-turn-metadata": modelTransitionMetadata(nonce),
        },
      }),
    );
    expect(await clearedRejected).toMatchObject({
      type: "error",
      status: 403,
      error: { code: "model_not_authorized" },
    });
    expect(upstreamMessages).toHaveLength(0);
    await closeWebSocket(downstream.socket);
  });

  it("closes both sides of an active WebSocket when its lease is released", async () => {
    let upstreamSocket: WebSocket | undefined;
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        upstreamSocket = socket;
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-release",
      revision: 19,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "release-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    expect(upstreamSocket?.readyState).toBe(WebSocket.OPEN);

    const downstreamClosed = webSocketClosed(downstream.socket);
    const upstreamClosed = webSocketClosed(upstreamSocket!);
    lease.release();
    await Promise.all([downstreamClosed, upstreamClosed]);

    expect(downstream.socket.readyState).toBe(WebSocket.CLOSED);
    expect(upstreamSocket?.readyState).toBe(WebSocket.CLOSED);
    expect(await rejectedWebSocketStatus(gateway, lease.token)).toBe(401);
  });

  it("closes active WebSockets and proxy resources idempotently with the gateway", async () => {
    let upstreamSocket: WebSocket | undefined;
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        upstreamSocket = socket;
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-gateway-close",
      revision: 26,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "gateway-close-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    const downstreamClosed = webSocketClosed(downstream.socket);
    const upstreamClosed = webSocketClosed(upstreamSocket!);

    await Promise.all([
      gateway.close(),
      gateway.close(),
      downstreamClosed,
      upstreamClosed,
    ]);

    expect(downstream.socket.readyState).toBe(WebSocket.CLOSED);
    expect(upstreamSocket?.readyState).toBe(WebSocket.CLOSED);
  });

  it("rejects a malformed downstream Upgrade before opening a provider WebSocket", async () => {
    let upstreamUpgradeCount = 0;
    const upstream = await startWebSocketUpstream({
      onUpgrade() {
        upstreamUpgradeCount += 1;
      },
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-malformed-ws",
      revision: 21,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "malformed-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    const response = await malformedWebSocketUpgrade(gateway, lease.token);
    const subprotocolResponse = await malformedWebSocketUpgrade(
      gateway,
      lease.token,
      {
        key: Buffer.from("the sample nonce").toString("base64"),
        protocol: "unsupported",
      },
    );

    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request\r\n/u);
    expect(subprotocolResponse).toMatch(
      /^HTTP\/1\.1 400 Bad Request\r\n/u,
    );
    expect(upstreamUpgradeCount).toBe(0);
  });

  it("closes a WebSocket bridge when queued small frames exceed its memory bound", async () => {
    const { logger, logs } = createCapturingLogger();
    const upstream = await startWebSocketUpstream({
      onConnection(socket) {
        socket.on("message", () => {
          const event = JSON.stringify({
            type: "response.output_text.delta",
            delta: "x".repeat(180),
          });
          for (let index = 0; index < 16; index += 1) socket.send(event);
        });
      },
    });
    const gateway = await startGateway({
      logger,
      webSocketQueueLimit: 32 * 1024 * 1024,
      webSocketQueueMessageLimit: 2,
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-ws-backpressure",
      revision: 22,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "backpressure-ws-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const downstream = await connectGatewayWebSocket(gateway, lease.token);
    const closed = webSocketClosed(downstream.socket);

    downstream.socket.send(
      JSON.stringify({
        type: "response.create",
        model: "model-a",
        input: "flood test",
      }),
    );

    await closed;
    await vi.waitFor(() => {
      expect(logs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: "model gateway websocket queue limit exceeded",
            direction: "upstream",
            messageLimit: 2,
          }),
        ]),
      );
    });
  });

  it("drops provider-private reasoning while preserving portable history", async () => {
    let upstreamBody: JsonObject | undefined;
    const upstream = await startUpstream(async (request, response) => {
      upstreamBody = await readJson(request);
      writeJson(response, 200, {
        id: "resp-portable-history",
        object: "response",
        status: "completed",
        output: [],
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-portable-history",
      revision: 4,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "portable-history-secret",
      protocolMode: "native_responses",
      model: "model-next",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-next",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "first question" }],
        },
        {
          type: "reasoning",
          summary: [],
          content: [
            { type: "reasoning_text", text: "provider-private reasoning" },
          ],
          encrypted_content: "",
        },
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "first answer" }],
        },
        {
          type: "reasoning",
          summary: [],
          encrypted_content: "portable-encrypted-reasoning",
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "follow up" }],
        },
      ],
      stream: false,
      store: false,
    });

    expect(response.status).toBe(200);
    expect(upstreamBody?.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "first question" }],
      },
      {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "first answer" }],
      },
      {
        type: "reasoning",
        summary: [],
        encrypted_content: "portable-encrypted-reasoning",
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "follow up" }],
      },
    ]);

    lease.release();
  });

  it("records provider-reported phase-one memory usage without counting ordinary requests", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 200, {
        id: "resp-memory",
        object: "response",
        status: "completed",
        output: [],
        usage: {
          input_tokens: 21,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 7,
          output_tokens_details: { reasoning_tokens: 2 },
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
      conversationId: "10000000-0000-4000-8000-000000000002",
      revision: 7,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "memory-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    await requestGateway(
      gateway,
      lease.token,
      { model: "model-a", input: "remember this", stream: false },
      {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "memory",
        }),
      },
    );
    await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "ordinary request",
      stream: false,
    });

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      owner_id: leaseMetering.ownerId,
      conversation_id: "10000000-0000-4000-8000-000000000002",
      operation: "extract",
      model: "model-a",
      measurement_method: "provider",
      token_usage: {
        total_tokens: 28,
        input_tokens: 21,
        cached_input_tokens: 4,
        output_tokens: 7,
        reasoning_output_tokens: 2,
      },
      pricing: leaseMetering.pricing,
    });
  });

  it("records phase-two memory usage with a local estimate when usage is absent", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 200, {
        id: "resp-memory-consolidation",
        object: "response",
        status: "completed",
        model: "model-a",
        output: [
          {
            id: "message-1",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "consolidated" }],
          },
        ],
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
      conversationId: "10000000-0000-4000-8000-000000000003",
      revision: 8,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "memory-provider-secret",
      protocolMode: "responses_tool_compat",
      model: "model-a",
    });

    await requestGateway(
      gateway,
      lease.token,
      { model: "model-a", input: "raw memories", stream: false },
      {
        "x-openai-memgen-request": "true",
        "x-openai-subagent": "memory_consolidation",
      },
    );

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      operation: "consolidate",
      measurement_method: "estimated",
    });
    expect(captures[0]!.token_usage.input_tokens).toBeGreaterThan(0);
    expect(captures[0]!.token_usage.output_tokens).toBeGreaterThan(0);
  });

  it("rewrites Responses-only function surfaces and restores namespace calls", async () => {
    let upstreamBody: JsonObject | undefined;
    const upstream = await startUpstream(async (request, response) => {
      upstreamBody = await readJson(request);
      const tools = Array.isArray(upstreamBody.tools) ? upstreamBody.tools : [];
      const namespaceTool = tools.find(
        (tool) =>
          isRecord(tool) &&
          tool.type === "function" &&
          tool.description === "Read a workspace file",
      );
      if (!isRecord(namespaceTool) || typeof namespaceTool.name !== "string") {
        writeJson(response, 400, { error: "missing translated tool" });
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      const item = {
        id: "item-namespace",
        type: "function_call",
        status: "completed",
        call_id: "call-namespace",
        name: namespaceTool.name,
        arguments: '{"path":"README.md"}',
      };
      writeSse(response, "response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        sequence_number: 0,
        item: { ...item, status: "in_progress", arguments: "" },
      });
      writeSse(response, "response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        item_id: item.id,
        output_index: 0,
        sequence_number: 1,
        delta: item.arguments,
      });
      writeSse(response, "response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        sequence_number: 2,
        item,
      });
      writeSse(response, "response.completed", {
        type: "response.completed",
        sequence_number: 3,
        response: {
          id: "resp-compat",
          object: "response",
          status: "completed",
          model: "model-a",
          output: [item],
        },
      });
      response.end();
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-compat",
      revision: 4,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "compat-provider-secret",
      protocolMode: "responses_tool_compat",
      model: "model-a",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      stream: true,
      input: [
        {
          type: "additional_tools",
          role: "developer",
          tools: [
            {
              type: "namespace",
              name: "mcp__workspace",
              tools: [
                {
                  name: "read_file",
                  description: "Read a workspace file",
                  parameters: {
                    type: "object",
                    properties: { path: { type: "string" } },
                    required: ["path"],
                  },
                },
              ],
            },
          ],
        },
        { type: "message", role: "user", content: "read it" },
      ],
      tools: [{ type: "custom", name: "apply_patch" }],
    });
    const events = await readSse(response);

    expect(response.status).toBe(200);
    expect(upstreamBody?.input).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "additional_tools" }),
      ]),
    );
    expect(upstreamBody?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "function",
          description: "Read a workspace file",
        }),
        expect.objectContaining({
          type: "function",
          name: "apply_patch",
        }),
      ]),
    );
    expect(
      events.find(
        (event) =>
          event.event === "response.output_item.done" &&
          isRecord(event.data.item),
      )?.data,
    ).toMatchObject({
      item: {
        type: "function_call",
        namespace: "mcp__workspace",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
    });
    expect(
      events.find((event) => event.event === "response.completed")?.data,
    ).toMatchObject({
      response: {
        output: [
          {
            type: "function_call",
            namespace: "mcp__workspace",
            name: "read_file",
          },
        ],
      },
    });
  });

  it("bridges Chat Completions streaming while leaving tool execution to Codex", async () => {
    const upstreamRequests: JsonObject[] = [];
    const upstream = await startUpstream(async (request, response) => {
      expect(request.url).toBe("/v1/chat/completions");
      expect(request.headers.authorization).toBe("Bearer chat-provider-secret");
      const body = await readJson(request);
      upstreamRequests.push(body);
      const tools = Array.isArray(body.tools) ? body.tools : [];
      const namespaceTool = tools.find(
        (tool) =>
          isRecord(tool) &&
          isRecord(tool.function) &&
          tool.function.description === "Search documents",
      );
      if (
        !isRecord(namespaceTool) ||
        !isRecord(namespaceTool.function) ||
        typeof namespaceTool.function.name !== "string"
      ) {
        writeJson(response, 400, { error: "missing chat tool" });
        return;
      }
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      writeSse(response, "message", {
        id: "chat-1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-search",
                  type: "function",
                  function: {
                    name: namespaceTool.function.name,
                    arguments: '{"query":"contract"}',
                  },
                },
              ],
            },
          },
        ],
      });
      writeSse(response, "message", {
        id: "chat-1",
        choices: [{ index: 0, delta: { content: "Searching." } }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
        },
      });
      response.write("data: [DONE]\n\n");
      response.end();
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-chat",
      revision: 5,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "chat-provider-secret",
      protocolMode: "chat_completions_bridge",
      model: "model-a",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      stream: true,
      instructions: "Be concise.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Find the contract" }],
        },
      ],
      tools: [
        {
          type: "namespace",
          name: "mcp__documents",
          tools: [
            {
              name: "search",
              description: "Search documents",
              parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
              },
            },
          ],
        },
      ],
    });
    const events = await readSse(response);

    expect(upstreamRequests).toHaveLength(1);
    expect(upstreamRequests[0]).toMatchObject({
      model: "model-a",
      stream: true,
      messages: [{ role: "system", content: "Be concise." }, { role: "user" }],
    });
    expect(
      events.find(
        (event) =>
          event.event === "response.output_item.done" &&
          isRecord(event.data.item) &&
          event.data.item.type === "function_call",
      )?.data,
    ).toMatchObject({
      item: {
        namespace: "mcp__documents",
        name: "search",
        call_id: "call-search",
        arguments: '{"query":"contract"}',
      },
    });
    expect(
      events.find((event) => event.event === "response.completed")?.data,
    ).toMatchObject({
      response: {
        status: "completed",
        output_text: "Searching.",
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        },
      },
    });
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        "response.created",
        "response.in_progress",
        "response.completed",
      ]),
    );
  });

  it("uses the authorized transition model throughout the Chat Completions bridge", async () => {
    let upstreamBody: JsonObject | undefined;
    const upstream = await startUpstream(async (request, response) => {
      upstreamBody = await readJson(request);
      writeJson(response, 200, {
        id: "chat-transition",
        object: "chat.completion",
        created: 1_700_000_000,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Compacted." },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
        },
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-chat-transition",
      revision: 33,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "chat-transition-provider-secret",
      protocolMode: "chat_completions_bridge",
      model: "model-c",
    });
    const nonce = "chat-transition-nonce";
    const metadata = modelTransitionMetadata(nonce);
    lease.setModelTransition(
      {
        revision: 32,
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
        apiKey: "chat-transition-source-provider-secret",
        protocolMode: "chat_completions_bridge",
        model: "model-a",
        pricing: leaseMetering.pricing,
      },
      nonce,
    );
    lease.setTurnCorrelation({
      turnId: "turn-chat-transition",
      codexTurnId: null,
      modelTransitionNonce: nonce,
    });

    const response = await requestGateway(
      gateway,
      lease.token,
      {
        model: "model-a",
        stream: false,
        input: "compact the existing context",
        client_metadata: { "x-codex-turn-metadata": metadata },
      },
      { "x-codex-turn-metadata": metadata },
    );

    expect(response.status).toBe(200);
    expect(upstreamBody?.model).toBe("model-a");
    expect(await response.json()).toMatchObject({
      status: "completed",
      model: "model-a",
      output_text: "Compacted.",
    });
  });

  it("fails closed for model mismatch, oversized input, and upstream details", async () => {
    const { logger, logs } = createCapturingLogger();
    let gatewayRequestId: string | undefined;
    const upstreamHandler = vi.fn(
      async (request: IncomingMessage, response: ServerResponse) => {
        gatewayRequestId = singleHeader(request, "x-linksense-request-id");
        response.setHeader("x-request-id", "provider-request-1");
        writeJson(response, 401, {
          error: "provider-secret-diagnostic",
        });
      },
    );
    const upstream = await startUpstream(upstreamHandler);
    const gateway = await startGateway({ logger, requestBodyLimit: 256 });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-errors",
      revision: 6,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    lease.setTurnCorrelation({
      turnId: "10000000-0000-4000-8000-000000000003",
      codexTurnId: "codex-turn-errors",
      modelTransitionNonce: null,
    });

    const mismatch = await requestGateway(gateway, lease.token, {
      model: "model-b",
      input: "hello",
    });
    expect(mismatch.status).toBe(403);
    expect(upstreamHandler).not.toHaveBeenCalled();

    const oversized = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "x".repeat(512),
    });
    expect(oversized.status).toBe(413);
    expect(upstreamHandler).not.toHaveBeenCalled();

    const upstreamFailure = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "hello",
    });
    expect(upstreamFailure.status).toBe(401);
    const errorBody = await upstreamFailure.text();
    expect(errorBody).toContain("model_provider_error");
    expect(errorBody).not.toContain("provider-secret-diagnostic");
    expect(errorBody).not.toContain("provider-secret");
    expect(upstreamHandler).toHaveBeenCalledOnce();
    const failureLog = logs.find(
      (entry) => entry.msg === "model provider request failed",
    );
    expect(failureLog).toMatchObject({
      requestId: expect.any(String),
      conversationId: "conversation-errors",
      turnId: "10000000-0000-4000-8000-000000000003",
      codexTurnId: "codex-turn-errors",
      abortSource: null,
      upstreamRequestId: "provider-request-1",
      upstreamStatus: 401,
    });
    expect(gatewayRequestId).toBe(failureLog?.requestId);
  });

  it("logs the correlated request and abort source when upstream headers time out", async () => {
    const { logger, logs } = createCapturingLogger();
    let upstreamRequestId: string | undefined;
    const upstream = await startUpstream(async (request) => {
      upstreamRequestId = singleHeader(request, "x-linksense-request-id");
      await new Promise<void>((resolve) => request.once("close", resolve));
    });
    const gateway = await startGateway({
      logger,
      upstreamHeaderTimeoutMs: 250,
    });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-header-timeout",
      revision: 11,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "timeout-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const turnId = "10000000-0000-4000-8000-000000000004";
    lease.setTurnCorrelation({
      turnId,
      codexTurnId: null,
      modelTransitionNonce: null,
    });

    const pendingResponse = requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "wait for headers",
      stream: true,
    });
    await vi.waitFor(() =>
      expect(upstreamRequestId).toEqual(expect.any(String)),
    );
    lease.setTurnCorrelation({
      turnId,
      codexTurnId: "codex-turn-timeout",
      modelTransitionNonce: null,
    });

    const response = await pendingResponse;
    expect(response.status).toBe(502);
    const failureLog = logs.find(
      (entry) => entry.msg === "model gateway request failed",
    );
    expect(failureLog).toMatchObject({
      requestId: upstreamRequestId,
      conversationId: "conversation-header-timeout",
      turnId,
      codexTurnId: "codex-turn-timeout",
      memoryOperation: null,
      abortSource: "upstream_header_timeout",
      errorClass: "AbortError",
      durationMs: expect.any(Number),
    });
  });

  it("logs a client response close separately from an upstream timeout", async () => {
    const { logger, logs } = createCapturingLogger();
    const upstream = await startUpstream(async (_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      });
      response.write(
        'event: response.in_progress\ndata: {"type":"response.in_progress"}\n\n',
      );
      await new Promise<void>((resolve) => response.once("close", resolve));
    });
    const gateway = await startGateway({ logger });
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-client-close",
      revision: 12,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "client-close-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });
    const turnId = "10000000-0000-4000-8000-000000000005";
    lease.setTurnCorrelation({
      turnId,
      codexTurnId: "codex-turn-client-close",
      modelTransitionNonce: null,
    });
    const clientAbort = new AbortController();
    const downstream = await fetch(`${gateway.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${lease.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "model-a",
        input: "disconnect while streaming",
        stream: true,
      }),
      signal: clientAbort.signal,
    });

    clientAbort.abort();
    await downstream.text().catch(() => undefined);
    await vi.waitFor(() => {
      expect(
        logs.find((entry) => entry.msg === "model gateway request failed"),
      ).toMatchObject({
        conversationId: "conversation-client-close",
        turnId,
        codexTurnId: "codex-turn-client-close",
        abortSource: "client_response_closed",
        errorClass: "AbortError",
      });
    });
  });

  it.each([
    "native_responses",
    "responses_tool_compat",
    "chat_completions_bridge",
  ] as const)(
    "preserves context_length_exceeded as a sanitized Responses failure in %s mode",
    async (protocolMode) => {
      const upstream = await startUpstream(async (_request, response) => {
        writeJson(response, 400, {
          error: {
            type: "invalid_request_error",
            code: "context_length_exceeded",
            message: "provider-private-context-diagnostic",
          },
        });
      });
      const gateway = await startGateway();
      const lease = gateway.issueLease({
        ...leaseMetering,
        conversationId: `conversation-context-${protocolMode}`,
        revision: 9,
        upstreamBaseUrl: `${upstream.baseUrl}/v1`,
        apiKey: "context-provider-secret",
        protocolMode,
        model: "model-a",
      });

      const response = await requestGateway(gateway, lease.token, {
        model: "model-a",
        input: "continue",
        stream: true,
      });
      const events = await readSse(response);

      expect(response.status).toBe(200);
      expect(events).toEqual([
        {
          event: "response.failed",
          data: {
            type: "response.failed",
            sequence_number: 0,
            response: {
              status: "failed",
              error: {
                type: "invalid_request_error",
                code: "context_length_exceeded",
                message: "The request exceeded the model context window.",
              },
            },
          },
        },
      ]);
      expect(JSON.stringify(events)).not.toContain(
        "provider-private-context-diagnostic",
      );
      expect(JSON.stringify(events)).not.toContain("context-provider-secret");
    },
  );

  it("preserves context_length_exceeded for a non-streaming request without leaking provider details", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 400, {
        error: {
          code: "context_length_exceeded",
          message: "provider-private-context-diagnostic",
        },
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-context-non-stream",
      revision: 10,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "context-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "continue",
      stream: false,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: {
        type: "invalid_request_error",
        code: "context_length_exceeded",
        message: "The request exceeded the model context window.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(
      "provider-private-context-diagnostic",
    );
  });

  it("normalizes vLLM maximum context length errors as sanitized Responses failures", async () => {
    const upstream = await startUpstream(async (_request, response) => {
      writeJson(response, 400, {
        object: "error",
        message:
          "This model's maximum context length is 150000 tokens. However, you requested 0 output tokens and your prompt contains at least 150001 input tokens, for a total of at least 150001 tokens. Please reduce the length of the input prompt or the number of requested output tokens. (parameter=input_tokens, value=150001)",
        type: "BadRequestError",
        param: null,
        code: 400,
      });
    });
    const gateway = await startGateway();
    const lease = gateway.issueLease({
      ...leaseMetering,
      conversationId: "conversation-context-vllm",
      revision: 11,
      upstreamBaseUrl: `${upstream.baseUrl}/v1`,
      apiKey: "vllm-provider-secret",
      protocolMode: "native_responses",
      model: "model-a",
    });

    const response = await requestGateway(gateway, lease.token, {
      model: "model-a",
      input: "continue",
      stream: true,
    });
    const events = await readSse(response);

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        event: "response.failed",
        data: {
          type: "response.failed",
          sequence_number: 0,
          response: {
            status: "failed",
            error: {
              type: "invalid_request_error",
              code: "context_length_exceeded",
              message: "The request exceeded the model context window.",
            },
          },
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("150001");
    expect(JSON.stringify(events)).not.toContain("vllm-provider-secret");
  });
});

async function startGateway(
  options: {
    fetch?: typeof fetch;
    logger?: Logger;
    requestBodyLimit?: number;
    webSocketQueueLimit?: number;
    webSocketQueueMessageLimit?: number;
    upstreamHeaderTimeoutMs?: number;
    upstreamIdleTimeoutMs?: number;
    onMemoryUsage?: (capture: RunnerMemoryUsageCapture) => Promise<void>;
  } = {},
): Promise<ModelGateway> {
  const { logger = pino({ enabled: false }), ...gatewayOptions } = options;
  const gateway = new ModelGateway({
    logger,
    ...gatewayOptions,
  });
  await gateway.start();
  closers.push(() => gateway.close());
  return gateway;
}

async function malformedWebSocketUpgrade(
  gateway: ModelGateway,
  token: string,
  options: { key?: string; protocol?: string } = {},
): Promise<string> {
  const url = new URL(`${gateway.baseUrl}/responses`);
  const socket = createConnection({
    host: url.hostname,
    port: Number(url.port),
  });
  const chunks: Buffer[] = [];
  socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("connect", resolve);
  });
  const headers = [
      `GET ${url.pathname} HTTP/1.1`,
      `Host: ${url.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      `Sec-WebSocket-Key: ${options.key ?? "invalid"}`,
      `Authorization: Bearer ${token}`,
    ];
  if (options.protocol) {
    headers.push(`Sec-WebSocket-Protocol: ${options.protocol}`);
  }
  socket.write([...headers, "", ""].join("\r\n"));
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("close", () => resolve());
  });
  return Buffer.concat(chunks).toString("utf8");
}

function createCapturingLogger(): {
  logger: Logger;
  logs: JsonObject[];
} {
  const logs: JsonObject[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split("\n")) {
        if (line === "") continue;
        const parsed: unknown = JSON.parse(line);
        if (isRecord(parsed)) logs.push(parsed);
      }
      callback();
    },
  });
  return { logger: pino({}, destination), logs };
}

async function startUpstream(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>,
): Promise<{ baseUrl: string; server: Server }> {
  const server = createServer((request, response) => {
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
    throw new Error("test upstream has no TCP address");
  }
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
        server.closeAllConnections();
      }),
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function startWebSocketUpstream(
  options: {
    responseHeaders?: Readonly<Record<string, string>>;
    rejectUpgradeStatus?: number;
    onUpgrade?: (request: IncomingMessage) => void;
    onConnection?: (socket: WebSocket, request: IncomingMessage) => void;
    onHttpRequest?: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => Promise<void>;
  } = {},
): Promise<{ baseUrl: string; server: Server }> {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });
  if (options.responseHeaders) {
    webSocketServer.on("headers", (headers) => {
      for (const [name, value] of Object.entries(options.responseHeaders!)) {
        headers.push(`${name}: ${value}`);
      }
    });
  }
  if (options.onConnection) {
    webSocketServer.on("connection", options.onConnection);
  }
  const server = createServer((request, response) => {
    void (
      options.onHttpRequest?.(request, response) ??
      Promise.resolve(writeJson(response, 404, { error: "not_found" }))
    ).catch(() => {
      if (!response.headersSent) writeJson(response, 500, { error: "test" });
      else response.destroy();
    });
  });
  server.on("upgrade", (request, socket, head) => {
    options.onUpgrade?.(request);
    if (options.rejectUpgradeStatus) {
      socket.end(
        [
          `HTTP/1.1 ${options.rejectUpgradeStatus} Service Unavailable`,
          "Connection: close",
          "Content-Length: 0",
          "",
          "",
        ].join("\r\n"),
      );
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test WebSocket upstream has no TCP address");
  }
  closers.push(async () => {
    for (const client of webSocketServer.clients) client.terminate();
    await new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function startForwardProxy(): Promise<{
  baseUrl: string;
  readonly httpRequests: number;
  readonly upgradeRequests: number;
}> {
  let httpRequests = 0;
  let upgradeRequests = 0;
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    httpRequests += 1;
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      writeJson(response, 400, { error: "invalid_proxy_target" });
      return;
    }
    const headers = { ...request.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = requestHttp(
      target,
      { method: request.method, headers },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) {
        writeJson(response, 502, { error: "proxy_upstream_failed" });
      } else {
        response.destroy();
      }
    });
    request.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, downstream, head) => {
    httpRequests += 1;
    let target: URL;
    try {
      target = new URL(`http://${request.url ?? ""}`);
    } catch {
      downstream.destroy();
      return;
    }
    const upstream = createConnection({
      host: target.hostname,
      port: Number(target.port || 80),
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    const terminateTunnel = () => {
      downstream.destroy();
      upstream.destroy();
    };
    downstream.once("error", terminateTunnel);
    upstream.once("error", terminateTunnel);
    upstream.once("connect", () => {
      downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.byteLength > 0) upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
  });
  server.on("upgrade", (request, downstream, head) => {
    upgradeRequests += 1;
    let target: URL;
    try {
      target = new URL(request.url ?? "");
    } catch {
      downstream.destroy();
      return;
    }
    const upstream = createConnection({
      host: target.hostname,
      port: Number(target.port || 80),
    });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    const terminateTunnel = () => {
      downstream.destroy();
      upstream.destroy();
    };
    downstream.once("error", terminateTunnel);
    upstream.once("error", terminateTunnel);
    upstream.once("connect", () => {
      const forwardedHeaders: string[] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];
        const value = request.rawHeaders[index + 1];
        if (!name || value === undefined) continue;
        const normalizedName = name.toLowerCase();
        if (
          normalizedName === "proxy-authorization" ||
          normalizedName === "proxy-connection"
        ) {
          continue;
        }
        forwardedHeaders.push(`${name}: ${value}`);
      }
      upstream.write(
        [
          `${request.method ?? "GET"} ${target.pathname}${target.search} HTTP/1.1`,
          ...forwardedHeaders,
          "",
          "",
        ].join("\r\n"),
      );
      if (head.byteLength > 0) upstream.write(head);
      downstream.pipe(upstream).pipe(downstream);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test forward proxy has no TCP address");
  }
  closers.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    get httpRequests() {
      return httpRequests;
    },
    get upgradeRequests() {
      return upgradeRequests;
    },
  };
}

function setProxyEnvironment(proxyUrl: string): () => void {
  const names = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  for (const name of names) {
    if (name !== "HTTP_PROXY" && name !== "HTTPS_PROXY") {
      delete process.env[name];
    }
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

async function connectGatewayWebSocket(
  gateway: ModelGateway,
  token: string,
  headers: Record<string, string> = {},
): Promise<{ socket: WebSocket; response: IncomingMessage }> {
  const socket = new WebSocket(gatewayWebSocketUrl(gateway), {
    headers: { authorization: `Bearer ${token}`, ...headers },
    perMessageDeflate: false,
  });
  return await new Promise((resolve, reject) => {
    let response: IncomingMessage | undefined;
    const onError = (error: Error) => reject(error);
    socket.once("upgrade", (upgradeResponse) => {
      response = upgradeResponse;
    });
    socket.once("error", onError);
    socket.once("open", () => {
      socket.off("error", onError);
      socket.on("error", () => undefined);
      if (!response) {
        reject(new Error("test WebSocket opened without an upgrade response"));
        return;
      }
      resolve({ socket, response });
    });
  });
}

async function rejectedWebSocketStatus(
  gateway: ModelGateway,
  token: string,
): Promise<number | undefined> {
  const socket = new WebSocket(gatewayWebSocketUrl(gateway), {
    headers: { authorization: `Bearer ${token}` },
    perMessageDeflate: false,
  });
  return await new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    socket.once("error", onError);
    socket.once("unexpected-response", (_request, response) => {
      socket.off("error", onError);
      socket.on("error", () => undefined);
      const statusCode = response.statusCode;
      response.resume();
      response.once("end", () => {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        resolve(statusCode);
      });
    });
  });
}

function gatewayWebSocketUrl(gateway: ModelGateway): string {
  const url = new URL(`${gateway.baseUrl}/responses`);
  url.protocol = "ws:";
  return url.toString();
}

function nextWebSocketJson(socket: WebSocket): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("close", onClose);
      socket.off("error", onError);
      socket.off("message", onMessage);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("test WebSocket closed before receiving a message"));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      cleanup();
      if (isBinary) {
        reject(new Error("test WebSocket received a binary message"));
        return;
      }
      try {
        resolve(parseWebSocketJson(data.toString()));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    };
    socket.once("close", onClose);
    socket.once("error", onError);
    socket.once("message", onMessage);
  });
}

function parseWebSocketJson(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed))
    throw new Error("test WebSocket data is not an object");
  return parsed;
}

function modelTransitionMetadata(
  nonce: string | null,
  compactionOverrides: JsonObject = {},
): string {
  return JSON.stringify({
    request_kind: "compaction",
    ...(nonce ? { linksense_transition_nonce: nonce } : {}),
    compaction: {
      trigger: "auto",
      reason: "comp_hash_changed",
      implementation: "responses",
      phase: "pre_turn",
      strategy: "memento",
      ...compactionOverrides,
    },
  });
}

function manualModelTransitionMetadata(): string {
  return JSON.stringify({
    request_kind: "compaction",
    compaction: {
      trigger: "manual",
      reason: "user_requested",
      implementation: "responses",
      phase: "standalone_turn",
      strategy: "memento",
    },
  });
}

function webSocketClosed(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once("close", () => resolve()));
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  const closed = webSocketClosed(socket);
  if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
  else socket.close();
  await closed;
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

function singleHeader(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readSse(
  response: Response,
): Promise<Array<{ event: string; data: JsonObject }>> {
  if (!response.body) throw new Error("test response has no body");
  const result: Array<{ event: string; data: JsonObject }> = [];
  for await (const event of parseSseStream(response.body)) {
    const data: unknown = JSON.parse(event.data);
    if (!isRecord(data)) throw new Error("test SSE data is not an object");
    result.push({ event: event.event ?? "message", data });
  }
  return result;
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) throw new Error("test request is not an object");
  return parsed;
}

function writeSse(
  response: ServerResponse,
  event: string,
  data: JsonObject,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  data: JsonObject,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
