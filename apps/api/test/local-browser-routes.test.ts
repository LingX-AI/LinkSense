import Fastify from "fastify";
import { WebSocket } from "ws";
import { once } from "node:events";
import type { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { localBrowserPairResponseSchema, localizedErrorMessage, supportedLocales } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { registerLocalBrowserRoutes } from "../src/modules/local-browser/routes.js";
import { LocalBrowserService } from "../src/modules/local-browser/service.js";
import { sendAppError } from "../src/lib/http.js";
import { AppError } from "../src/lib/errors.js";
import { MemoryBrowserStore } from "./local-browser-store.js";
import { createRedisFixture } from "./fixtures/redis.js";

const owner = "10000000-0000-4000-8000-000000000001";
const task = "20000000-0000-4000-8000-000000000001";
const turnId = "30000000-0000-4000-8000-000000000001";
const authDate = new Date("2026-01-01T00:00:00.000Z");
const apps: ReturnType<typeof Fastify>[] = [];
let redis: Redis;
let redisFixture: Awaited<ReturnType<typeof createRedisFixture>>;
beforeAll(async () => {
  redisFixture = await createRedisFixture();
  redis = redisFixture.client;
});
beforeEach(async () => {
  await redis.flushdb();
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
afterAll(async () => {
  await redisFixture?.close();
});
async function fixture(
  endpoint = "http://127.0.0.1/api/v1/local-browser",
  rateLimitRedis = redis,
) {
  const app = Fastify();
  apps.push(app);
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== "Bearer user")
      throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: owner,
      email: "user@example.test",
      name: "User",
      role: "user",
      status: "active",
      preferredLocale: null,
      avatarObjectKey: null,
      authValidAfter: authDate,
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  const prisma = {
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: task }) },
    conversationTurn: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: turnId, collaborationMode: "default" }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: owner,
        status: "active",
        authValidAfter: authDate,
      }),
    },
  };
  const service = new LocalBrowserService(
    new MemoryBrowserStore(),
    endpoint,
  );
  const intent = { detect: vi.fn().mockResolvedValue(true) };
  await registerLocalBrowserRoutes(app, {
    redis: rateLimitRedis,
    rateLimitHmacSecret: "test-local-browser-rate-limit-secret",
    service,
    prisma: prisma as unknown as PrismaClient,
    sharedSecret: "runner-secret",
    socketPath: "/api/v1/local-browser/socket",
    intent,
  });
  await app.ready();
  return { app, service, prisma, intent };
}
it("requires login for browser settings and returns uncached status", async () => {
  const { app } = await fixture();
  expect(
    (await app.inject({ method: "GET", url: "/api/v1/local-browser" }))
      .statusCode,
  ).toBe(401);
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/local-browser",
    headers: { authorization: "Bearer user" },
  });
  expect(response.json()).toMatchObject({ data: { connected: false } });
  expect(response.headers["cache-control"]).toBe("private, no-store");
});
it.each([
  ["x".repeat(43), 401],
  ["bad", 400],
])("blocks pairing after ten failed attempts with code %s without consuming a valid pairing code", async (code, status) => {
  const { app, service } = await fixture();
  const pair = (code: string) => app.inject({
    method: "POST",
    url: "/api/v1/local-browser/pair",
    payload: { code },
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    expect((await pair(code)).statusCode).toBe(status);
  }
  const pairing = await service.pairing(owner, authDate.toISOString());
  const response = await pair(pairing.code);
  expect(response.statusCode).toBe(429);
  expect(response.json()).toMatchObject({
    success: false,
    error_code: "LOCAL_BROWSER_PAIR_RATE_LIMITED",
  });
  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  expect(response.headers["cache-control"]).toBe("no-store");
  const allowed = await app.inject({
    method: "POST", url: "/api/v1/local-browser/pair",
    remoteAddress: "192.0.2.2", payload: { code: pairing.code },
  });
  expect(allowed.statusCode).toBe(200);
  const credential = localBrowserPairResponseSchema.parse(allowed.json());
  expect(await service.authenticate(credential.token)).toMatchObject({ owner });
});
it("shares the pairing quota across API instances and resets it after the fixed window", async ({ onTestFinished }) => {
  const secondRedis = redis.duplicate();
  onTestFinished(async () => { await secondRedis.quit(); });
  const first = await fixture();
  const second = await fixture(undefined, secondRedis);
  const responses = await Promise.all(Array.from({ length: 11 }, (_, index) =>
    (index % 2 === 0 ? first.app : second.app).inject({
      method: "POST",
      url: "/api/v1/local-browser/pair",
      remoteAddress: index % 2 === 0 ? "192.0.2.1" : "::ffff:192.0.2.1",
      headers: { "x-forwarded-for": `198.51.100.${index}` },
      payload: { code: String(index).padStart(43, "x") },
    }),
  ));
  expect(responses.map((response) => response.statusCode).sort()).toEqual([
    ...Array.from({ length: 10 }, () => 401), 429,
  ]);
  const keys = await redis.keys("linksense:local-browser-pair-rate:*");
  expect(keys).toHaveLength(1);
  expect(keys[0]).not.toContain("192.0.2.1");
  expect(await redis.pttl(keys[0]!)).toBeGreaterThan(0);
  expect(await redis.pttl(keys[0]!)).toBeLessThanOrEqual(60_000);
  await redis.pexpire(keys[0]!, 0);
  const pairing = await first.service.pairing(owner, authDate.toISOString());
  const response = await first.app.inject({
    method: "POST", url: "/api/v1/local-browser/pair",
    remoteAddress: "192.0.2.1", payload: { code: pairing.code },
  });
  expect(response.statusCode).toBe(200);
  const { token, owner_id, approval_id } = localBrowserPairResponseSchema.parse(response.json());
  expect(owner_id).toBe(owner);
  expect(approval_id).toEqual(expect.any(String));
  expect(await first.service.authenticate(token)).toMatchObject({ owner, approval_id });
});
it.each([...supportedLocales, "de-DE"] as const)("returns a localized pairing limit error for %s", async (locale) => {
  const { app } = await fixture();
  const pair = () => app.inject({
    method: "POST", url: "/api/v1/local-browser/pair",
    headers: { "accept-language": locale }, payload: { code: "x".repeat(43) },
  });
  for (let attempt = 0; attempt < 10; attempt += 1) await pair();
  const response = await pair();
  expect(response.statusCode).toBe(429);
  expect(response.json()).toMatchObject({
    error_code: "LOCAL_BROWSER_PAIR_RATE_LIMITED",
    message: localizedErrorMessage("LOCAL_BROWSER_PAIR_RATE_LIMITED", locale === "de-DE" ? "zh-CN" : locale),
  });
});
it("rejects pairing when Redis is unavailable without consuming the pairing code", async () => {
  const unavailableRedis = redis.duplicate({ lazyConnect: true, enableOfflineQueue: false });
  unavailableRedis.disconnect();
  const { app, service } = await fixture(undefined, unavailableRedis);
  const pair = vi.spyOn(service, "pair");
  const pairing = await service.pairing(owner, authDate.toISOString());
  const response = await app.inject({
    method: "POST", url: "/api/v1/local-browser/pair", payload: { code: pairing.code },
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toMatchObject({ error_code: "INTERNAL_ERROR" });
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(pair).not.toHaveBeenCalled();
});
it("authenticates and validates the boolean intent request before calling the classifier", async () => {
  const { app, intent } = await fixture();
  const url = `/api/v1/conversations/${task}/browser-use-intent`;
  const payload = { message_id: turnId };
  expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
  expect((await app.inject({ method: "POST", url, headers: { authorization: "Bearer user" }, payload: { message_id: "bad" } })).statusCode).toBe(400);
  expect(intent.detect).not.toHaveBeenCalled();
  const response = await app.inject({ method: "POST", url, headers: { authorization: "Bearer user" }, payload });
  expect(response.json()).toMatchObject({ data: true });
  expect(response.headers["cache-control"]).toBe("private, no-store");
  expect(intent.detect).toHaveBeenCalledExactlyOnceWith(owner, task, turnId);
});
it.each([
  ["http://127.0.0.1:5273", "http://127.0.0.1:5273"],
  ["http://[::1]:5273", "http://[::1]:5273"],
  ["http://localhost:5273", "http://localhost:5273"],
  [undefined, "http://localhost:5273"],
  ["http://127.0.0.1:5274", "http://localhost:5273"],
  ["https://127.0.0.1:5273", "http://localhost:5273"],
  ["http://localhost.evil.example:5273", "http://localhost:5273"],
  ["http://other.example:5273", "http://localhost:5273"],
])("returns a same-origin pairing endpoint for the permitted loopback origin %s", async (origin, expectedOrigin) => {
  const { app, service } = await fixture("http://localhost:5273/api/v1/local-browser");
  const response = await app.inject({
    method: "POST", url: "/api/v1/local-browser/pairing",
    headers: {
      authorization: "Bearer user",
      host: "untrusted.example:5273",
      "x-forwarded-host": "untrusted.example:5273",
      ...(origin ? { origin } : {}),
    },
    payload: {},
  });
  expect(response.statusCode).toBe(200);
  const { data } = response.json<{ data: { code: string; endpoint: string } }>();
  expect(data.endpoint).toBe(`${expectedOrigin}/api/v1/local-browser`);
  const token = await service.pair(data.code);
  expect(await service.authenticate(token)).toMatchObject({ owner });
  expect(await service.status(owner)).toEqual({ connected: false });
  await service.connect(owner, token, "chrome");
  expect(await service.status(owner)).toMatchObject({ connected: true });
});
it.each(["https://other.example", "https://127.0.0.1", "http://localhost"])(
  "does not replace a production pairing endpoint with request origin %s",
  async (origin) => {
    const endpoint = "https://linksense.example/api/v1/local-browser";
    const { app } = await fixture(endpoint);
    const response = await app.inject({
      method: "POST", url: "/api/v1/local-browser/pairing",
      headers: { authorization: "Bearer user", origin }, payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: { endpoint } });
  },
);
it("checks runner identity, task ownership, running turn, user status and Plan restrictions", async () => {
  const { app, service, prisma } = await fixture();
  const execute = vi.spyOn(service, "execute");
  const call = (input: unknown, authorization = "Bearer runner-secret") =>
    app.inject({
      method: "POST",
      url: "/internal/local-browser/execute",
      headers: { authorization, "x-linksense-owner-id": owner },
      payload: { conversationId: task, turnId, input },
    });
  expect((await call({ action: "status" }, "Bearer invalid")).statusCode).toBe(
    401,
  );
  prisma.conversation.findFirst.mockResolvedValueOnce(null);
  expect((await call({ action: "status" })).statusCode).toBe(403);
  prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);
  expect((await call({ action: "status" })).statusCode).toBe(403);
  prisma.user.findUnique.mockResolvedValueOnce({ status: "disabled" });
  expect((await call({ action: "status" })).statusCode).toBe(403);
  prisma.conversationTurn.findFirst.mockResolvedValueOnce({
    id: turnId,
    collaborationMode: "plan",
  });
  expect(
    (await call({ action: "open", url: "https://example.test" })).json(),
  ).toMatchObject({ code: "LOCAL_BROWSER_ACCESS_DENIED" });
  expect(execute).not.toHaveBeenCalled();
  expect(
    (await call({ action: "navigate", tab_id: 1, url: "file:///private" }))
      .statusCode,
  ).toBe(400);
  expect((await call({ action: "status" })).json()).toMatchObject({
    ok: true,
    data: { connected: false },
  });
});
it("denies published service sessions access to the publisher's personal browser", async () => {
  const { app, service } = await fixture();
  const execute = vi.spyOn(service, "execute");
  const response = await app.inject({
    method: "POST",
    url: "/internal/local-browser/execute",
    headers: {
      authorization: "Bearer runner-secret",
      "x-linksense-owner-id": owner,
      "x-linksense-service-session": "50000000-0000-4000-8000-000000000001",
    },
    payload: { conversationId: task, turnId, input: { action: "tabs" } },
  });
  expect(response.statusCode).toBe(403);
  expect(execute).not.toHaveBeenCalled();
});
it("authenticates extension sockets and revokes the connection across workers", async () => {
  const { app, service } = await fixture();
  const pairing = await service.pairing(owner, authDate.toISOString());
  const token = await service.pair(pairing.code);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(
    `${address.replace("http:", "ws:")}/api/v1/local-browser/socket`,
    { origin: `chrome-extension://${"a".repeat(32)}` },
  );
  await once(socket, "open");
  const ready = once(socket, "message");
  socket.send(JSON.stringify({ token, browser: "chrome" }));
  expect(JSON.parse(String((await ready)[0]))).toMatchObject({ type: "ready" });
  expect(await service.status(owner)).toMatchObject({ connected: true });
  const close = once(socket, "close");
  await service.revoke(owner);
  await vi.waitFor(async () =>
    expect(await service.status(owner)).toEqual({ connected: false }),
  );
  socket.close();
  await close;
});

it("rejects a normal webpage origin and an expired account authentication version", async () => {
  const { app, service, prisma } = await fixture();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const url = `${address.replace("http:", "ws:")}/api/v1/local-browser/socket`;
  const webpage = new WebSocket(url, { origin: "https://untrusted.example" });
  await once(webpage, "error");
  const pairing = await service.pairing(owner, authDate.toISOString());
  const token = await service.pair(pairing.code);
  prisma.user.findUnique.mockResolvedValue({
    id: owner,
    status: "active",
    authValidAfter: new Date("2026-02-01T00:00:00.000Z"),
  });
  const socket = new WebSocket(url, {
    origin: `chrome-extension://${"a".repeat(32)}`,
  });
  await once(socket, "open");
  const closed = once(socket, "close");
  socket.send(JSON.stringify({ token, browser: "chrome" }));
  expect((await closed)[0]).toBe(4403);
  expect(await service.status(owner)).toEqual({ connected: false });
});

it.each(["cancel", "revoke"])("notifies the extension after %s invalidates a dispatched command and never resends it", async (operation) => {
  const { app, service } = await fixture();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const pairing = await service.pairing(owner, authDate.toISOString());
  const token = await service.pair(pairing.code);
  const socket = new WebSocket(
    `${address.replace("http:", "ws:")}/api/v1/local-browser/socket`,
    { origin: `chrome-extension://${"a".repeat(32)}` },
  );
  await once(socket, "open");
  const ready = once(socket, "message");
  socket.send(JSON.stringify({ token, browser: "chrome" }));
  await ready;
  const controller = new AbortController();
  const delivery = once(socket, "message");
  const running = service.execute(
    owner,
    task,
    { action: "open", url: "https://example.test" },
    controller.signal,
  );
  const command = JSON.parse(String((await delivery)[0])) as { id: string };
  const cancellation = once(socket, "message");
  if (operation === "cancel") controller.abort();
  else await service.revoke(owner);
  expect(await running).toMatchObject({
    code: operation === "cancel" ? "LOCAL_BROWSER_CANCELLED" : "LOCAL_BROWSER_NOT_CONNECTED",
  });
  expect(JSON.parse(String((await cancellation)[0]))).toEqual({
    type: "cancel",
    id: command.id,
  });
  expect(await service.activeCommand(owner)).toBeNull();
  socket.close();
});
