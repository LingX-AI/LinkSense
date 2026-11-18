import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import { DESKTOP_MODEL_PROXY_PATH, DESKTOP_MODEL_PURPOSE_HEADER } from "@linksense/shared";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { DesktopRunLeases } from "../src/modules/desktop-credentials/run-leases.js";
import { RedisDesktopDeviceCoordinator } from "../src/modules/desktop-devices/coordinator.js";
import { reserveDesktopModelSlot } from "../src/modules/model-proxy/request-slots.js";
import { desktopModelProxyRoutes } from "../src/modules/model-proxy/routes.js";
import { createRedisFixture } from "./fixtures/redis.js";

const upstreamKey = "synthetic-provider-key";
const nativeInput = { model: "native-fixture", input: "fixture prompt", stream: true };
const chatInput = { model: "memory-fixture", messages: [{ role: "user", content: "fixture history" }] };
const endpoint = DESKTOP_MODEL_PROXY_PATH;
let redis: Awaited<ReturnType<typeof createRedisFixture>>;
const applications: ReturnType<typeof Fastify>[] = [];

beforeAll(async () => { redis = await createRedisFixture(); });
afterEach(async () => { await Promise.all(applications.splice(0).map(app => app.close())); });
afterAll(async () => { await redis?.close(); });

async function fixture(options: { deadline?: number; trustProxy?: boolean } = {}) {
  const ownerId = randomUUID();
  const turnId = randomUUID();
  const binding = { deviceId: randomUUID(), connectionId: randomUUID() };
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  await coordinator.connect(binding.deviceId, binding.connectionId);
  const leases = new DesktopRunLeases(redis.client, scope => coordinator.isCurrentConnection(scope.deviceId, scope.connectionId));
  const credentials = await leases.issue(binding, {
    ownerId,
    conversationId: randomUUID(),
    projectionTurnId: turnId,
    expectedRuntimeGeneration: randomUUID(),
    model: nativeInput.model,
    modelProvider: {
      revision: 2,
      baseUrl: "https://not-exposed.example.test/v1",
      apiKey: upstreamKey,
      protocolMode: "native_responses",
      memoryExtraction: {
        model: chatInput.model,
        baseUrl: "https://not-exposed.example.test/v1",
        apiKey: upstreamKey,
        protocolMode: "chat_completions_bridge",
        reasoningEffort: "low",
        pricing: {
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
        },
      },
    },
    modelTransitionSource: {
      model: "previous-fixture",
      provider: {
        revision: 1,
        baseUrl: "https://not-exposed.example.test/v1",
        apiKey: upstreamKey,
        protocolMode: "responses_tool_compat",
      },
    },
  });
  const resolveDesktopProxyProvider = vi.fn<(input: unknown) => Promise<{ baseUrl: string; apiKey: string }>>(async () => ({
    baseUrl: "https://server-configured.example.test/v1", apiKey: upstreamKey,
  }));
  const assertCanStartTask = vi.fn<(ownerId: string) => Promise<void>>(async () => undefined);
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => init?.headers &&
    new Headers(init.headers).get("accept")?.includes("text/event-stream")
    ? new Response('event: response.completed\ndata: {"type":"response.completed"}\n\n', {
        headers: { "content-type": "text/event-stream", "set-cookie": `upstream=${upstreamKey}` },
      })
    : Response.json({ choices: [] }),
  );
  const app = Fastify({ trustProxy: options.trustProxy ?? false });
  applications.push(app);
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const deadline = options.deadline;
  await app.register(desktopModelProxyRoutes, {
    prefix: endpoint, redis: redis.client, rateLimitSecret: randomUUID(),
    ...(deadline === undefined ? {} : { deadlineMs: deadline }),
    leases, settings: { resolveDesktopProxyProvider }, creditLimits: { assertCanStartTask },
    privacyMasking: { runtimeForUser: async () => undefined }, fetcher,
  });
  return {
    app, binding, credentials, turnId, ownerId, leases, fetcher, resolveDesktopProxyProvider, assertCanStartTask,
    request: (route: string, token: string, payload: Record<string, unknown>, purpose = route.split("/")[0]) => app.inject({
      method: "POST", url: `${endpoint}/${turnId}/${route}`, payload,
      headers: { authorization: `Bearer ${token}`, [DESKTOP_MODEL_PURPOSE_HEADER]: purpose },
    }),
  };
}

