import Fastify from "fastify";
import { once } from "node:events";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopDeviceServerFrameSchema } from "@linksense/shared";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { RedisDesktopDeviceCoordinator } from "../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { MemoryDesktopDeviceRepository } from "./desktop-devices.fixture.js";
import { createRedisFixture } from "./fixtures/redis.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const headers = { authorization: "Bearer user" };
const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };
let redis: Awaited<ReturnType<typeof createRedisFixture>>;
const applications: ReturnType<typeof Fastify>[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(applications.splice(0).map(app => app.close()));
  vi.restoreAllMocks();
});
afterAll(async () => { await redis.close(); });

async function fixture(repository = new MemoryDesktopDeviceRepository()) {
  for (const id of [owner, other]) repository.owners.set(id, { status: "active", authValidAfter: new Date(0) });
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const service = new DesktopDeviceService(repository, coordinator);
  const app = Fastify();
  applications.push(app);
  app.decorate("authenticate", async request => {
    if (!["Bearer user", "Bearer other"].includes(request.headers.authorization ?? "")) throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: request.headers.authorization === "Bearer other" ? other : owner,
      name: "User", email: "user@example.test", role: "user", status: "active",
      preferredLocale: null, avatarObjectKey: null, authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  await registerDesktopDeviceRoutes(app, {
    service, redis: redis.client, rateLimitHmacSecret: "test-only-desktop-rate-limit-secret",
  });
  await app.ready();
  return { app, service, coordinator, repository };
}

async function paired(app: ReturnType<typeof Fastify>) {
  const pairing = await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} });
  expect(pairing.statusCode).toBe(200);
  const response = await app.inject({
    method: "POST", url: "/api/v1/desktop/devices/pair",
    payload: { ...registration, code: pairing.json().data.code },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { token: string; owner_id: string; device: { id: string } };
}

function nextFrame(socket: WebSocket) {
  return once(socket, "message").then(([data]) => desktopDeviceServerFrameSchema.parse(JSON.parse(String(data))));
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, resolve: () => release() };
}

