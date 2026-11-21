import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_APP_VERSION_HEADER,
  DESKTOP_ATTACHMENT_PROTOCOL_HEADER, DESKTOP_EXECUTION_PROTOCOL_HEADER, DESKTOP_TOOL_OPERATIONS_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER, desktopAttachmentProtocolVersion,
  desktopDeviceServerFrameSchema, desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema, desktopExecutionProtocolVersion, desktopToolProtocolVersion, type DesktopExecutionAck,
  type DesktopExecutionCallback, type DesktopExecutionCommand,
} from "@linksense/shared";
import { DesktopCommandUncertainError, DesktopCommandUndeliveredError, DesktopDeviceTransport } from "../src/adapters/desktop-device-transport.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import { RedisDesktopDeviceCoordinator, type DesktopExecutionBinding } from "../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { registerClientBuildGuard } from "../src/plugins/client-build.js";
import { MemoryDesktopDeviceRepository } from "./desktop-devices.fixture.js";
import { createRedisFixture } from "./fixtures/redis.js";

const owner = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const headers = { authorization: "Bearer user" };
const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };
const executionKey = { masterKey: randomBytes(32).toString("base64"), keyId: "test" };
let redis: Awaited<ReturnType<typeof createRedisFixture>>;
const applications: ReturnType<typeof Fastify>[] = [];
const sockets: WebSocket[] = [];

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(applications.splice(0).map(app => app.close()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => { await redis.close(); });

async function fixture(
  repository = new MemoryDesktopDeviceRepository(),
  tools: { artifactTools?: boolean; websiteArtifacts?: boolean; nativeApprovals?: boolean } = {},
) {
  for (const id of [owner, other]) repository.owners.set(id, { status: "active", authValidAfter: new Date(0) });
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const service = new DesktopDeviceService(repository, coordinator);
  const app = Fastify();
  const authority = vi.fn<(binding: DesktopExecutionBinding, command: DesktopExecutionCommand) => Promise<boolean>>()
    .mockResolvedValue(true);
  const recover = vi.fn(async (_scope: DesktopExecutionBinding & { ownerId: string }, frame: DesktopExecutionCallback, signal: AbortSignal): Promise<DesktopExecutionAck> => {
    signal.throwIfAborted();
    if (frame.operation !== "events") throw new AppError("FORBIDDEN");
    return { type: "execution.ack", operation: "events", id: frame.id, ok: true,
      data: { accepted_delivery_ids: frame.body.events.map(event => event.deliveryId) } } as const;
  });
  const execution = new DesktopDeviceTransport(redis.client, authority, app.log, executionKey, recover);
  applications.push(app);
  registerClientBuildGuard(app, null);
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
    service, redis: redis.client, rateLimitHmacSecret: "test-only-desktop-rate-limit-secret", execution, ...tools,
  });
  await app.ready();
  return { app, service, coordinator, repository, execution, authority, recover };
}

async function paired(app: ReturnType<typeof Fastify>, platform = registration.platform) {
  const pairing = await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} });
  expect(pairing.statusCode).toBe(200);
  const response = await app.inject({
    method: "POST", url: "/api/v1/desktop/devices/pair",
    payload: { ...registration, platform, code: pairing.json().data.code },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { token: string; owner_id: string; device: { id: string } };
}

function readFrame(socket: WebSocket): Promise<unknown> {
  return once(socket, "message", { signal: AbortSignal.timeout(2_000) }).then(([data]) => JSON.parse(String(data)));
}

function nextFrame(socket: WebSocket) {
  return readFrame(socket).then(frame => desktopDeviceServerFrameSchema.parse(frame));
}

function barrier() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, resolve: () => release() };
}

async function socketUrl(app: ReturnType<typeof Fastify>) {
  const address = app.server.listening
    ? `http://127.0.0.1:${(app.server.address() as import("node:net").AddressInfo).port}`
    : await app.listen({ host: "127.0.0.1", port: 0 });
  return `${address.replace(/^http/u, "ws")}/api/v1/desktop/devices/socket`;
}