describe("desktop model proxy", () => {
  it("uses the lease and server registry for primary and memory inference, with sanitized responses", async () => {
    const test = await fixture();
    const { primary, memory_extraction: memory } = test.credentials;
    if (!memory) throw new Error("Missing fixture memory grant");
    const streamed = await test.request("primary/responses", primary.token, {
      ...nativeInput, client_metadata: { fixture: "value" }, prompt_cache_key: "client-cache-key",
      prompt_cache_options: { ttl: "12h" }, service_tier: "priority",
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.body).toContain("response.completed");
    expect(streamed.headers["set-cookie"]).toBeUndefined();
    expect(streamed.headers["cache-control"]).toBe("no-store");
    const extracted = await test.request("memory_extraction/chat/completions", memory.token, {
      ...chatInput, reasoning_effort: "high",
    });
    expect(extracted.statusCode).toBe(200);
    expect(extracted.json()).toEqual({ choices: [] });
    expect(test.resolveDesktopProxyProvider.mock.calls).toEqual([
      [expect.objectContaining({ model: primary.model, purpose: primary.purpose, revision: 2 })],
      [expect.objectContaining({ model: memory.model, purpose: memory.purpose, revision: 2 })],
    ]);
    expect(test.assertCanStartTask).toHaveBeenCalledWith(test.ownerId);
    const captures = test.fetcher.mock.calls;
    expect(captures.map(([url]) => String(url))).toEqual([
      "https://server-configured.example.test/v1/responses",
      "https://server-configured.example.test/v1/chat/completions",
    ]);
    for (const [, init] of captures) {
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${upstreamKey}`);
      expect(String(init?.body)).not.toContain("client-cache-key");
      expect(String(init?.body)).not.toContain(upstreamKey);
    }
    expect(JSON.parse(String(captures[0]?.[1]?.body))).toMatchObject({ ...nativeInput, store: false });
    expect(String(captures[0]?.[1]?.body)).not.toMatch(/prompt_cache_options|service_tier|client_metadata/u);
    expect(JSON.parse(String(captures[1]?.[1]?.body))).toMatchObject({ ...chatInput, reasoning_effort: "low" });
  });

  it("rejects mismatched purpose, protocol, model, scope and provider revision before contacting the provider", async () => {
    const test = await fixture();
    const token = test.credentials.primary.token;
    expect((await test.request("primary/responses", test.credentials.run_token, nativeInput)).statusCode).toBe(401);
    expect((await test.request("primary/responses", token, nativeInput, "transition_source")).statusCode).toBe(403);
    expect((await test.request("memory_extraction/responses", token, nativeInput)).statusCode).toBe(401);
    expect((await test.request("primary/responses", token, { ...nativeInput, model: "some-other-model" })).statusCode).toBe(401);
    expect((await test.request("primary/chat/completions", token, { ...chatInput, model: nativeInput.model })).statusCode).toBe(403);
    test.resolveDesktopProxyProvider.mockRejectedValueOnce(new AppError("MODEL_SELECTION_INVALID"));
    expect((await test.request("primary/responses", token, nativeInput)).json()).toMatchObject({ error_code: "MODEL_SELECTION_INVALID" });
    await test.leases.revoke(test.turnId);
    expect((await test.request("primary/responses", token, nativeInput)).statusCode).toBe(401);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("does not accept an ordinary inference payload on the transition-source grant", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    const result = await test.request("transition_source/responses", source.token, {
      ...nativeInput, model: source.model,
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }),
      },
    });
    expect(result.statusCode).toBe(403);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { previous_response_id: "unbound-response" },
    { conversation: "unbound-conversation" },
    { background: true },
    { store: true },
    { tools: [{ type: "mcp", server_url: "https://not-authorized.example.test" }] },
    { tools: [{ type: "file_search", vector_store_ids: ["foreign"] }] },
    { input: [{ type: "item_reference", id: "external" }] },
    { input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "https://not-authorized.example.test/image.png" }] }] },
  ])("rejects requests that try to use an upstream resource outside the scoped call", async unsafe => {
    const test = await fixture();
    const result = await test.request("primary/responses", test.credentials.primary.token, { ...nativeInput, ...unsafe });
    expect(result.statusCode).toBe(400);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { code: "context_length_exceeded", message: upstreamKey },
    { type: "BadRequestError", code: 400, message: `This model's maximum context length was exceeded. ${upstreamKey}` },
  ])("preserves context-limit failures without reflecting provider diagnostics", async error => {
    const test = await fixture();
    test.fetcher.mockResolvedValueOnce(Response.json({ error }, { status: 400 }));
    const response = await test.request("primary/responses", test.credentials.primary.token, nativeInput);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "context_length_exceeded" } });
  });

  it("does not forward provider redirects, cookies or arbitrary error text", async () => {
    const test = await fixture();
    test.fetcher.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://wrong.example.test" } }));
    const redirected = await test.request("primary/responses", test.credentials.primary.token, nativeInput);
    expect(redirected.statusCode).toBe(502);
    expect(redirected.headers.location).toBeUndefined();
    expect(test.fetcher).toHaveBeenCalledOnce();
    test.fetcher.mockResolvedValueOnce(Response.json({ error: upstreamKey }, { status: 400 }));
    const refused = await test.request("primary/responses", test.credentials.primary.token, nativeInput);
    expect(refused.statusCode).toBe(400);
    expect(refused.body).not.toContain(upstreamKey);
    expect(refused.json()).toEqual({ error: { code: "model_provider_invalid_request" } });
  });

  it.each([
    ["private-diagnostic", "model_provider_error"],
    ["insufficient_quota", "insufficient_quota"],
    ["invalid_prompt", "invalid_prompt"],
    ["budget_reached", "budget_reached"],
  ])("redacts provider diagnostics in SSE without losing the failed-response category", async (given, expected) => {
    const test = await fixture();
    test.fetcher.mockResolvedValueOnce(new Response([
      "event: response.created\ndata: {\"type\":\"response.created\"}\n\n",
      `event: response.failed\ndata: ${JSON.stringify({
        type: "response.failed",
        response: { error: { code: given, message: upstreamKey } },
      })}\n\n`,
      "data: [DONE]\n\n",
    ].join(""), { headers: { "content-type": "text/event-stream" } }));
    const response = await test.request("primary/responses", test.credentials.primary.token, nativeInput);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("response.created");
    expect(response.body).toContain(`"code":"${expected}"`);
    expect(response.body).toContain("data: [DONE]");
    expect(response.body).not.toContain(upstreamKey);
    expect(response.body).not.toContain("private-diagnostic");
  });

  it("limits concurrent calls to the same turn across Redis clients and releases the slot", async () => {
    const other = redis.client.duplicate();
    const turnId = randomUUID();
    const slots = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      reserveDesktopModelSlot(i % 2 === 0 ? redis.client : other, turnId)));
    const successful = slots.filter(slot => slot.status === "fulfilled");
    try {
      expect(successful).toHaveLength(4);
      await successful[0]?.value();
      const release = await reserveDesktopModelSlot(other, turnId);
      await release();
    } finally {
      await Promise.all(successful.map(slot => slot.value()));
      other.disconnect();
    }
  });

  it("limits a verified owner without pooling another owner behind the same proxies", async () => {
    const test = await fixture({ trustProxy: true });
    const other = await fixture({ trustProxy: true });
    const invoke = (attempt: typeof test, address: string, payload: Record<string, unknown>) => test.app.inject({
      method: "POST", url: `${endpoint}/${attempt.turnId}/primary/responses`, payload,
      headers: {
        authorization: `Bearer ${attempt.credentials.primary.token}`,
        [DESKTOP_MODEL_PURPOSE_HEADER]: "primary",
        "x-forwarded-for": `${address}, 192.0.2.1`,
      },
    });
    for (let index = 0; index < 90; index++) {
      expect((await invoke(test, `198.51.100.${index + 1}`, { ...nativeInput, store: true })).statusCode).toBe(400);
    }
    expect((await invoke(test, "203.0.113.1", nativeInput)).statusCode).toBe(429);
    expect((await invoke(other, "203.0.113.2", nativeInput)).statusCode).toBe(200);
    expect(test.fetcher).toHaveBeenCalledOnce();
  });

  it("terminates an authenticated request whose body stalls before parsing", async () => {
    const test = await fixture({ deadline: 150 });
    const server = await test.app.listen({ host: "127.0.0.1", port: 0 });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${server}${endpoint}/${test.turnId}/primary/responses`, {
        method: "POST", signal: AbortSignal.timeout(2_000), headers: {
          "content-type": "application/json", "content-length": "400",
          authorization: `Bearer ${test.credentials.primary.token}`, [DESKTOP_MODEL_PURPOSE_HEADER]: "primary",
        },
      }, response => {
        response.resume().once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
      request.write("{");
    });
    expect(status).toBe(408);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("uses the same deadline for a delayed upload and a stalled provider", async () => {
    const test = await fixture({ deadline: 300 });
    let upstreamAborted = false;
    test.fetcher.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        upstreamAborted = true;
        reject(init.signal?.reason);
      }, { once: true });
    }));
    const server = await test.app.listen({ host: "127.0.0.1", port: 0 });
    const body = JSON.stringify(nativeInput);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${server}${endpoint}/${test.turnId}/primary/responses`, {
        method: "POST", signal: AbortSignal.timeout(2_000), headers: {
          "content-type": "application/json", "content-length": Buffer.byteLength(body),
          authorization: `Bearer ${test.credentials.primary.token}`, [DESKTOP_MODEL_PURPOSE_HEADER]: "primary",
        },
      }, response => {
        response.resume().once("end", () => resolve(response.statusCode));
      });
      request.once("error", reject);
      request.write(body.slice(0, 1));
      void delay(100).then(() => request.end(body.slice(1))).catch(reject);
    });
    expect(status).toBe(504);
    expect(test.fetcher).toHaveBeenCalledOnce();
    expect(upstreamAborted).toBe(true);
  });

  it.each(["run", "device", "connection", "replacement"])("cancels an active response on %s revocation before the sweep", async type => {
    const test = await fixture();
    let sourceSignal: AbortSignal | null | undefined;
    test.fetcher.mockImplementationOnce(async (_input, init) => {
      sourceSignal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(Buffer.from("event: response.created\ndata: {}\n\n"));
          init?.signal?.addEventListener("abort", () => stream.close(), { once: true });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    });
    const server = await test.app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(`${server}${endpoint}/${test.turnId}/primary/responses`, {
      method: "POST", headers: {
        "content-type": "application/json", authorization: `Bearer ${test.credentials.primary.token}`,
        [DESKTOP_MODEL_PURPOSE_HEADER]: "primary",
      }, body: JSON.stringify(nativeInput), signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing fixture response body");
    expect((await reader.read()).done).toBe(false);
    const publisher = redis.client.duplicate();
    try {
      const coordinator = new RedisDesktopDeviceCoordinator(publisher);
      if (type === "run") await new DesktopRunLeases(publisher, async () => true).revoke(test.turnId);
      else if (type === "device") await coordinator.revoke(test.binding.deviceId);
      else if (type === "connection") await coordinator.disconnect(test.binding.deviceId, test.binding.connectionId);
      else await coordinator.connect(test.binding.deviceId, randomUUID());
      await vi.waitFor(() => expect(sourceSignal?.aborted).toBe(true), { timeout: 750 });
    } finally {
      publisher.disconnect();
    }
    await expect(reader.read()).rejects.toThrow();
    reader.releaseLock();
  });
});
