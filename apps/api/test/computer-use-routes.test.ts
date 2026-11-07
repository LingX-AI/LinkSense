import Fastify from "fastify";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { ComputerUseService } from "../src/modules/computer-use/service.js";
import { registerComputerUseRoutes } from "../src/modules/computer-use/routes.js";
import { MemoryBrowserStore } from "./browser-use-store.js";
import { runtimeServiceSessionHeader } from "@linksense/shared";

const owner = "10000000-0000-4000-8000-000000000001";
const task = "20000000-0000-4000-8000-000000000001";
const turn = "30000000-0000-4000-8000-000000000001";
const secret = "internal-desktop-test-secret-123456789";
const apps: ReturnType<typeof Fastify>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function fixture(
  clientArchive = "/nonexistent/computer-use-client.zip",
  windowsClientArchive = "/nonexistent/computer-use-client-windows.zip",
) {
  const app = Fastify();
  apps.push(app);
  const date = new Date("2026-01-01T00:00:00Z");
  app.decorate("authenticate", async (request) => {
    if (request.headers.authorization !== "Bearer web-user") throw new AppError("AUTH_REQUIRED");
    request.authUser = { id: owner, authValidAfter: date } as NonNullable<typeof request.authUser>;
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const prisma = {
    conversation: { findFirst: vi.fn().mockResolvedValue({ id: task, title: "Desktop test" }) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id: turn, collaborationMode: "default" }) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: owner, status: "active", authValidAfter: date }) },
  };
  const intent = { detect: vi.fn().mockResolvedValue(true) };
  const service = new ComputerUseService(new MemoryBrowserStore(), "http://127.0.0.1/api/v1/computer-use");
  await registerComputerUseRoutes(app, {
    prisma: prisma as unknown as PrismaClient, service, intent, sharedSecret: secret,
    clientArchive,
    windowsClientArchive,
  });
  return { app, prisma, intent, service, date };
}