async function connect(
  app: ReturnType<typeof Fastify>, token: string, executionVersion?: number, attachments = false, toolOffer?: string,
  appVersion?: string | string[],
) {
  const socket = new WebSocket(await socketUrl(app), {
    headers: {
      ...(appVersion === undefined ? {} : { [DESKTOP_APP_VERSION_HEADER]: appVersion }),
      ...(executionVersion === undefined ? {} : { [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(executionVersion) }),
      ...(attachments ? { [DESKTOP_ATTACHMENT_PROTOCOL_HEADER]: String(desktopAttachmentProtocolVersion) } : {}),
      ...(toolOffer === undefined ? {} : {
        [DESKTOP_TOOL_PROTOCOL_HEADER]: String(desktopToolProtocolVersion),
        [DESKTOP_TOOL_OPERATIONS_HEADER]: toolOffer,
      }),
    },
  });
  sockets.push(socket);
  await once(socket, "open");
  const ready = readFrame(socket).then(frame => {
    const negotiated = desktopExecutionDeviceReadySchema.safeParse(frame);
    return negotiated.success ? negotiated.data : desktopDeviceServerFrameSchema.parse(frame);
  });
  socket.send(JSON.stringify({ type: "hello", token, protocol_version: 1 }));
  return { socket, ready: await ready };
}

function inspection(overrides: Partial<Extract<DesktopExecutionCommand, { operation: "turn.inspect" }>> = {}): DesktopExecutionCommand {
  return {
    type: "command", operation: "turn.inspect", id: randomUUID(), owner_id: owner,
    conversation_id: randomUUID(), runtime_generation: randomUUID(), turn_id: randomUUID(),
    expires_at: new Date(Date.now() + 4_000).toISOString(), ...overrides,
  };
}

function acknowledgeInspection(socket: WebSocket, command: DesktopExecutionCommand) {
  socket.send(JSON.stringify({
    type: "command.result", operation: command.operation, id: command.id, ok: true, result: null,
  }));
}

function acknowledgeStart(socket: WebSocket, command: DesktopExecutionCommand, objective: string) {
  const codexThreadId = randomUUID();
  const timestamp = new Date().toISOString();
  socket.send(JSON.stringify({
    type: "command.result", operation: command.operation, id: command.id, ok: true,
    result: {
      conversationId: command.conversation_id, projectionTurnId: command.turn_id,
      status: "succeeded", createdAt: timestamp, updatedAt: timestamp,
      result: {
        codexThreadId, codexTurnId: randomUUID(),
        goal: {
          threadId: codexThreadId, objective, status: "active", tokenBudget: null,
          tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
        },
      },
    },
  }));
}

describe("desktop execution transport", () => {
  it("accepts a recovery batch only under the exact pending drain on the current connection", async () => {
    const gateway = await fixture();
    const origin = await fixture(gateway.repository);
    const { device, token } = await paired(gateway.app);
    const { socket } = await connect(gateway.app, token, desktopExecutionProtocolVersion);
    const binding = await origin.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = desktopExecutionCommandSchema.parse({ ...inspection(), operation: "turn.drain" });
    const recovery = {
      type: "execution.recovery", operation: "events", id: randomUUID(), drain_id: command.id,
      conversation_id: command.conversation_id, turn_id: command.turn_id, runtime_generation: command.runtime_generation,
      body: { conversationId: command.conversation_id, events: [{
        deliveryId: randomUUID(), event: { method: "turn/completed", visibility: "user_visible",
          params: { threadId: randomUUID(), turn: { id: randomUUID(), status: "completed" } } },
      }] },
    };
    const send = (frame: unknown) => {
      const response = readFrame(socket);
      socket.send(JSON.stringify(frame));
      return response;
    };
    expect(await send(recovery)).toMatchObject({ type: "execution.ack", ok: false, error_code: "FORBIDDEN" });
    const request = readFrame(socket);
    const result = origin.execution.send(binding, command);
    try {
      expect(await request).toEqual(command);
      expect(await send({ ...recovery, runtime_generation: randomUUID() })).toMatchObject({ ok: false, error_code: "FORBIDDEN" });
      gateway.authority.mockResolvedValueOnce(false);
      expect(await send(recovery)).toMatchObject({ ok: false, error_code: "FORBIDDEN" });
      expect(gateway.recover).not.toHaveBeenCalled();
      expect(await send(recovery)).toEqual({
        type: "execution.ack", operation: "events", id: recovery.id, ok: true,
        data: { accepted_delivery_ids: recovery.body.events.map(event => event.deliveryId) },
      });
      expect(gateway.recover).toHaveBeenCalledTimes(1);
    } finally {
      socket.send(JSON.stringify({ type: "command.result", id: command.id, operation: "turn.drain", ok: true, result: { drained: true } }));
      await result;
    }
    expect(await send(recovery)).toMatchObject({ ok: false, error_code: "FORBIDDEN" });
  });

  it("aborts in-flight recovery projection when the originating API cancels the drain", async () => {
    const gateway = await fixture();
    const origin = await fixture(gateway.repository);
    const { device, token } = await paired(gateway.app);
    const { socket } = await connect(gateway.app, token, desktopExecutionProtocolVersion);
    const binding = await origin.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = desktopExecutionCommandSchema.parse({ ...inspection(), operation: "turn.drain" });
    const abort = new AbortController();
    const started = barrier();
    const finished = barrier();
    gateway.recover.mockImplementationOnce(async (_scope, _frame, signal) => {
      started.resolve();
      try { await once(signal, "abort", { signal: AbortSignal.timeout(500) }); }
      finally { finished.resolve(); }
      throw new AppError("RUNNER_UNAVAILABLE");
    });
    const sent = readFrame(socket);
    const result = origin.execution.send(binding, command, abort.signal);
    const uncertain = expect(result).rejects.toBeInstanceOf(DesktopCommandUncertainError);
    expect(await sent).toEqual(command);
    const callbackId = randomUUID();
    socket.send(JSON.stringify({
      type: "execution.recovery", operation: "events", id: callbackId, drain_id: command.id,
      conversation_id: command.conversation_id, turn_id: command.turn_id, runtime_generation: command.runtime_generation,
      body: { conversationId: command.conversation_id, events: [{
        deliveryId: randomUUID(), event: { method: "turn/completed", visibility: "user_visible",
          params: { threadId: randomUUID(), turn: { id: randomUUID(), status: "completed" } } },
      }] },
    }));
    await started.promise;
    const cancelled = readFrame(socket);
    abort.abort();
    await uncertain;
    expect(await cancelled).toEqual({ type: "command.cancel", id: command.id });
    await finished.promise;
    expect(gateway.recover.mock.calls[0]?.[2].aborted).toBe(true);
  });

  it("withholds attachment readiness when Stop wins while the gateway is validating it", async () => {
    const gateway = await fixture();
    const origin = await fixture(gateway.repository);
    const deviceId = randomUUID(), connectionId = randomUUID();
    await gateway.coordinator.connect(deviceId, connectionId);
    const frames = new EventEmitter();
    const send = vi.fn<Parameters<DesktopDeviceTransport["attach"]>[0]["send"]>(frame => {
      frames.emit("frame", frame);
      return true;
    });
    const detach = await gateway.execution.attach({
      ownerId: owner, deviceId, connectionId, attachments: true, toolOperations: [],
      verifyCredential: async () => true, send, close: () => {},
    });
    if (!detach) throw new Error("Mac did not negotiate attachment execution");
    let enterValidation = () => {};
    let finishValidation = () => {};
    const validationEntered = new Promise<void>(resolve => { enterValidation = resolve; });
    const validationFinished = new Promise<void>(resolve => { finishValidation = resolve; });
    const pending: Promise<unknown>[] = [];
    try {
      const binding = await origin.execution.connection(deviceId);
      if (!binding) throw new Error("Missing negotiated Mac connection");
      const scope = inspection();
      const expiresAt = Date.now() + 10_000;
      const expires_at = new Date(expiresAt).toISOString();
      const run_token = `lsdr_${"a".repeat(43)}`;
      const start = desktopExecutionCommandSchema.parse({
        ...scope, expires_at, operation: "turn.start",
        body: {
          native_thread_id: null, input: "", reasoning_effort: "low",
          credentials: {
            turn_id: scope.turn_id, expires_at, run_token,
            primary: { purpose: "primary", model: "sample", revision: 1, protocol_mode: "native_responses", token: `lsdm_${"b".repeat(43)}` },
          },
          attachments: [{
            id: randomUUID(), filename: "notes.txt", size_bytes: 4, sha256: "c".repeat(64),
            download_grant: `${expiresAt}.${scope.id}.${"d".repeat(64)}`,
          }],
        },
      });
      const startFrame = once(frames, "frame", { signal: AbortSignal.timeout(2_000) });
      pending.push(origin.execution.send(binding, start).catch(() => undefined));
      expect((await startFrame)[0]).toEqual(start);
      const ready = {
        type: "execution.callback", operation: "attachments.ready", start_id: start.id, id: randomUUID(), run_token,
        conversation_id: start.conversation_id, runtime_generation: start.runtime_generation, turn_id: start.turn_id,
      } satisfies DesktopExecutionCallback;
      gateway.recover.mockImplementationOnce(async () => {
        enterValidation();
        await validationFinished;
        return { type: "execution.ack", operation: "attachments.ready", id: ready.id, ok: true };
      });
      const validating = gateway.execution.receiveCallback(connectionId, ready);
      pending.push(validating);
      await Promise.race([validationEntered, validating.then(() => { throw new Error("Readiness did not reach validation"); })]);

      const stop = desktopExecutionCommandSchema.parse({ ...scope, expires_at, id: randomUUID(), operation: "turn.interrupt" });
      const stopFrame = once(frames, "frame", { signal: AbortSignal.timeout(2_000) });
      pending.push(origin.execution.send(binding, stop).catch(() => undefined));
      expect((await stopFrame)[0]).toEqual(stop);

      finishValidation();
      await validating;
      expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "execution.ack", id: ready.id, ok: true }));
    } finally {
      finishValidation();
      detach();
      await Promise.allSettled(pending);
    }
  });

  it.each([
    { peer: "attachment-capable", attachments: true, ordinarySlots: 7 },
    { peer: "legacy", attachments: false, ordinarySlots: 8 },
  ])("keeps Stop within the eight-command limit for a $peer Mac", async ({ attachments, ordinarySlots }) => {
    const { app, execution } = await fixture();
    const { device, token } = await paired(app);
    const { socket, ready } = await connect(app, token, desktopExecutionProtocolVersion, attachments);
    expect(desktopExecutionDeviceReadySchema.parse(ready).attachment_protocol_version)
      .toBe(attachments ? desktopAttachmentProtocolVersion : undefined);
    const binding = await execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const pending: Promise<unknown>[] = [];
    const issue = (command: DesktopExecutionCommand) => {
      const frame = readFrame(socket);
      const result = execution.send(binding, command);
      pending.push(result);
      return Promise.race([frame, result]);
    };
    const expires_at = new Date(Date.now() + 20_000).toISOString();
    const unavailable = { ok: false, error_code: "RUNNER_UNAVAILABLE" };
    try {
      for (let admitted = 0; admitted < ordinarySlots; admitted++) {
        const command = inspection({ expires_at });
        expect(await issue(command)).toEqual(command);
      }
      expect(await issue(inspection({ expires_at }))).toMatchObject(unavailable);
      const stop = { ...inspection({ expires_at }), operation: "turn.interrupt" } as const;
      if (attachments) expect(await issue(stop)).toEqual(stop);
      await expect(issue({ ...stop, id: randomUUID() })).rejects.toBeInstanceOf(DesktopCommandUndeliveredError);
    } finally {
      socket.terminate();
      await Promise.allSettled(pending);
    }
  });

  it("sends a command to the current negotiated Mac across API replicas and correlates its receipt", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket, ready } = await connect(first.app, token, desktopExecutionProtocolVersion);
    expect(desktopExecutionDeviceReadySchema.parse(ready).device_id).toBe(device.id);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const frame = readFrame(socket);
    const receipt = second.execution.send(binding, command);
    expect(desktopExecutionCommandSchema.parse(await frame)).toEqual(command);
    acknowledgeInspection(socket, { ...command, id: randomUUID() });
    acknowledgeInspection(socket, command);
    await expect(receipt).resolves.toMatchObject({ ok: true, id: command.id, result: null });
    await expect(second.execution.send(binding, command)).rejects.toBeInstanceOf(DesktopCommandUncertainError);
  });

  it("does not publish plaintext input or credentials to Redis", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const observer = redis.client.duplicate();
    try {
      await observer.subscribe(`linksense:desktop-execution:${binding.gatewayId}`);
      const observed = once(observer, "message", { signal: AbortSignal.timeout(2_000) });
      const command = desktopExecutionCommandSchema.parse({
        ...inspection(), operation: "turn.start",
        body: {
          native_thread_id: null, input: "Private whitebox prompt", reasoning_effort: "low",
          credentials: {
            turn_id: owner, expires_at: new Date(Date.now() + 60_000).toISOString(),
            run_token: `lsdr_${"a".repeat(43)}`,
            primary: { purpose: "primary", model: "sample", revision: 1, protocol_mode: "native_responses", token: `lsdm_${"b".repeat(43)}` },
          },
        },
        turn_id: owner,
      });
      const delivered = readFrame(socket);
      const result = second.execution.send(binding, command);
      expect(await delivered).toEqual(command);
      acknowledgeStart(socket, command, "Whitebox");
      await expect(result).resolves.toMatchObject({ ok: true, id: command.id });
      const [, encrypted] = await observed;
      expect(String(encrypted)).toMatch(/^"v1\.test\./u);
      expect(String(encrypted)).not.toMatch(/lsd[rm]_|Private whitebox prompt/u);
    } finally {
      observer.disconnect();
    }
  });

  it("retains old presence, never sends to a replaced connection, and distinguishes a lost response", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const mac = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const frame = readFrame(mac.socket);
    const receipt = second.execution.send(binding, command);
    expect(await frame).toEqual(command);
    const closed = once(mac.socket, "close", { signal: AbortSignal.timeout(2_000) });
    const lost = expect(receipt).resolves.toMatchObject({ ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" });
    const legacy = await connect(second.app, token);
    expect((await closed)[0]).toBe(4409);
    expect(desktopDeviceServerFrameSchema.parse(legacy.ready).type).toBe("ready");
    expect(await second.execution.connection(device.id)).toBeNull();
    await lost;
    await expect(second.execution.send(binding, inspection())).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    const pong = nextFrame(legacy.socket);
    legacy.socket.send(JSON.stringify({ type: "ping" }));
    await expect(pong).resolves.toEqual({ type: "pong" });
  });

  it("leaves presence compatible for Windows and unrecognized execution protocol versions", async () => {
    const { app, execution } = await fixture();
    for (const [platform, version] of [["windows", desktopExecutionProtocolVersion], ["darwin", 1], ["darwin", desktopExecutionProtocolVersion + 1]] as const) {
      const { device, token } = await paired(app, platform);
      const { socket, ready } = await connect(app, token, version);
      expect(desktopDeviceServerFrameSchema.parse(ready).type).toBe("ready");
      expect(await execution.connection(device.id)).toBeNull();
      const pong = nextFrame(socket);
      socket.send(JSON.stringify({ type: "ping" }));
      await expect(pong).resolves.toEqual({ type: "pong" });
    }
  });

  it("accepts a valid multibyte receipt above the legacy presence limit", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const delivered = readFrame(socket);
    const result = second.execution.send(binding, command);
    expect(await delivered).toEqual(command);
    const objective = "目标".repeat(2_000);
    acknowledgeStart(socket, command, objective);
    const response = await result;
    if (!response.ok || response.operation !== "turn.inspect" || response.result?.status !== "succeeded") {
      throw new Error("valid device receipt was rejected");
    }
    expect(response.result.result.goal?.objective.length).toBe(objective.length);
  });

  it("rejects a command outside the device's authorized conversation scope before delivery", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const messages = vi.fn();
    socket.on("message", messages);
    first.authority.mockResolvedValue(false);
    await expect(second.execution.send(binding, command)).resolves.toMatchObject({ ok: false, error_code: "FORBIDDEN" });
    expect(first.authority).toHaveBeenCalledWith(binding, command);
    expect(messages).not.toHaveBeenCalled();
  });

  it("checks a repeated receipt only once while device authorization is pending", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const delivered = readFrame(socket);
    const receipt = second.execution.send(binding, command);
    expect(await delivered).toEqual(command);
    const gate = barrier();
    const started = barrier();
    const verify = vi.spyOn(first.service, "hasCurrentCredential").mockImplementation(async () => {
      started.resolve();
      await gate.promise;
      return true;
    });
    const receive = vi.spyOn(first.execution, "receive");
    try {
      acknowledgeInspection(socket, command);
      await started.promise;
      acknowledgeInspection(socket, command);
      await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(2));
      expect(verify).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
      await receipt;
    }
  });

  it("rejects another owner's command and propagates cancellation without accepting a late reply", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    await expect(second.execution.send(binding, inspection({ owner_id: other })))
      .resolves.toMatchObject({ ok: false, error_code: "FORBIDDEN" });
    const controller = new AbortController();
    const command = inspection();
    const delivered = readFrame(socket);
    const receipt = second.execution.send(binding, command, controller.signal);
    expect(await delivered).toEqual(command);
    const cancelled = readFrame(socket);
    controller.abort();
    await expect(receipt).rejects.toBeInstanceOf(DesktopCommandUncertainError);
    expect(await cancelled).toEqual({ type: "command.cancel", id: command.id });
    acknowledgeInspection(socket, command);
    const next = inspection();
    const nextDelivery = readFrame(socket);
    const nextReceipt = second.execution.send(binding, next);
    expect(await nextDelivery).toEqual(next);
    acknowledgeInspection(socket, next);
    await expect(nextReceipt).resolves.toMatchObject({ id: next.id, ok: true });
  });

  it("does not deliver a command cancelled while its authorization is in progress", async () => {
    const first = await fixture();
    const second = await fixture(first.repository);
    const { device, token } = await paired(first.app);
    const { socket } = await connect(first.app, token, desktopExecutionProtocolVersion);
    const binding = await second.execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const gate = barrier();
    const started = barrier();
    first.authority.mockImplementationOnce(async () => {
      started.resolve();
      await gate.promise;
      return true;
    });
    const signal = new AbortController();
    const command = inspection();
    const receipt = second.execution.send(binding, command, signal.signal);
    await started.promise;
    try {
      signal.abort();
      await expect(receipt).rejects.toBeInstanceOf(DesktopCommandUncertainError);
      await vi.waitFor(async () => expect(await first.coordinator.mayDispatch(binding, command.id)).toBe(false));
      gate.resolve();
      const next = inspection();
      const nextDelivery = readFrame(socket);
      const nextReceipt = second.execution.send(binding, next);
      expect(await nextDelivery).toEqual(next);
      acknowledgeInspection(socket, next);
      await expect(nextReceipt).resolves.toMatchObject({ id: next.id, ok: true });
    } finally {
      gate.resolve();
    }
  });

  it("fences receipt publication after replacement and prevents a delayed dispatch after cancellation", async () => {
    const { app, coordinator, execution } = await fixture();
    const { device, token } = await paired(app);
    const original = await connect(app, token, desktopExecutionProtocolVersion);
    const binding = await execution.connection(device.id);
    if (!binding) throw new Error("Mac did not negotiate execution");
    const command = inspection();
    const expiresAt = Date.parse(command.expires_at);
    const recipient = "test:desktop-execution";
    await coordinator.publishExecution(binding, recipient, "cancel", { expiresAt, command: { id: command.id, kind: "cancel" } });
    await expect(coordinator.publishExecution(binding, recipient, "dispatch", { expiresAt, command: { id: command.id, kind: "dispatch" } }))
      .resolves.toBe("duplicate");
    const closed = once(original.socket, "close", { signal: AbortSignal.timeout(2_000) });
    await connect(app, token, desktopExecutionProtocolVersion);
    expect((await closed)[0]).toBe(4409);
    await expect(coordinator.publishExecution(binding, recipient, "old receipt", { expiresAt })).resolves.toBe("unavailable");
  });
});

