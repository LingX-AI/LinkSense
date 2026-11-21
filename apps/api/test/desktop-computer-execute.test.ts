import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopExecutionResultSchema,
  desktopComputerQuiesceLifetimeMs,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  type ComputerObservation,
  type DesktopExecutionAck,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
  type DesktopExecutionResult,
  type DesktopNegotiatedOperation,
  type DesktopToolRequest,
} from "@linksense/shared";
import { DesktopDeviceTransport } from "../src/adapters/desktop-device-transport.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import {
  DesktopComputerExecuteFixture,
  DesktopComputerFixtureBindings,
  desktopComputerFixtureBindingKey,
  type DesktopComputerExecuteAuthorize,
  type DesktopComputerExecuteSelect,
} from "../src/modules/desktop-devices/computer-execute.js";
import {
  RedisDesktopDeviceCoordinator,
  type DesktopExecutionBinding,
} from "../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { DesktopRunLeases, type DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
import {
  localComputerGuiOccupancyKey,
  LocalComputerGuiOccupancy,
} from "../src/modules/local-computer/occupancy.js";
import type { LocalComputerActionAuthorization } from "../src/modules/local-computer/authorization.js";
import { registerClientBuildGuard } from "../src/plugins/client-build.js";
import { MemoryDesktopDeviceRepository } from "./desktop-devices.fixture.js";
import { createRedisFixture } from "./fixtures/redis.js";

const owner = "10000000-0000-4000-8000-000000000001";
const headers = { authorization: "Bearer user" };
const registration = { name: "Work laptop", platform: "darwin", arch: "arm64", app_version: "0.1.0" };
const selectionId = "10000000-0000-4000-8000-0000000000aa";
const otherSelectionId = "10000000-0000-4000-8000-0000000000bb";
const bundleId = "com.example.Fixture";
const encryption = { masterKey: randomBytes(32).toString("base64"), keyId: "test" };
const observation: ComputerObservation = {
  observation_id: "obs-1",
  tree_quality: "good",
  truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
};

let redis: Awaited<ReturnType<typeof createRedisFixture>>;

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await redis.close(); });

type Frame = Record<string, unknown>;
type ComputerExecuteToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>;

function frameQueue(socket: WebSocket) {
  const queue: Frame[] = [];
  const waiters: Array<(frame: Frame) => void> = [];
  socket.on("message", data => {
    const frame = JSON.parse(String(data)) as Frame;
    const waiter = waiters.shift();
    if (waiter) waiter(frame);
    else queue.push(frame);
  });
  const next = (): Promise<Frame> => {
    const queued = queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise(resolve => waiters.push(resolve));
  };
  return {
    async until<T extends Frame>(predicate: (frame: Frame) => frame is T): Promise<T> {
      for (;;) {
        const frame = await next();
        if (predicate(frame)) return frame;
      }
    },
    async settle(ms = 120): Promise<Frame[]> {
      await delay(ms);
      return queue.splice(0);
    },
  };
}

const isCommand = (frame: Frame): frame is Frame => frame.type === "command";
const isToolResult = (frame: Frame): frame is Frame => frame.type === "tool.result";
const isCommandCancel = (frame: Frame): frame is Frame => frame.type === "command.cancel";

function commandOf(frame: Frame): Extract<DesktopExecutionCommand, { operation: "computer.execute" }> {
  const command = desktopExecutionCommandSchema.parse(frame);
  if (command.operation !== "computer.execute") throw new Error("unexpected command operation");
  return command;
}