async function connect(app: ReturnType<typeof Fastify>, token: string) {
  const address = app.server.listening
    ? `http://127.0.0.1:${(app.server.address() as import("node:net").AddressInfo).port}`
    : await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${address.replace(/^http/u, "ws")}/api/v1/desktop/devices/socket`);
  sockets.push(socket);
  await once(socket, "open");
  const ready = nextFrame(socket);
  socket.send(JSON.stringify({ type: "hello", token, protocol_version: 1 }));
  return { socket, ready: await ready };
}

describe("desktop device HTTP and WebSocket boundaries", () => {
  it("requires login, rejects spoofed ownership, consumes pairing once and redacts credentials", async () => {
    const { app, repository } = await fixture();
    expect((await app.inject("/api/v1/desktop/devices")).statusCode).toBe(401);
    const pairing = await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} });
    const code: string = pairing.json().data.code;
    const invalid = await app.inject({
      method: "POST", url: "/api/v1/desktop/devices/pair",
      payload: { ...registration, code, owner_id: other },
    });
    expect(invalid.statusCode).toBe(400);
    const result = await app.inject({
      method: "POST", url: "/api/v1/desktop/devices/pair", payload: { ...registration, code },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().data.owner_id).toBe(owner);
    expect((await app.inject({
      method: "POST", url: "/api/v1/desktop/devices/pair", payload: { ...registration, code },
    })).statusCode).toBe(401);
    const list = await app.inject({ url: "/api/v1/desktop/devices", headers });
    expect(list.json().data.items).toHaveLength(1);
    expect(list.body).not.toContain(result.json().data.token);
    expect(list.body).not.toContain([...repository.devices.values()][0]!.tokenHash);
    expect((await app.inject({ url: "/api/v1/desktop/devices", headers: { authorization: "Bearer other" } })).json().data.items).toEqual([]);
  });

  it("rate-limits code creation without throttling ordinary device status reads", async () => {
    const { app } = await fixture();
    for (let index = 0; index < 10; index++) {
      expect((await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} })).statusCode).toBe(429);
    for (let index = 0; index < 12; index++) {
      expect((await app.inject({ url: "/api/v1/desktop/devices", headers })).statusCode).toBe(200);
    }
  });

  it("authenticates and heartbeats, then revokes the socket from another API replica", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const device = await paired(first.app);
    const { socket, ready } = await connect(first.app, device.token);
    expect(ready).toMatchObject({ type: "ready", device_id: device.device.id });
    const pong = nextFrame(socket);
    socket.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toEqual({ type: "pong" });
    expect((await second.app.inject({ url: "/api/v1/desktop/devices", headers })).json().data.items[0].online).toBe(true);
    expect((await second.app.inject({
      method: "DELETE", url: `/api/v1/desktop/devices/${device.device.id}`, headers: { authorization: "Bearer other" },
    })).statusCode).toBe(403);
    const closed = once(socket, "close");
    expect((await second.app.inject({
      method: "DELETE", url: `/api/v1/desktop/devices/${device.device.id}`, headers,
    })).statusCode).toBe(200);
    expect((await closed)[0]).toBe(4403);
  });

  it("ignores delayed replacement notices for the already superseded socket", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const device = await paired(first.app);
    const initial = await connect(first.app, device.token);
    const closed = once(initial.socket, "close");
    const replacement = await connect(second.app, device.token);
    expect((await closed)[0]).toBe(4409);
    if (initial.ready.type !== "ready") throw new Error("missing initial ready frame");
    await redis.client.publish("linksense:desktop-devices:connections", JSON.stringify({
      type: "replaced", deviceId: device.device.id, supersededConnectionId: initial.ready.connection_id,
    }));
    const pong = nextFrame(replacement.socket);
    replacement.socket.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toEqual({ type: "pong" });
    expect((await second.app.inject({ url: "/api/v1/desktop/devices", headers })).json().data.items[0].online).toBe(true);
  });

  it("reports replacement when a new socket wins before the old hello finishes", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const device = await paired(first.app);
    const gate = barrier();
    const touch = first.repository.touch.bind(first.repository);
    let blocked = false;
    vi.spyOn(first.repository, "touch").mockImplementationOnce(async (...args) => {
      blocked = true;
      await gate.promise;
      await touch(...args);
    });
    const address = await first.app.listen({ host: "127.0.0.1", port: 0 });
    const stale = new WebSocket(`${address.replace(/^http/u, "ws")}/api/v1/desktop/devices/socket`);
    sockets.push(stale);
    await once(stale, "open");
    const closed = once(stale, "close");
    stale.send(JSON.stringify({ type: "hello", token: device.token, protocol_version: 1 }));
    try {
      await vi.waitFor(() => expect(blocked).toBe(true));
      const winning = await connect(second.app, device.token);
      gate.resolve();
      expect((await closed)[0]).toBe(4409);
      const pong = nextFrame(winning.socket);
      winning.socket.send(JSON.stringify({ type: "ping" }));
      expect(await pong).toEqual({ type: "pong" });
    } finally { gate.resolve(); }
  });

  it("does not admit a fresh connection until revocation subscription recovery completes", async () => {
    const current = await fixture();
    const device = await paired(current.app);
    const active = await connect(current.app, device.token);
    const disconnected = once(active.socket, "close");
    const gate = barrier();
    const subscribe = current.coordinator.subscribe.bind(current.coordinator);
    let subscriptionPending = false;
    vi.spyOn(current.coordinator, "subscribe").mockImplementationOnce(async (...args) => {
      subscriptionPending = true;
      await gate.promise;
      return subscribe(...args);
    });
    const authenticate = vi.spyOn(current.service, "authenticate");
    try {
      await redis.client.call("CLIENT", "KILL", "TYPE", "pubsub");
      expect((await disconnected)[0]).toBe(4500);
      const reconnecting = connect(current.app, device.token);
      await vi.waitFor(() => expect(subscriptionPending).toBe(true));
      expect(authenticate).not.toHaveBeenCalled();
      gate.resolve();
      expect((await reconnecting).ready.type).toBe("ready");
    } finally {
      gate.resolve();
    }
  });
});