describe("desktop tool negotiation", () => {
  const offer = "web.search,artifact.prepare,artifact.multipart,artifact.website";

  it.each([
    { name: "artifact rollout off", gates: { artifactTools: false, websiteArtifacts: false }, toolOffer: offer,
      expected: ["web.search"] },
    { name: "website rollout off", gates: { artifactTools: true, websiteArtifacts: false }, toolOffer: offer,
      expected: ["web.search", "artifact.prepare", "artifact.multipart"] },
    { name: "website rollout on", gates: { artifactTools: true, websiteArtifacts: true }, toolOffer: offer,
      expected: ["web.search", "artifact.prepare", "artifact.multipart", "artifact.website"] },
    { name: "legacy offer", gates: { artifactTools: true, websiteArtifacts: true }, toolOffer: "artifact.prepare",
      expected: ["artifact.prepare"] },
    { name: "native approvals without artifact or browser tools", gates: { nativeApprovals: true }, toolOffer: "approval.respond",
      expected: ["approval.respond"] },
    { name: "approval rollout off", gates: { nativeApprovals: false }, toolOffer: "web.search,approval.respond",
      expected: ["web.search"] },
    { name: "older app", gates: { nativeApprovals: true }, toolOffer: "web.search",
      expected: ["web.search"] },
  ])("negotiates $name without changing other tools", async ({ gates, toolOffer, expected }) => {
    const { app } = await fixture(undefined, gates);
    const { token } = await paired(app);
    const { ready } = await connect(app, token, desktopExecutionProtocolVersion, false, toolOffer);
    const negotiated = desktopExecutionDeviceReadySchema.parse(ready).tool_operations ?? [];
    expect([...negotiated].sort()).toEqual([...expected].sort());
  });
});

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

  it("renames only the caller's active device and accepts only a valid display name", async () => {
    const { app } = await fixture();
    const { device, token } = await paired(app);
    const url = `/api/v1/desktop/devices/${device.id}`;
    const rename = (payload: object, authorization?: string) => app.inject({
      method: "PATCH", url, payload, headers: authorization ? { authorization } : {},
    });
    expect((await rename({ name: "Home PC" })).statusCode).toBe(401);
    expect((await rename({ name: "Home PC" }, "Bearer other")).statusCode).toBe(403);
    for (const payload of [{ name: " " }, { name: "line\nbreak" }, { name: "x".repeat(121) },
      { name: "Home PC", owner_id: other }]) {
      expect((await rename(payload, headers.authorization)).statusCode).toBe(400);
    }
    const { socket } = await connect(app, token);
    const renamed = await rename({ name: "  家里的电脑  " }, headers.authorization);
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data).toEqual({ id: device.id, name: "家里的电脑" });
    expect(renamed.headers["cache-control"]).toBe("private, no-store");
    const pong = nextFrame(socket);
    socket.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toEqual({ type: "pong" });
    const list = await app.inject({ url: "/api/v1/desktop/devices", headers });
    expect(list.json().data.items).toMatchObject([{ id: device.id, name: "家里的电脑", online: true }]);
    const closed = once(socket, "close");
    expect((await app.inject({ method: "DELETE", url, headers })).statusCode).toBe(200);
    expect((await closed)[0]).toBe(4403);
    expect((await rename({ name: "Revoked device" }, headers.authorization)).statusCode).toBe(403);
  });

  it("authenticates and heartbeats, then revokes the socket from another API replica using an uppercase device ID", async () => {
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
    const closed = once(socket, "close", { signal: AbortSignal.timeout(1_000) });
    expect((await second.app.inject({
      method: "DELETE", url: `/api/v1/desktop/devices/${device.device.id.toUpperCase()}`, headers,
    })).statusCode).toBe(200);
    expect((await closed)[0]).toBe(4403);
    expect((await second.app.inject({ url: "/api/v1/desktop/devices", headers })).json().data.items[0].online).toBe(false);
  });

  it("closes a revoked connection after a failed publication without a DELETE retry or client heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const first = await fixture();
    const second = await fixture(first.repository);
    const device = await paired(first.app);
    const { socket } = await connect(first.app, device.token);
    vi.spyOn(redis.client, "eval").mockRejectedValueOnce(new Error("test revocation broadcast unavailable"));
    const url = `/api/v1/desktop/devices/${device.device.id}`;
    expect((await second.app.inject({ method: "DELETE", url, headers })).statusCode).toBe(500);
    expect(await first.service.authenticate(device.token)).toBeNull();
    expect(socket.readyState).toBe(WebSocket.OPEN);

    const closed = once(socket, "close", { signal: AbortSignal.timeout(1_000) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await closed)[0]).toBe(4403);
    expect((await second.app.inject({ method: "DELETE", url, headers })).statusCode).toBe(200);
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
    const stale = new WebSocket(await socketUrl(first.app), {
      headers: { [DESKTOP_APP_VERSION_HEADER]: "0.0.1" },
    });
    sockets.push(stale);
    await once(stale, "open");
    const closed = once(stale, "close");
    stale.send(JSON.stringify({ type: "hello", token: device.token, protocol_version: 1 }));
    try {
      await vi.waitFor(() => expect(blocked).toBe(true));
      const winning = await connect(second.app, device.token, undefined, false, undefined, "9.9.9");
      gate.resolve();
      expect((await closed)[0]).toBe(4409);
      await vi.waitFor(() => expect(first.repository.devices.get(device.device.id)?.appVersion).toBe("9.9.9"));
      const pong = nextFrame(winning.socket);
      winning.socket.send(JSON.stringify({ type: "ping" }));
      expect(await pong).toEqual({ type: "pong" });
    } finally { gate.resolve(); }
  });

  it("keeps the winning version when a slower admitted handshake finishes later", async () => {
    const { app, repository } = await fixture();
    const { device, token } = await paired(app);
    const gate = barrier();
    const settled = barrier();
    let blocked = false;
    const update = repository.updateAppVersion.bind(repository);
    vi.spyOn(repository, "updateAppVersion").mockImplementationOnce(async (row, appVersion, isCurrentConnection, now) => {
      blocked = true;
      await gate.promise;
      try { await update(row, appVersion, isCurrentConnection, now); }
      finally { settled.resolve(); }
    });
    const stale = new WebSocket(await socketUrl(app), {
      headers: { [DESKTOP_APP_VERSION_HEADER]: "0.0.1" },
    });
    sockets.push(stale);
    await once(stale, "open");
    const ready = nextFrame(stale);
    const closed = once(stale, "close");
    stale.send(JSON.stringify({ type: "hello", token, protocol_version: 1 }));
    try {
      expect((await ready).type).toBe("ready");
      await vi.waitFor(() => expect(blocked).toBe(true));
      await connect(app, token, undefined, false, undefined, "9.9.9");
      await vi.waitFor(() => expect(repository.devices.get(device.id)?.appVersion).toBe("9.9.9"));
      gate.resolve();
      expect((await closed)[0]).toBe(4409);
      await settled.promise;
      expect(repository.devices.get(device.id)?.appVersion).toBe("9.9.9");
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

describe("desktop app version reconnect metadata", () => {
  it("refreshes only the installed Mac version after an authenticated reconnect", async () => {
    const { app, repository } = await fixture();
    const { device, token } = await paired(app);
    const original = repository.devices.get(device.id);
    if (!original) throw new Error("missing paired device");
    const identity = {
      id: original.id, ownerId: original.ownerId, name: original.name, platform: original.platform,
      arch: original.arch, tokenHash: original.tokenHash, capabilitiesJson: original.capabilitiesJson,
      authValidAfter: original.authValidAfter, revokedAt: original.revokedAt, createdAt: original.createdAt,
    };
    await connect(app, token, undefined, false, undefined, "1.4.0");
    await vi.waitFor(() => expect(repository.devices.get(device.id)?.appVersion).toBe("1.4.0"));
    expect((await app.inject({ url: "/api/v1/desktop/devices", headers })).json().data.items[0])
      .toMatchObject({ id: device.id, name: original.name, app_version: "1.4.0" });
    // A manual rollback is reported as-is; there is no monotonic SemVer rule.
    await connect(app, token, undefined, false, undefined, "0.9.0");
    await vi.waitFor(() => expect(repository.devices.get(device.id)?.appVersion).toBe("0.9.0"));
    // Older Macs that send no metadata keep the stored version.
    await connect(app, token);
    expect(repository.devices.get(device.id)?.appVersion).toBe("0.9.0");
    for (const malformed of ["", "1.0.0 2.0.0", "a".repeat(41), ["1.0.0", "2.0.0"]]) {
      const { ready } = await connect(app, token, undefined, false, undefined, malformed);
      expect(ready.type).toBe("ready");
      expect(repository.devices.get(device.id)?.appVersion).toBe("0.9.0");
    }
    const after = repository.devices.get(device.id);
    expect(after && {
      id: after.id, ownerId: after.ownerId, name: after.name, platform: after.platform,
      arch: after.arch, tokenHash: after.tokenHash, capabilitiesJson: after.capabilitiesJson,
      authValidAfter: after.authValidAfter, revokedAt: after.revokedAt, createdAt: after.createdAt,
    }).toEqual(identity);
  });

  it("sends ready and answers pings while the version write is still pending", async () => {
    const { app, repository } = await fixture();
    const { device, token } = await paired(app);
    const gate = barrier();
    let blocked = false;
    const update = repository.updateAppVersion.bind(repository);
    vi.spyOn(repository, "updateAppVersion").mockImplementationOnce(async (row, appVersion, isCurrentConnection, now) => {
      blocked = true;
      await gate.promise;
      await update(row, appVersion, isCurrentConnection, now);
    });
    try {
      const { socket, ready } = await connect(app, token, undefined, false, undefined, "3.1.0");
      expect(ready.type).toBe("ready");
      await vi.waitFor(() => expect(blocked).toBe(true));
      const pong = nextFrame(socket);
      socket.send(JSON.stringify({ type: "ping" }));
      expect(await pong).toEqual({ type: "pong" });
      expect(repository.devices.get(device.id)?.appVersion).toBe("0.1.0");
      gate.resolve();
      await vi.waitFor(() => expect(repository.devices.get(device.id)?.appVersion).toBe("3.1.0"));
    } finally { gate.resolve(); }
  });

  it("keeps an admitted device usable when the version write fails", async () => {
    const { app, repository } = await fixture();
    const { device, token } = await paired(app);
    vi.spyOn(repository, "updateAppVersion").mockRejectedValueOnce(new Error("fixture version write failure"));
    const { socket, ready } = await connect(app, token, undefined, false, undefined, "4.0.0");
    expect(ready.type).toBe("ready");
    const pong = nextFrame(socket);
    socket.send(JSON.stringify({ type: "ping" }));
    expect(await pong).toEqual({ type: "pong" });
    await vi.waitFor(() => expect(repository.updateAppVersion).toHaveBeenCalledTimes(1));
    expect(repository.devices.get(device.id)?.appVersion).toBe("0.1.0");
  });

  it("keeps Windows and revoked devices on their stored version", async () => {
    const { app, repository } = await fixture();
    const windows = await paired(app, "windows");
    await connect(app, windows.token, undefined, false, undefined, "9.9.9");
    expect(repository.devices.get(windows.device.id)?.appVersion).toBe("0.1.0");
    const mac = await paired(app);
    await app.inject({ method: "DELETE", url: `/api/v1/desktop/devices/${mac.device.id}`, headers });
    const socket = new WebSocket(await socketUrl(app), { headers: { [DESKTOP_APP_VERSION_HEADER]: "9.9.9" } });
    sockets.push(socket);
    await once(socket, "open");
    const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
    socket.send(JSON.stringify({ type: "hello", token: mac.token, protocol_version: 1 }));
    expect((await closed)[0]).toBe(4401);
    expect(repository.devices.get(mac.device.id)?.appVersion).toBe("0.1.0");
  });
});