async function fixture(computerExecute: boolean) {
  const repository = new MemoryDesktopDeviceRepository();
  repository.owners.set(owner, { status: "active", authValidAfter: new Date(0) });
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const service = new DesktopDeviceService(repository, coordinator);
  const app = Fastify();
  // Real leases and request/native-call claims; only the transactional grant
  // authority is synthetic in this API-level fixture.
  const leases = new DesktopRunLeases(redis.client, async () => true);
  const select = vi.fn<DesktopComputerExecuteSelect>(() => ({ selectionId, bundleId }));
  const sessionId = randomUUID();
  const grantId = randomUUID();
  const makeAuthorization = (
    input: Parameters<DesktopComputerExecuteAuthorize>[0],
  ): LocalComputerActionAuthorization => ({
    scope: input.scope, sessionId, grantId,
    capability: input.capability, bundleId: input.bundleId,
    expiresAt: new Date(Date.now() + 120_000),
  });
  let authorize = vi.fn<DesktopComputerExecuteAuthorize>(async input => makeAuthorization(input));
  const audit = vi.fn(async () => {});
  const verifyDispatch = vi.fn<(input: {
    scope: DesktopRunScope;
    sessionId: string;
    grantId: string;
    capability: "computer.observe" | "computer.act";
    bundleId: string;
    expiresAt: Date;
  }) => Promise<void>>(async () => {});
  const routeRef: { current?: DesktopComputerExecuteFixture } = {};
  const transport = new DesktopDeviceTransport(
    redis.client,
    async (binding, command, admission) => {
      const scope = {
        ownerId: command.owner_id, deviceId: binding.deviceId, connectionId: binding.connectionId,
        conversationId: command.conversation_id, turnId: command.turn_id,
        runtimeGeneration: command.runtime_generation,
      };
      if (command.operation === "computer.execute") {
        if (command.body.request.kind === "quiesce") {
          // Mirrors the real dispatch path: quiescence only needs live control.
          return coordinator.isCurrentConnection(binding.deviceId, binding.connectionId);
        }
        if (!admission || !routeRef.current || !await leases.isActiveToolScope(scope)) return false;
        return await routeRef.current.admit({
          scope, request: command.body.request,
          sessionId: command.body.session_id, selectionId: command.body.selection_id,
          holderId: command.body.holder_id, admission,
        });
      }
      return await leases.isActiveToolScope(scope);
    },
    app.log, encryption,
    async (
      binding: DesktopExecutionBinding & { ownerId: string; toolOperations: readonly DesktopNegotiatedOperation[] },
      frame: DesktopExecutionCallback,
      signal: AbortSignal,
    ): Promise<DesktopExecutionAck> => {
      if (frame.type !== "tool.request" || frame.operation !== "computer.execute") {
        throw new AppError("FORBIDDEN");
      }
      const scope: DesktopRunScope = {
        ownerId: binding.ownerId, deviceId: binding.deviceId, connectionId: binding.connectionId,
        conversationId: frame.conversation_id, turnId: frame.turn_id, runtimeGeneration: frame.runtime_generation,
      };
      return executeDesktopTool({
        leases,
        audit: { write: audit },
        webSearchSettings: { search: async () => { throw new AppError("RUNNER_UNAVAILABLE"); } },
        knowledgeSearch: null,
        checkPublication: async () => {},
        computerExecute: input => {
          if (!routeRef.current) throw new AppError("RUNNER_UNAVAILABLE");
          return routeRef.current.execute(input);
        },
      }, scope, frame, signal);
    },
  );
  const route = new DesktopComputerExecuteFixture({
    select: input => select(input),
    authorize: input => authorize(input),
    bindings: new DesktopComputerFixtureBindings(redis.client),
    occupancy: new LocalComputerGuiOccupancy(redis.client),
    transport,
    claimNativeCall: (turnId, nativeCallId) => leases.claimComputerNativeCall(turnId, nativeCallId),
    verifyDispatch: input => verifyDispatch(input),
  });
  routeRef.current = route;
  app.decorate("authenticate", async request => {
    if (request.headers.authorization !== "Bearer user") throw new AppError("AUTH_REQUIRED");
    request.authUser = {
      id: owner, name: "User", email: "user@example.test", role: "user", status: "active",
      preferredLocale: null, avatarObjectKey: null, authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  registerClientBuildGuard(app, null);
  await registerDesktopDeviceRoutes(app, {
    service, redis: redis.client, rateLimitHmacSecret: "test-only-desktop-rate-limit-secret",
    execution: transport, computerExecute,
  });
  await app.ready();
  const cleanup = async () => { await app.close(); };
  return {
    app, leases, transport, route, select, audit, verifyDispatch, cleanup,
    authorization: () => authorize,
    makeAuthorization,
    setAuthorize: (next: typeof authorize) => { authorize = next; },
  };
}

async function paired(app: ReturnType<typeof Fastify>) {
  const pairing = await app.inject({ method: "POST", url: "/api/v1/desktop/devices/pairing", headers, payload: {} });
  expect(pairing.statusCode).toBe(200);
  const response = await app.inject({
    method: "POST", url: "/api/v1/desktop/devices/pair", payload: { ...registration, code: pairing.json().data.code },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { token: string; device: { id: string } };
}

function readFrame(socket: WebSocket): Promise<unknown> {
  return once(socket, "message", { signal: AbortSignal.timeout(2_000) }).then(([data]) => JSON.parse(String(data)));
}

async function connect(app: ReturnType<typeof Fastify>, token: string, offer: string | undefined) {
  const address = app.server.listening
    ? `http://127.0.0.1:${(app.server.address() as import("node:net").AddressInfo).port}`
    : await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${address.replace(/^http/u, "ws")}/api/v1/desktop/devices/socket`, {
    headers: {
      [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion),
      ...(offer === undefined ? {} : {
        [DESKTOP_TOOL_PROTOCOL_HEADER]: String(desktopToolProtocolVersion),
        [DESKTOP_TOOL_OPERATIONS_HEADER]: offer,
      }),
    },
  });
  await once(socket, "open");
  const ready = readFrame(socket).then(frame => desktopExecutionDeviceReadySchema.parse(frame));
  socket.send(JSON.stringify({ type: "hello", token, protocol_version: 1 }));
  return { socket, ready: await ready };
}

async function issueRun(
  leases: DesktopRunLeases, deviceId: string, connectionId: string,
  conversationId: string, turnId: string, runtimeGeneration: string,
) {
  return (await leases.issue({ deviceId, connectionId }, {
    ownerId: owner, conversationId, projectionTurnId: turnId, expectedRuntimeGeneration: runtimeGeneration,
    model: "fixture-model",
    modelProvider: {
      revision: 1, protocolMode: "native_responses",
      baseUrl: "https://fixture-provider.example.test/v1", apiKey: randomUUID(),
    },
  })).run_token;
}

function toolRequest(
  kind: "status" | "observe" | "act", scope: DesktopRunScope, runToken: string, nativeCallId = "native-call-1",
): ComputerExecuteToolRequest {
  const request = desktopToolRequestSchema.parse({
    type: "tool.request", id: randomUUID(), conversation_id: scope.conversationId,
    runtime_generation: scope.runtimeGeneration, turn_id: scope.turnId,
    expires_at: new Date(Date.now() + 25_000).toISOString(), run_token: runToken,
    operation: "computer.execute",
    body: kind === "act"
      ? { kind: "act", native_call_id: nativeCallId, input: { action: "click", observation_id: "obs-1", ref: "e1" } }
      : { kind },
  });
  if (request.operation !== "computer.execute") throw new Error("unexpected tool operation");
  return request;
}

function commandResult(command: DesktopExecutionCommand, result: unknown): DesktopExecutionResult {
  return desktopExecutionResultSchema.parse({
    type: "command.result", id: command.id, operation: "computer.execute", ok: true, result,
  });
}

describe("M1b fixture computer.execute route", () => {
  it("negotiates the operation only through the injected fixture gate", async () => {
    const off = await fixture(false);
    try {
      const { token } = await paired(off.app);
      expect((await connect(off.app, token, "web.search,computer.execute")).ready.tool_operations)
        .toEqual(["web.search"]);
    } finally {
      await off.cleanup();
    }
    const on = await fixture(true);
    try {
      const { token } = await paired(on.app);
      expect((await connect(on.app, token, "web.search,computer.execute")).ready.tool_operations)
        .toEqual(["web.search", "computer.execute"]);
      const legacy = await connect(on.app, (await paired(on.app)).token, "web.search");
      expect(legacy.ready.tool_operations).toEqual(["web.search"]);
      const none = await connect(on.app, (await paired(on.app)).token, undefined);
      expect(none.ready.tool_operations).toBeUndefined();
    } finally {
      await on.cleanup();
    }
  });

  it("sends no holder for status, binds the first observe holder, and correlates act with real leases", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      expect(state.authorization()).not.toHaveBeenCalled();

      socket.send(JSON.stringify(toolRequest("status", scope, runToken)));
      const status = commandOf(await frames.until(isCommand));
      expect(status.body).toMatchObject({ selection_id: selectionId, holder_id: null });
      expect(status.body.request).toEqual({ kind: "status" });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(0);
      expect(await redis.client.exists(desktopComputerFixtureBindingKey(scope))).toBe(0);
      socket.send(JSON.stringify(commandResult(status, {
        kind: "status", result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "status", result: { available: true } },
      });

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      expect(observe.body.holder_id).toMatch(/^[0-9a-f-]{36}$/u);
      expect(observe.body).toMatchObject({ session_id: status.body.session_id, selection_id: selectionId });
      const stored = JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(device.id)) ?? "null");
      expect(stored).toMatchObject({ holderId: observe.body.holder_id, selectionId });
      expect(await redis.client.exists(desktopComputerFixtureBindingKey(scope))).toBe(1);
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "observe", result: observation },
      });

      expect(state.authorization()).toHaveBeenCalledTimes(2);
      expect(Object.keys(state.authorization().mock.calls[0]![0]).sort())
        .toEqual(["bundleId", "capability", "runToken", "scope"]);
      expect(state.authorization().mock.calls[0]![0]).toMatchObject({
        capability: "computer.observe", bundleId, runToken, scope,
      });

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      expect(act.body).toMatchObject({
        session_id: observe.body.session_id, selection_id: selectionId, holder_id: observe.body.holder_id,
        request: { kind: "act", native_call_id: "native-call-1", input: { action: "click", ref: "e1" } },
      });
      expect(state.authorization().mock.calls[2]![0]).toMatchObject({ capability: "computer.act", scope });
      expect(await redis.client.keys("linksense:desktop-native-call:*")).toHaveLength(1);
      socket.send(JSON.stringify(commandResult(act, {
        kind: "act", result: { ok: true, effect: "done", waited_ms: 3 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "act", result: { ok: true, effect: "done", waited_ms: 3 } },
      });
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        action: "desktop_tool_requested", result: "success",
        metadata: expect.objectContaining({ operation: "computer.execute", turn_id: turnId }),
      }));
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("claims a native call once across request UUIDs and never re-dispatches it", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const first = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(first, {
        kind: "act", result: { ok: false, error: "COMPUTER_STALE_REF", waited_ms: 0 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "act", result: { ok: false, error: "COMPUTER_STALE_REF" } },
      });
      // A failed act after reaching the Mac is audited as failed, not success.
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        result: "failed",
        metadata: expect.objectContaining({ reason_code: "COMPUTER_STALE_REF" }),
      }));

      // Same native call ID, different tool-request UUID: no second command.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(await redis.client.keys("linksense:desktop-native-call:*")).toHaveLength(1);
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("denies a queued act when its admission recheck fails before the socket", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let admissionStarted!: () => void;
      const started = new Promise<void>(resolve => { admissionStarted = resolve; });
      let grantRevoked = false;
      state.verifyDispatch.mockImplementationOnce(async () => {
        admissionStarted();
        await gate;
        // The real DB recheck runs against the original grant/session here.
        if (grantRevoked) throw new AppError("FORBIDDEN");
      });

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      await started;
      // The command is already queued in encrypted Redis, but has not reached
      // the socket. Revoke the grant, then let the dispatch admission decide.
      grantRevoked = true;
      release();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(state.verifyDispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        capability: "computer.act", scope, bundleId,
      }));
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
      expect(await redis.client.exists(desktopComputerFixtureBindingKey(scope))).toBe(1);
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        result: "failed", metadata: expect.objectContaining({ reason_code: "COMPUTER_ACCESS_DENIED" }),
      }));
    } finally {
      await state.cleanup();
    }
  });

  it("denies a different authorization scope and reports busy and changed targets without a command", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      state.setAuthorize(vi.fn(async input => ({
        ...state.makeAuthorization(input), scope: { ...input.scope, turnId: randomUUID() },
      })));
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });

      state.setAuthorize(vi.fn(async input => state.makeAuthorization(input)));
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      // A second run on the same device cannot acquire while this holder lives.
      const competing = { ...scope, conversationId: randomUUID(), turnId: randomUUID() };
      const competingToken = await issueRun(
        state.leases, device.id, binding.connectionId, competing.conversationId, competing.turnId, runtimeGeneration,
      );
      socket.send(JSON.stringify(toolRequest("observe", competing, competingToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "DEVICE_BUSY" },
      });
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "observe" } });

      state.select.mockReturnValue({ selectionId: otherSelectionId, bundleId });
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("cancels an in-flight act without releasing occupancy or accepting a late success", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      const request = toolRequest("act", scope, runToken);
      socket.send(JSON.stringify(request));
      const act = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify({
        type: "tool.cancel", id: request.id, operation: "computer.execute",
        conversation_id: request.conversation_id, turn_id: request.turn_id,
        runtime_generation: request.runtime_generation,
      }));
      expect(await frames.until(isCommandCancel)).toMatchObject({ type: "command.cancel", id: act.id });
      socket.send(JSON.stringify(commandResult(act, {
        kind: "act", result: { ok: true, effect: "done", waited_ms: 1 },
      })));
      expect((await frames.settle()).filter(frame => frame.type === "tool.result")).toEqual([]);
      // Lost proof is audited as a failed/uncertain act, never success.
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({ result: "failed" }));
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
      expect(await redis.client.exists(desktopComputerFixtureBindingKey(scope))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("releases occupancy only after a correlated quiesce ack and retains it without proof", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      const occupancyKey = localComputerGuiOccupancyKey(device.id);
      const bindingKey = desktopComputerFixtureBindingKey(scope);
      expect(await redis.client.exists(occupancyKey)).toBe(1);

      const pending = state.route.quiesce({ scope, signal: AbortSignal.timeout(2_000) });
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body).toMatchObject({ holder_id: observe.body.holder_id, request: { kind: "quiesce" } });
      expect(Date.parse(quiesce.expires_at) - Date.now()).toBeLessThanOrEqual(5_000);
      expect(state.authorization()).toHaveBeenCalledTimes(1);
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      await expect(pending).resolves.toEqual({ kind: "quiesce", result: { quiesced: true } });
      expect(await redis.client.exists(occupancyKey)).toBe(0);
      expect(await redis.client.exists(bindingKey)).toBe(0);

      // Without an ack, cancellation or a late success must not release.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const again = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(again, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      expect(await redis.client.exists(occupancyKey)).toBe(1);
      const controller = new AbortController();
      const aborted = state.route.quiesce({ scope, signal: controller.signal });
      const blocked = commandOf(await frames.until(isCommand));
      controller.abort();
      await expect(aborted).rejects.toBeDefined();
      socket.send(JSON.stringify(commandResult(blocked, { kind: "quiesce", result: { quiesced: true } })));
      await frames.settle();
      expect(await redis.client.exists(occupancyKey)).toBe(1);
      expect(await redis.client.exists(bindingKey)).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("stops revoked input through quiesce while refusing a revoked act", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      await state.leases.revoke(turnId);
      // A revoked run can no longer act, even with a live holder.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: false, error_code: "FORBIDDEN" });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // Quiescence is control, not authorization: it still stops the old input.
      const pending = state.route.quiesce({ scope, signal: AbortSignal.timeout(2_000) });
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      await expect(pending).resolves.toEqual({ kind: "quiesce", result: { quiesced: true } });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(0);
      expect(await redis.client.exists(desktopComputerFixtureBindingKey(scope))).toBe(0);
    } finally {
      await state.cleanup();
    }
  });

  it("retains exact holder metadata for a bounded grace after natural expiry and never releases a newer holder", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      const occupancyKey = localComputerGuiOccupancyKey(device.id);
      const bindingKey = desktopComputerFixtureBindingKey(scope);

      // The first authorization (and therefore occupancy) expires naturally.
      state.setAuthorize(vi.fn(async input => ({
        ...state.makeAuthorization(input), expiresAt: new Date(Date.now() + 300),
      })));
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const first = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(first, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      await delay(400);
      expect(await redis.client.exists(occupancyKey)).toBe(0);
      const graceTtl = await redis.client.pttl(bindingKey);
      expect(graceTtl).toBeGreaterThan(0);
      expect(graceTtl).toBeLessThanOrEqual(desktopComputerQuiesceLifetimeMs);

      // The retained metadata can still stop the expired holder.
      const pending = state.route.quiesce({ scope, signal: AbortSignal.timeout(3_000) });
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body.holder_id).toBe(first.body.holder_id);

      // A fresh authorization proves a newer occupancy; grace must not block it.
      state.setAuthorize(vi.fn(async input => state.makeAuthorization(input)));
      const second = state.route.execute({
        scope, request: toolRequest("observe", scope, runToken), signal: AbortSignal.timeout(3_000),
      });
      const newer = commandOf(await frames.until(isCommand));
      expect(newer.body.holder_id).not.toBe(first.body.holder_id);
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null"))
        .toMatchObject({ holderId: newer.body.holder_id });
      expect(JSON.parse(await redis.client.get(bindingKey) ?? "null"))
        .toMatchObject({ holderId: newer.body.holder_id });

      // The stale quiesce ack may only compare-delete its own holder.
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      await expect(pending).resolves.toEqual({ kind: "quiesce", result: { quiesced: true } });
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null"))
        .toMatchObject({ holderId: newer.body.holder_id });
      expect(JSON.parse(await redis.client.get(bindingKey) ?? "null"))
        .toMatchObject({ holderId: newer.body.holder_id });

      socket.send(JSON.stringify(commandResult(newer, { kind: "observe", result: observation })));
      await expect(second).resolves.toMatchObject({ kind: "observe", result: observation });
    } finally {
      await state.cleanup();
    }
  });

  it("fails closed for malformed or beyond-grace state and retains revoked no-ack metadata only for the grace", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      const occupancyKey = localComputerGuiOccupancyKey(device.id);
      const bindingKey = desktopComputerFixtureBindingKey(scope);

      await redis.client.set(bindingKey, "{not-json", "PX", 10_000);
      await expect(state.route.quiesce({ scope, signal: AbortSignal.timeout(1_000) }))
        .resolves.toEqual({ kind: "failure", error: "COMPUTER_UNAVAILABLE" });
      expect(await frames.settle()).toEqual([]);

      await redis.client.set(bindingKey, JSON.stringify({
        v: 1, selectionId, sessionId: randomUUID(), holderId: randomUUID(),
        binding: { deviceId: device.id, connectionId: binding.connectionId, gatewayId: binding.gatewayId },
        expiresAt: Date.now() - 10_000,
      }), "PX", 60_000);
      await expect(state.route.quiesce({ scope, signal: AbortSignal.timeout(1_000) }))
        .resolves.toEqual({ kind: "failure", error: "COMPUTER_UNAVAILABLE" });
      expect(await frames.settle()).toEqual([]);
      expect(await redis.client.exists(bindingKey)).toBe(1);

      // Revoked run + natural expiry + no matching ack: only the bounded grace
      // metadata remains, and nothing is released.
      await redis.client.del(bindingKey);
      state.setAuthorize(vi.fn(async input => ({
        ...state.makeAuthorization(input), expiresAt: new Date(Date.now() + 300),
      })));
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      await state.leases.revoke(turnId);
      await delay(400);
      expect(await redis.client.exists(occupancyKey)).toBe(0);

      const controller = new AbortController();
      const pending = state.route.quiesce({ scope, signal: controller.signal });
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body.holder_id).toBe(observe.body.holder_id);
      controller.abort();
      await expect(pending).rejects.toBeDefined();
      const graceTtl = await redis.client.pttl(bindingKey);
      expect(graceTtl).toBeGreaterThan(0);
      expect(graceTtl).toBeLessThanOrEqual(desktopComputerQuiesceLifetimeMs);
      expect(await redis.client.exists(occupancyKey)).toBe(0);
    } finally {
      await state.cleanup();
    }
  });

  it("rejects an unnegotiated old client and keeps a stale holder out of a replacement connection", async () => {
    const state = await fixture(true);
    try {
      const { device, token } = await paired(state.app);
      const legacy = await connect(state.app, token, "web.search");
      const legacyClosed = once(legacy.socket, "close", { signal: AbortSignal.timeout(2_000) });
      legacy.socket.send(JSON.stringify(toolRequest("status", {
        ownerId: owner, deviceId: device.id, connectionId: randomUUID(),
        conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
      }, `lsdr_${"a".repeat(43)}`)));
      expect((await legacyClosed)[0]).toBe(4400);

      const first = await connect(state.app, token, "computer.execute");
      const frames = frameQueue(first.socket);
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("fixture did not negotiate execution");
      const conversationId = randomUUID();
      const turnId = randomUUID();
      const runtimeGeneration = randomUUID();
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId, turnId, runtimeGeneration,
      };
      const runToken = await issueRun(
        state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration,
      );
      first.socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      first.socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      const replacement = await connect(state.app, token, "computer.execute");
      const replacementFrames = frameQueue(replacement.socket);
      const replacementBinding = await state.transport.connection(device.id);
      if (!replacementBinding) throw new Error("replacement did not negotiate execution");
      const replacementTurnId = randomUUID();
      const replacementScope = {
        ...scope, connectionId: replacementBinding.connectionId, turnId: replacementTurnId,
      };
      const replacementToken = await issueRun(
        state.leases, device.id, replacementBinding.connectionId, conversationId, replacementTurnId, runtimeGeneration,
      );
      replacement.socket.send(JSON.stringify(toolRequest("act", replacementScope, replacementToken)));
      expect(await replacementFrames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_STALE_OBSERVATION" },
      });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
      // Quiesce through the superseded scope is not strictly current control.
      await expect(state.route.quiesce({ scope, signal: AbortSignal.timeout(1_000) }))
        .resolves.toEqual({ kind: "failure", error: "COMPUTER_UNAVAILABLE" });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(device.id))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });
});
