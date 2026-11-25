import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import {
  DESKTOP_MODEL_PROXY_PATH,
  DESKTOP_MODEL_PURPOSE_HEADER,
  modelImageOmittedPlaceholder,
  type ModelServiceProvider,
  type PrivacyMaskingRuntime,
} from "@linksense/shared";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { DesktopRunLeases } from "../src/modules/desktop-credentials/run-leases.js";
import { RedisDesktopDeviceCoordinator } from "../src/modules/desktop-devices/coordinator.js";
import { projectModelProxyRequest } from "../src/modules/model-proxy/request.js";
import { reserveDesktopModelSlot } from "../src/modules/model-proxy/request-slots.js";
import { desktopModelProxyRoutes } from "../src/modules/model-proxy/routes.js";
import type { DesktopProviderUsageRecorder } from "../src/modules/usage/model-usage.js";
import { createRedisFixture } from "./fixtures/redis.js";

const upstreamKey = "synthetic-provider-key";
const nativeInput = { model: "native-fixture", input: "fixture prompt", stream: true };
const chatInput = { model: "memory-fixture", messages: [{ role: "user", content: "fixture history" }] };
const nativeCompactionMetadata = JSON.stringify({
  request_kind: "compaction",
  compaction: {
    implementation: "responses",
    strategy: "memento",
    trigger: "manual",
    reason: "user_requested",
    phase: "standalone_turn",
  },
});
const nativeCompactionPrompt = [
  "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.",
  "",
  "Include:",
  "- Current progress and key decisions made",
  "- Important context, constraints, or user preferences",
  "- What remains to be done (clear next steps)",
  "- Any critical data, examples, or references needed to continue",
  "",
  "Be concise, structured, and focused on helping the next LLM seamlessly continue the work.",
  "",
].join("\n");
/** Synthetic 2x3 PNG shared with the checked-in computer-use fixture. */
const fallbackPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII=";
const screenshot = { type: "input_image", image_url: `data:image/png;base64,${fallbackPng}` };
/** Codex 0.170 tool output: the screenshot is an image part nested in the call result. */
const toolOutputInput = [
  { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect the app" }] },
  { type: "function_call", call_id: "call_capture", name: "computer_observe", arguments: "{}" },
  {
    type: "function_call_output", call_id: "call_capture",
    output: [{ type: "input_text", text: "Screenshot captured" }, screenshot],
  },
  { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
] as const;
/** Same runtime shape as the runner's privacy-masking fixture, enabled by presence. */
const maskingRuntime: PrivacyMaskingRuntime = {
  revision: 1,
  secrets: true,
  personal: false,
  kinds: {},
  words: [],
  words_any_case: true,
  words_whole: true,
  actions: {},
  allow: [],
  placeholder_key: "0".repeat(64),
};
const endpoint = DESKTOP_MODEL_PROXY_PATH;
const admissionPricing = {
  input_price_per_million: "10",
  cached_input_price_per_million: "2",
  output_price_per_million: "20",
} as const;
let redis: Awaited<ReturnType<typeof createRedisFixture>>;
const applications: ReturnType<typeof Fastify>[] = [];

beforeAll(async () => { redis = await createRedisFixture(); });
afterEach(async () => { await Promise.all(applications.splice(0).map(app => app.close())); });
afterAll(async () => { await redis?.close(); });

async function fixture(options: { deadline?: number; trustProxy?: boolean } = {}) {
  const ownerId = randomUUID();
  const turnId = randomUUID();
  const conversationId = randomUUID();
  const runtimeGeneration = randomUUID();
  const binding = { deviceId: randomUUID(), connectionId: randomUUID() };
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  await coordinator.connect(binding.deviceId, binding.connectionId);
  const leases = new DesktopRunLeases(redis.client, scope => coordinator.isCurrentConnection(scope.deviceId, scope.connectionId));
  const credentials = await leases.issue(binding, {
    ownerId,
    conversationId,
    projectionTurnId: turnId,
    expectedRuntimeGeneration: runtimeGeneration,
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
  const resolveDesktopProxyProvider = vi.fn<(input: unknown) => Promise<{
    baseUrl: string; apiKey: string; supportsImageInput: boolean;
    provider: ModelServiceProvider; pricing: typeof admissionPricing;
  }>>(async () => ({
    baseUrl: "https://server-configured.example.test/v1", apiKey: upstreamKey, supportsImageInput: false,
    provider: "openai", pricing: admissionPricing,
  }));
  const assertCanStartTask = vi.fn<(ownerId: string) => Promise<void>>(async () => undefined);
  const runtimeForUser = vi.fn<(userId: string) => Promise<PrivacyMaskingRuntime | undefined>>(
    async () => undefined,
  );
  const recordDesktopProviderUsage = vi.fn<
    DesktopProviderUsageRecorder["recordDesktopProviderUsage"]
  >(async () => ({ recorded: true }));
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
    privacyMasking: { runtimeForUser },
    usage: { recordDesktopProviderUsage }, fetcher,
  });
  return {
    app, binding, credentials, turnId, conversationId, runtimeGeneration, ownerId, leases, fetcher, resolveDesktopProxyProvider, assertCanStartTask,
    recordDesktopProviderUsage, runtimeForUser,
    request: (
      route: string,
      token: string,
      payload: Record<string, unknown>,
      purpose = route.split("/")[0],
      headers: Record<string, string> = {},
    ) => app.inject({
      method: "POST", url: `${endpoint}/${turnId}/${route}`, payload,
      headers: {
        authorization: `Bearer ${token}`,
        [DESKTOP_MODEL_PURPOSE_HEADER]: purpose,
        ...headers,
      },
    }),
  };
}

describe("desktop model proxy", () => {
  it("replaces image parts for text-only models and preserves them for image-capable models", async () => {
    const test = await fixture();
    const token = test.credentials.primary.token;
    const image = {
      type: "input_image",
      image_url: "data:image/png;base64,AAAA",
    };
    const input = [{
      type: "message", role: "user",
      content: [{ type: "input_text", text: "look" }, image],
    }];

    expect((await test.request("primary/responses", token, { ...nativeInput, input })).statusCode).toBe(200);
    const textOnly = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    expect(JSON.stringify(textOnly)).not.toContain("base64");
    expect(textOnly.input[0].content[1]).toEqual({
      type: "input_text",
      text: modelImageOmittedPlaceholder,
    });

    test.resolveDesktopProxyProvider.mockResolvedValueOnce({
      baseUrl: "https://server-configured.example.test/v1",
      apiKey: upstreamKey,
      supportsImageInput: true,
      provider: "openai",
      pricing: admissionPricing,
    });
    expect((await test.request("primary/responses", token, { ...nativeInput, input })).statusCode).toBe(200);
    const withImages = JSON.parse(String(test.fetcher.mock.calls[1]?.[1]?.body));
    expect(withImages.input[0].content[1]).toEqual(image);
  });

  it("applies the nested tool-output image policy and denies only the masking-enabled bound owner", async () => {
    const test = await fixture();
    const token = test.credentials.primary.token;
    const payload = { ...nativeInput, stream: false, input: toolOutputInput };

    // 1. The default provider is text-only: replace only the nested image
    // part, leaving text, call_id, and ordering intact.
    expect((await test.request("primary/responses", token, payload)).statusCode).toBe(200);
    const textOnly = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    expect(textOnly.input).toEqual([
      toolOutputInput[0],
      toolOutputInput[1],
      {
        type: "function_call_output", call_id: "call_capture",
        output: [
          { type: "input_text", text: "Screenshot captured" },
          { type: "input_text", text: modelImageOmittedPlaceholder },
        ],
      },
      toolOutputInput[3],
    ]);
    expect(JSON.stringify(textOnly)).not.toContain(fallbackPng);

    // 2. The same payload and lease reach an image-capable provider while
    // masking stays off: the nested input is forwarded exactly and the
    // established non-stream response records real fixture usage.
    test.resolveDesktopProxyProvider.mockResolvedValue({
      baseUrl: "https://server-configured.example.test/v1", apiKey: upstreamKey,
      supportsImageInput: true, provider: "openai", pricing: admissionPricing,
    });
    test.fetcher.mockImplementationOnce(async () => Response.json({
      object: "response",
      status: "completed",
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    }));
    expect((await test.request("primary/responses", token, payload)).statusCode).toBe(200);
    expect(JSON.parse(String(test.fetcher.mock.calls[1]?.[1]?.body)).input).toEqual(toolOutputInput);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "primary",
      ownerId: test.ownerId,
      model: nativeInput.model,
      tokenUsage: {
        totalTokens: 10,
        inputTokens: 7,
        cachedInputTokens: 0,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
      pricing: admissionPricing,
    }));

    // 3. Same payload, lease, and provider; only the bound owner's masking
    // policy changes, so the proxy denies before any further fetch or usage.
    test.runtimeForUser.mockImplementation(async userId => userId === test.ownerId ? maskingRuntime : undefined);
    const denied = await test.request("primary/responses", token, payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error_code: "FORBIDDEN" });
    expect(test.fetcher).toHaveBeenCalledTimes(2);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(denied.body).not.toContain(fallbackPng);
    expect(denied.body).not.toContain(token);
    expect(denied.body).not.toContain(upstreamKey);
    expect(test.runtimeForUser.mock.calls).toEqual([[test.ownerId], [test.ownerId], [test.ownerId]]);
  });

  it("forwards a bounded native preloaded tool output without a call ID", async () => {
    const test = await fixture();
    const input = [{
      type: "function_call_output", name: "read_skill", namespace: "skills",
      output: [{ type: "input_text", text: "Fixture skill instructions" }],
    }];
    const token = test.credentials.primary.token;
    expect((await test.request("primary/responses", token, { ...nativeInput, input })).statusCode).toBe(200);
    expect(JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ input });
    expect((await test.request("primary/responses", token, {
      ...nativeInput, input: [{ ...input[0], headers: { authorization: "test-only" } }],
    })).statusCode).toBe(400);
    expect(test.fetcher).toHaveBeenCalledOnce();
  });

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

  it("accepts transition-source compaction marked by native turn metadata", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    const result = await test.request("transition_source/responses", source.token, {
      model: source.model,
      stream: true,
      input: [{
        type: "message", role: "user",
        content: [{ type: "input_text", text: "native compaction prompt" }],
      }],
      client_metadata: { "x-codex-turn-metadata": nativeCompactionMetadata },
    }, "transition_source");
    expect(result.statusCode).toBe(200);
    expect(test.fetcher).toHaveBeenCalledOnce();
  });

  it("rejects transition-source compaction marked only by the turn metadata header", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    const result = await test.request("transition_source/responses", source.token, {
      model: source.model,
      stream: true,
      input: [{
        type: "message", role: "user",
        content: [{ type: "input_text", text: "native compaction prompt" }],
      }],
    }, "transition_source", { "x-codex-turn-metadata": nativeCompactionMetadata });
    expect(result.statusCode).toBe(403);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("keeps accepting the pinned native compaction prompt", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    const result = await test.request("transition_source/responses", source.token, {
      model: source.model,
      stream: true,
      input: [{
        type: "message", role: "user",
        content: [{ type: "input_text", text: nativeCompactionPrompt }],
      }],
    }, "transition_source");
    expect(result.statusCode).toBe(200);
    expect(test.fetcher).toHaveBeenCalledOnce();
  });

  it("rejects transition-source metadata for a non-manual compaction phase", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    const result = await test.request("transition_source/responses", source.token, {
      model: source.model,
      stream: true,
      input: [{
        type: "message", role: "user",
        content: [{ type: "input_text", text: "native compaction prompt" }],
      }],
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "compaction",
          compaction: {
            implementation: "responses",
            strategy: "memento",
            trigger: "auto",
            reason: "model_downshift",
            phase: "pre_turn",
          },
        }),
      },
    }, "transition_source");
    expect(result.statusCode).toBe(403);
    expect(test.fetcher).not.toHaveBeenCalled();
  });

  it("accepts chat-completions transition compaction from turn metadata", () => {
    const result = projectModelProxyRequest(
      "chat/completions",
      {
        model: "previous-fixture",
        stream: true,
        messages: [{ role: "user", content: "native compaction prompt" }],
      },
      "transition_source",
      nativeCompactionMetadata,
    );
    expect(result.stream).toBe(true);
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

  it("records one exact native usage record when the terminal frame is duplicated", async () => {
    const test = await fixture();
    const usage = {
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens_details: { reasoning_tokens: 3 },
    };
    const completed = `data: ${JSON.stringify({
      type: "response.completed", response: { status: "completed", usage },
    })}\n\n`;
    test.fetcher.mockImplementationOnce(async () => new Response(
      `${completed}${completed}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    const response = await test.request(
      "primary/responses", test.credentials.primary.token, nativeInput,
    );
    expect(response.statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith({
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      purpose: "primary",
      ownerId: test.ownerId,
      conversationId: test.conversationId,
      turnId: test.turnId,
      runtimeGeneration: test.runtimeGeneration,
      model: nativeInput.model,
      tokenUsage: {
        totalTokens: 30,
        inputTokens: 20,
        cachedInputTokens: 5,
        outputTokens: 10,
        reasoningOutputTokens: 3,
      },
      pricing: admissionPricing,
    });
  });

  it("bounds a failed usage persistence attempt to one per proxy request", async () => {
    const test = await fixture();
    test.recordDesktopProviderUsage.mockResolvedValueOnce({
      recorded: false, reason_code: "TURN_PROJECTION_PENDING",
    });
    const completed = `data: ${JSON.stringify({
      type: "response.completed",
      response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
    })}\n\n`;
    test.fetcher.mockImplementationOnce(async () => new Response(
      `${completed}${completed}data: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    expect((await test.request(
      "primary/responses", test.credentials.primary.token, nativeInput,
    )).statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
  });

  it("records the terminal chat completion usage before forwarding it", async () => {
    const test = await fixture();
    test.resolveDesktopProxyProvider.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1", apiKey: upstreamKey, supportsImageInput: false,
      provider: "openai", pricing: admissionPricing,
    });
    const usage = {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      prompt_tokens_details: { cached_tokens: 2 },
      completion_tokens_details: { reasoning_tokens: 1 },
    };
    // Duplicate terminal usage chunks must still produce one record.
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "fixture" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [], usage })}\n\n` +
      `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");
    const response = await test.request(
      "memory_extraction/chat/completions",
      memory.token,
      { ...chatInput, stream: true },
      "memory_extraction",
    );
    expect(response.statusCode).toBe(200);
    const upstreamBody = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    expect(upstreamBody.stream_options).toEqual({ include_usage: true });
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "memory_extraction",
      ownerId: test.ownerId,
      conversationId: test.conversationId,
      turnId: test.turnId,
      runtimeGeneration: test.runtimeGeneration,
      model: chatInput.model,
      tokenUsage: {
        totalTokens: 16,
        inputTokens: 12,
        cachedInputTokens: 2,
        outputTokens: 4,
        reasoningOutputTokens: 1,
      },
      pricing: admissionPricing,
    }));
  });

  it("records transition-source compaction usage with the bound source model", async () => {
    const test = await fixture();
    const source = test.credentials.transition_source;
    if (!source) throw new Error("Missing fixture transition grant");
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        },
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    const result = await test.request("transition_source/responses", source.token, {
      model: source.model,
      stream: true,
      input: [{
        type: "message", role: "user",
        content: [{ type: "input_text", text: nativeCompactionPrompt }],
      }],
    }, "transition_source");
    expect(result.statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "transition_source",
      ownerId: test.ownerId,
      conversationId: test.conversationId,
      turnId: test.turnId,
      runtimeGeneration: test.runtimeGeneration,
      model: source.model,
      tokenUsage: {
        totalTokens: 6,
        inputTokens: 4,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 0,
      },
      pricing: admissionPricing,
    }));
  });

  it("records exact usage from a non-stream JSON response", async () => {
    const test = await fixture();
    test.fetcher.mockImplementationOnce(async () => Response.json({
      object: "response",
      status: "completed",
      usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
    }));

    const response = await test.request(
      "primary/responses",
      test.credentials.primary.token,
      { ...nativeInput, stream: false },
    );
    expect(response.statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "primary",
      runtimeGeneration: test.runtimeGeneration,
      model: nativeInput.model,
      tokenUsage: {
        totalTokens: 10,
        inputTokens: 7,
        cachedInputTokens: 0,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
      pricing: admissionPricing,
    }));
  });

  it.each([
    ["missing", {}],
    ["invalid", { usage: { input_tokens: -1, output_tokens: 3, total_tokens: 2 } }],
    ["subset-invalid", { usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3, input_tokens_details: { cached_tokens: 3 } } }],
  ])("does not invent usage when terminal usage is %s", async (_label, response) => {
    const test = await fixture();
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({
        type: "response.completed", response: { status: "completed", ...response },
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    expect((await test.request(
      "primary/responses", test.credentials.primary.token, nativeInput,
    )).statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).not.toHaveBeenCalled();
  });

  it("does not inject stream usage into an unverified provider", async () => {
    const test = await fixture();
    test.resolveDesktopProxyProvider.mockResolvedValueOnce({
      baseUrl: "https://server-configured.example.test/v1",
      apiKey: upstreamKey,
      supportsImageInput: false,
      provider: "openai_compatible",
      pricing: admissionPricing,
    });
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "fixture" } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");

    const response = await test.request(
      "memory_extraction/chat/completions", memory.token,
      { ...chatInput, stream: true }, "memory_extraction",
    );
    expect(response.statusCode).toBe(200);
    const upstreamBody = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    expect(upstreamBody.stream_options).toBeUndefined();
    expect(test.recordDesktopProviderUsage).not.toHaveBeenCalled();
  });

  it("injects stream usage only for the official vendor endpoint", async () => {
    const test = await fixture();
    const usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 };
    test.resolveDesktopProxyProvider
      .mockResolvedValueOnce({
        baseUrl: "https://api.openai.com/v1", apiKey: upstreamKey,
        supportsImageInput: false, provider: "openai", pricing: admissionPricing,
      })
      .mockResolvedValueOnce({
        baseUrl: "https://compatible.example.test/v1", apiKey: upstreamKey,
        supportsImageInput: false, provider: "openai", pricing: admissionPricing,
      });
    test.fetcher.mockImplementation(async () => new Response(
      `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");
    const request = () => test.request(
      "memory_extraction/chat/completions", memory.token,
      { ...chatInput, stream: true }, "memory_extraction",
    );

    expect((await request()).statusCode).toBe(200);
    expect((await request()).statusCode).toBe(200);
    const officialBody = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    const compatibleBody = JSON.parse(String(test.fetcher.mock.calls[1]?.[1]?.body));
    expect(officialBody.stream_options).toEqual({ include_usage: true });
    expect(compatibleBody.stream_options).toBeUndefined();
    // A compatible endpoint that returns usage still records it exactly.
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledTimes(2);
  });

  it("does not record a supported chat stream that ends without usage", async () => {
    const test = await fixture();
    test.resolveDesktopProxyProvider.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1", apiKey: upstreamKey, supportsImageInput: false,
      provider: "openai", pricing: admissionPricing,
    });
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "fixture" } }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");

    const response = await test.request(
      "memory_extraction/chat/completions", memory.token,
      { ...chatInput, stream: true }, "memory_extraction",
    );
    expect(response.statusCode).toBe(200);
    const upstreamBody = JSON.parse(String(test.fetcher.mock.calls[0]?.[1]?.body));
    expect(upstreamBody.stream_options).toEqual({ include_usage: true });
    expect(test.recordDesktopProviderUsage).not.toHaveBeenCalled();
  });

  it("persists confirmed chat usage before an early downstream disconnect", async () => {
    const test = await fixture();
    const usage = { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 };
    test.fetcher.mockImplementationOnce(async (_input, init) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from(
            `data: ${JSON.stringify({ choices: [], usage })}\n\n`,
          ));
          init?.signal?.addEventListener("abort", () => {
            try { controller.close(); } catch { /* already closed */ }
          }, { once: true });
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ));
    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");
    const server = await test.app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(
      `${server}${endpoint}/${test.turnId}/memory_extraction/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${memory.token}`,
          [DESKTOP_MODEL_PURPOSE_HEADER]: "memory_extraction",
        },
        body: JSON.stringify({ ...chatInput, stream: true }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing fixture response body");
    expect((await reader.read()).done).toBe(false);
    await vi.waitFor(() => expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce());
    await reader.cancel();
    reader.releaseLock();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "memory_extraction",
      runtimeGeneration: test.runtimeGeneration,
      model: chatInput.model,
      tokenUsage: {
        totalTokens: 12,
        inputTokens: 9,
        cachedInputTokens: 0,
        outputTokens: 3,
        reasoningOutputTokens: 0,
      },
      pricing: admissionPricing,
    }));
  });

  it("records valid usage reported by a failed native response", async () => {
    const test = await fixture();
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({
        type: "response.failed",
        response: {
          status: "failed",
          usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
        },
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));

    const response = await test.request(
      "primary/responses", test.credentials.primary.token, nativeInput,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("response.failed");
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledOnce();
    expect(test.recordDesktopProviderUsage).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "primary",
      runtimeGeneration: test.runtimeGeneration,
      model: nativeInput.model,
      tokenUsage: {
        totalTokens: 7,
        inputTokens: 5,
        cachedInputTokens: 0,
        outputTokens: 2,
        reasoningOutputTokens: 0,
      },
      pricing: admissionPricing,
    }));
  });

  it("does not record malformed chat usage", async () => {
    const test = await fixture();
    test.fetcher.mockImplementationOnce(async () => new Response(
      `data: ${JSON.stringify({
        choices: [],
        usage: { prompt_tokens: "invalid", completion_tokens: 2, total_tokens: 2 },
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ));
    const memory = test.credentials.memory_extraction;
    if (!memory) throw new Error("Missing fixture memory credential");

    const response = await test.request(
      "memory_extraction/chat/completions", memory.token,
      { ...chatInput, stream: true }, "memory_extraction",
    );
    expect(response.statusCode).toBe(200);
    expect(test.recordDesktopProviderUsage).not.toHaveBeenCalled();
  });
});