async function connectedFixture() {
  const state = await fixture();
  const pairing = await state.service.pairing(owner, state.date.toISOString());
  const paired = await state.service.pair(pairing.code, "Test computer", "darwin");
  const address = await state.app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${address.replace("http:", "ws:")}/api/v1/computer-use/socket`);
  sockets.push(socket);
  await once(socket, "open");
  const ready = once(socket, "message");
  socket.send(JSON.stringify({ type: "authenticate", version: "1", token: paired.token, device_id: paired.device.id }));
  expect(JSON.parse(String((await ready)[0]))).toMatchObject({ type: "ready" });
  return { ...state, socket, paired };
}

it("authenticates web setup, validates payloads and does not advertise an absent client", async () => {
  const { app, intent } = await fixture();
  expect((await app.inject({ method: "POST", url: "/api/v1/computer-use/pairing", payload: {} })).statusCode).toBe(401);
  const headers = { authorization: "Bearer web-user" };
  const state = await app.inject({ url: "/api/v1/computer-use", headers });
  expect(state.json()).toMatchObject({
    data: {
      connected: false,
      client_available: false,
      clients: { darwin: false, win32: false, linux: false },
    },
  });
  expect(state.headers["cache-control"]).toBe("private, no-store");
  expect((await app.inject({ url: "/api/v1/computer-use/client?platform=darwin", headers })).statusCode).toBe(503);
  expect((await app.inject({ url: "/api/v1/computer-use/client?platform=win32", headers })).statusCode).toBe(503);
  const bad = await app.inject({ method: "POST", url: `/api/v1/conversations/${task}/computer-use-intent`, headers, payload: { message_id: "bad" } });
  expect(bad.statusCode).toBe(400);
  expect(intent.detect).not.toHaveBeenCalled();
});

it("serves only an authenticated, configured regular installer archive", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-client-"));
  try {
    const macosArchive = path.join(directory, "desktop-macos.zip");
    const windowsArchive = path.join(directory, "desktop-windows.exe");
    await writeFile(macosArchive, Buffer.from("PK-macos-installer"));
    await writeFile(windowsArchive, Buffer.from("PK-windows-installer"));
    const { app } = await fixture(macosArchive, windowsArchive);
    expect((await app.inject({ url: "/api/v1/computer-use/client?platform=darwin" })).statusCode).toBe(401);
    const response = await app.inject({ url: "/api/v1/computer-use/client?platform=darwin", headers: { authorization: "Bearer web-user" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.rawPayload).toEqual(Buffer.from("PK-macos-installer"));
    const legacyMacos = await app.inject({ url: "/api/v1/computer-use/client", headers: { authorization: "Bearer web-user" } });
    expect(legacyMacos.statusCode).toBe(200);
    expect(legacyMacos.headers["content-type"]).toBe("application/zip");
    expect(legacyMacos.rawPayload).toEqual(Buffer.from("PK-macos-installer"));
    const windows = await app.inject({ url: "/api/v1/computer-use/client?platform=win32", headers: { authorization: "Bearer web-user" } });
    expect(windows.statusCode).toBe(200);
    expect(windows.headers["content-type"]).toBe("application/vnd.microsoft.portable-executable");
    expect(windows.headers["content-disposition"]).toContain("LinkSense-Desktop-windows.exe");
    expect(windows.rawPayload).toEqual(Buffer.from("PK-windows-installer"));
    expect((await app.inject({ url: "/api/v1/computer-use/client?platform=linux", headers: { authorization: "Bearer web-user" } })).statusCode).toBe(503);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("keeps legacy availability specific to macOS when a Windows device is paired", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "linksense-desktop-client-"));
  try {
    const windowsArchive = path.join(directory, "desktop-windows.exe");
    await writeFile(windowsArchive, Buffer.from("windows-installer"));
    const { app, service, date } = await fixture(path.join(directory, "missing-macos.zip"), windowsArchive);
    const pairing = await service.pairing(owner, date.toISOString());
    await service.pair(pairing.code, "Test Windows computer", "win32");
    const status = await app.inject({ url: "/api/v1/computer-use", headers: { authorization: "Bearer web-user" } });
    expect(status.json()).toMatchObject({
      data: {
        device: { platform: "win32" },
        client_available: false,
        clients: { darwin: false, win32: true, linux: false },
      },
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("checks internal credentials, account, conversation, active turn, service scope and Plan before executing", async () => {
  const { app, service, prisma } = await fixture();
  const execute = vi.spyOn(service, "execute");
  const payload = { conversationId: task, turnId: turn, input: { action: "status" } };
  const headers = { authorization: `Bearer ${secret}`, "x-linksense-owner-id": owner };
  const call = (h: Record<string, string> = headers, p = payload) => app.inject({ method: "POST", url: "/internal/computer-use/execute", headers: h, payload: p });
  expect((await call({ ...headers, authorization: "Bearer wrong" })).statusCode).toBe(401);
  expect((await call({ ...headers, [runtimeServiceSessionHeader]: task })).statusCode).toBe(403);
  prisma.conversation.findFirst.mockResolvedValueOnce(null);
  expect((await call()).statusCode).toBe(403);
  prisma.conversationTurn.findFirst.mockResolvedValueOnce(null);
  expect((await call()).statusCode).toBe(403);
  prisma.user.findUnique.mockResolvedValueOnce({ id: owner, status: "disabled", authValidAfter: new Date() });
  expect((await call()).statusCode).toBe(403);
  expect(execute).not.toHaveBeenCalled();
  prisma.conversationTurn.findFirst.mockResolvedValueOnce({ id: turn, collaborationMode: "plan" });
  const write = await app.inject({
    method: "POST", url: "/internal/computer-use/execute", headers,
    payload: { conversationId: task, turnId: turn, input: { action: "click", device_id: owner, ref: "@s:e1" } },
  });
  expect(write.json()).toMatchObject({ code: "COMPUTER_USE_ACCESS_DENIED" });
  expect(execute).not.toHaveBeenCalled();
  expect((await call()).json()).toMatchObject({ ok: true, data: { status: { connected: false } } });
});

it("connects a native WebSocket, transports a command and reply, and closes after revocation", async () => {
  const { service, socket, paired } = await connectedFixture();
  const commandMessage = once(socket, "message");
  const result = service.execute(owner, { conversationId: task, turnId: turn, title: "Native test", readOnly: false }, {
    action: "apps", device_id: paired.device.id,
  });
  const command = JSON.parse(String((await commandMessage)[0])) as { type: string; id: string };
  expect(command.type).toBe("command");
  socket.send(JSON.stringify({ type: "reply", id: command.id, result: { ok: true, data: { text: "apps" } } }));
  expect(await result).toEqual({ ok: true, data: { text: "apps" } });
  const closed = once(socket, "close");
  await service.revoke(owner);
  expect((await closed)[0]).toBe(4403);
});

it.each(["release", "cancel", "reconnect", "revoke", "expire", "disable", "logout"] as const)(
  "does not dispatch after %s while task revalidation is waiting on the database",
  async (operation) => {
    const { service, socket, paired, prisma } = await connectedFixture();
    const controller = new AbortController();
    const messages: unknown[] = [];
    socket.on("message", (raw) => { messages.push(JSON.parse(raw.toString())); });
    let releaseCheck = () => {};
    const checkAllowed = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const checkStarted = new Promise<void>((resolve) => {
      prisma.conversationTurn.findFirst.mockImplementationOnce(async () => {
        resolve();
        await checkAllowed;
        return { id: turn, collaborationMode: "default" };
      });
    });
    const context = { conversationId: task, turnId: turn, title: "Native test", readOnly: false };
    const pending = service.execute(owner, context, { action: "apps", device_id: paired.device.id }, controller.signal);
    let restoreClock = () => {};
    try {
      await checkStarted;
      if (operation === "release") {
        await service.execute(owner, context, { action: "release", device_id: paired.device.id });
      } else if (operation === "cancel") {
        controller.abort();
        await pending;
      } else if (operation === "reconnect") {
        const credential = await service.authenticate(paired.token);
        if (!credential) throw new Error("credential missing");
        await service.connect(credential, paired.token);
      } else if (operation === "revoke") {
        await service.revoke(owner);
      } else if (operation === "disable" || operation === "logout") {
        prisma.user.findUnique.mockResolvedValue({
          id: owner,
          status: operation === "disable" ? "disabled" : "active",
          authValidAfter: operation === "logout" ? new Date("2026-01-02T00:00:00Z") : new Date("2026-01-01T00:00:00Z"),
        });
      } else {
        const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
        restoreClock = () => { clock.mockRestore(); };
      }
      const next = service.next.bind(service);
      const pumpContinued = new Promise<void>((resolve) => {
        vi.spyOn(service, "next").mockImplementationOnce(async (...input) => {
          resolve();
          return next(...input);
        });
      });
      const closed = once(socket, "close");
      releaseCheck();
      await Promise.race([pumpContinued, closed]);
      if (socket.readyState === WebSocket.OPEN) {
        const pong = once(socket, "pong");
        socket.ping();
        await pong;
      }
      expect(messages).not.toContainEqual(expect.objectContaining({ type: "command" }));
    } finally {
      restoreClock();
      releaseCheck();
      controller.abort();
      await pending;
    }
  },
);

it("keeps the connection and next command alive when a reply completes during task revalidation", async () => {
  const { service, socket, paired, prisma } = await connectedFixture();
  const controller = new AbortController();
  let releaseCheck = () => {};
  try {
    const firstMessage = once(socket, "message");
    const request = { action: "apps" as const, device_id: paired.device.id };
    const context = { conversationId: task, turnId: turn, title: "Native test", readOnly: false };
    const firstResult = service.execute(owner, context, request, controller.signal);
    const first = JSON.parse(String((await firstMessage)[0])) as { type: string; id: string };
    expect(first.type).toBe("command");
    const checkAllowed = new Promise<void>((resolve) => { releaseCheck = resolve; });
    const checkStarted = new Promise<void>((resolve) => {
      prisma.conversationTurn.findFirst.mockImplementationOnce(async () => {
        resolve();
        await checkAllowed;
        return { id: turn, collaborationMode: "default" };
      });
    });
    await checkStarted;
    socket.send(JSON.stringify({ type: "reply", id: first.id, result: { ok: true, data: { text: "first" } } }));
    expect(await firstResult).toEqual({ ok: true, data: { text: "first" } });
    const nextMessage = Promise.race([
      once(socket, "message").then(([data]) => JSON.parse(String(data)) as { type: string; id: string }),
      once(socket, "close").then(() => ({ type: "closed", id: "" })),
    ]);
    const nextResult = service.execute(owner, context, request, controller.signal);
    releaseCheck();
    const next = await nextMessage;
    expect(next.type).toBe("command");
    socket.send(JSON.stringify({ type: "reply", id: next.id, result: { ok: true, data: { text: "second" } } }));
    expect(await nextResult).toEqual({ ok: true, data: { text: "second" } });
  } finally {
    releaseCheck();
    controller.abort();
  }
});

it("applies pause and resume WebSocket messages in arrival order while Redis work is pending", async () => {
  const { service, socket } = await connectedFixture();
  const pause = service.pause.bind(service);
  let releasePause = () => {};
  const pauseAllowed = new Promise<void>((resolve) => { releasePause = resolve; });
  const pauseStarted = new Promise<void>((resolve) => {
    vi.spyOn(service, "pause").mockImplementationOnce(async (...input) => {
      resolve();
      await pauseAllowed;
      await pause(...input);
    });
  });
  const resume = vi.spyOn(service, "resume");
  try {
    socket.send(JSON.stringify({ type: "pause" }));
    await pauseStarted;
    socket.send(JSON.stringify({ type: "resume" }));
    const pong = once(socket, "pong");
    socket.ping();
    await pong;
    expect(resume).not.toHaveBeenCalled();
  } finally { releasePause(); }
  await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
  await vi.waitFor(async () => expect((await service.status(owner)).control).toBe("ready"));
});

it("does not echo a local pause but still forwards remote release after local resume", async () => {
  const { service, socket, paired } = await connectedFixture();
  const messages: string[] = [];
  socket.on("message", (raw) => { messages.push(raw.toString()); });
  const paused = service.paused.bind(service);
  const pauseObserved = new Promise<void>((resolve) => {
    vi.spyOn(service, "paused").mockImplementation(async (...input) => {
      const result = await paused(...input);
      if (result) resolve();
      return result;
    });
  });
  socket.send(JSON.stringify({ type: "pause" }));
  await pauseObserved;
  const heartbeat = once(socket, "message");
  socket.send(JSON.stringify({
    type: "heartbeat", control: "paused",
    permissions: { accessibility: "granted", screen_recording: "granted" },
  }));
  await heartbeat;
  expect(messages).not.toContain(JSON.stringify({ type: "pause" }));
  const resumed = once(socket, "message");
  socket.send(JSON.stringify({ type: "resume" }));
  socket.send(JSON.stringify({
    type: "heartbeat", control: "ready",
    permissions: { accessibility: "granted", screen_recording: "granted" },
  }));
  await resumed;
  const released = once(socket, "message");
  await service.execute(owner, { conversationId: task, turnId: turn, title: "Release", readOnly: false }, {
    action: "release", device_id: paired.device.id,
  });
  expect(JSON.parse(String((await released)[0]))).toEqual({ type: "pause" });
});

it("closes a client that exceeds the bounded control-message backlog", async () => {
  const { service, socket } = await connectedFixture();
  const pause = service.pause.bind(service);
  let releasePause = () => {};
  const pauseAllowed = new Promise<void>((resolve) => { releasePause = resolve; });
  const pauseStarted = new Promise<void>((resolve) => {
    vi.spyOn(service, "pause").mockImplementationOnce(async (...input) => {
      resolve();
      await pauseAllowed;
      await pause(...input);
    });
  });
  try {
    socket.send(JSON.stringify({ type: "pause" }));
    await pauseStarted;
    const closed = once(socket, "close");
    for (let index = 0; index < 17; index++) socket.send(JSON.stringify({ type: "resume" }));
    expect((await closed)[0]).toBe(4408);
  } finally { releasePause(); }
});

it("does not send a stale paused observation after a later local resume has completed", async () => {
  const { service, socket } = await connectedFixture();
  const messages: string[] = [];
  socket.on("message", (raw) => { messages.push(raw.toString()); });
  const paused = service.paused.bind(service);
  let releaseObservation = () => {};
  const observationAllowed = new Promise<void>((resolve) => { releaseObservation = resolve; });
  let blocked = false;
  const observationRead = new Promise<void>((resolve) => {
    vi.spyOn(service, "paused").mockImplementation(async (...input) => {
      const result = await paused(...input);
      if (result && !blocked) {
        blocked = true;
        resolve();
        await observationAllowed;
      }
      return result;
    });
  });
  try {
    socket.send(JSON.stringify({ type: "pause" }));
    await observationRead;
    const resumed = once(socket, "message");
    socket.send(JSON.stringify({ type: "resume" }));
    const heartbeat = {
      type: "heartbeat", control: "ready",
      permissions: { accessibility: "granted", screen_recording: "granted" },
    };
    socket.send(JSON.stringify(heartbeat));
    await resumed;
    const next = service.next.bind(service);
    const pumpContinued = new Promise<void>((resolve) => {
      vi.spyOn(service, "next").mockImplementationOnce(async (...input) => { resolve(); return next(...input); });
    });
    releaseObservation();
    await pumpContinued;
    const reply = once(socket, "message");
    socket.send(JSON.stringify(heartbeat));
    await reply;
    expect(messages).not.toContain(JSON.stringify({ type: "pause" }));
  } finally { releaseObservation(); }
});
