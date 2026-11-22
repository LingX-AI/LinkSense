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
  desktopComputerControlResultSchema,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopExecutionProtocolVersion,
  desktopExecutionResultSchema,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  type ComputerObservation,
  type DesktopComputerControlResult,
  type DesktopExecutionAck,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
  type DesktopToolRequest,
} from "@linksense/shared";
import { DesktopDeviceTransport, DesktopCommandUncertainError } from "../src/adapters/desktop-device-transport.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import {
  DesktopComputerControl,
  DesktopComputerSelectionError,
  desktopComputerSelectionKey,
  type DesktopComputerControlStore,
  type DesktopComputerSelection,
} from "../src/modules/desktop-devices/computer-control.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { RedisDesktopDeviceCoordinator, type DesktopExecutionBinding } from "../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";
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
const bundleId = "com.example.Fixture";
const selectionA = "10000000-0000-4000-8000-0000000000aa";
const selectionB = "10000000-0000-4000-8000-0000000000bb";
const selectionC = "10000000-0000-4000-8000-0000000000cc";
const encryption = { masterKey: randomBytes(32).toString("base64"), keyId: "test" };
const observation: ComputerObservation = {
  observation_id: "obs-1", tree_quality: "good", truncated: false,
  nodes: [{ ref: "e1", role: "button", name: "Continue" }],
};

let redis: Awaited<ReturnType<typeof createRedisFixture>>;

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await redis.close(); });

type Frame = Record<string, unknown>;
type ComputerExecuteToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>;

/** Product-store double: the Redis/PostgreSQL CAS itself is covered by its own tests. */
class FakeControlStore implements DesktopComputerControlStore {
  readonly selections = new Map<string, DesktopComputerSelection>();
  readonly conversations = new Map<string, { deviceId: string; runtimeGeneration: string }>();
  readonly selectCalls: Array<{ scope: DesktopRunScope; selectionId: string; bundleId: string }> = [];
  readonly pauseCalls: Array<{ scope: DesktopRunScope; selectionId: string }> = [];
  readonly resumeCalls: Array<{ scope: DesktopRunScope; selectionId: string; newSelectionId: string }> = [];
  readonly stopCalls: Array<{ scope: DesktopRunScope; selectionId: string }> = [];
  readonly discardCalls: Array<{ scope: DesktopRunScope; selection: DesktopComputerSelection }> = [];
  readonly clearCalls: Array<{ scope: DesktopRunScope; selection: DesktopComputerSelection }> = [];
  readonly claimInputCalls: Array<{ scope: DesktopRunScope; holderId: string; commandId: string }> = [];
  failSelect: Error | undefined;
  failPause: Error | undefined;
  failResume: Error | undefined;
  bindingLiveValue = true;
  finalizeActiveValue: boolean | undefined;
  finalizeActiveCalls = 0;
  sessionExpiryMs = 5 * 60_000;

  async resolve(input: { ownerId: string; deviceId: string; conversationId: string }) {
    const value = this.conversations.get(`${input.conversationId}:${input.deviceId}`);
    return value && input.ownerId === owner ? { runtimeGeneration: value.runtimeGeneration } : null;
  }

  async read(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    const selection = this.selections.get(desktopComputerSelectionKey(scope));
    return selection ? { ...selection } : null;
  }

  async readKeyScope(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    return this.read(scope);
  }

  async bindingLive(): Promise<boolean> {
    return this.bindingLiveValue;
  }

  async claimInput(input: {
    scope: DesktopRunScope; selection: DesktopComputerSelection; holderId: string; commandId: string;
  }): Promise<boolean> {
    this.claimInputCalls.push({
      scope: input.scope, holderId: input.holderId, commandId: input.commandId,
    });
    const selection = this.selections.get(desktopComputerSelectionKey(input.scope));
    if (!selection || selection.selectionId !== input.selection.selectionId ||
        selection.sessionId !== input.selection.sessionId || selection.pendingInput) return false;
    selection.pendingInput = {
      holderId: input.holderId, controlEpoch: selection.controlEpoch,
      admittedAt: Date.now(), commandId: input.commandId,
    };
    return true;
  }

  async clearInput(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
    commandId: string,
  ): Promise<boolean> {
    const current = this.selections.get(desktopComputerSelectionKey(scope));
    if (!current || current.selectionId !== selection.selectionId ||
        current.sessionId !== selection.sessionId || current.controlEpoch !== selection.controlEpoch ||
        current.connectionId !== selection.connectionId ||
        current.pendingInput?.holderId !== holderId ||
        current.pendingInput.commandId !== commandId) return false;
    current.pendingInput = null;
    return true;
  }

  async finalizeActive(input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    verify: () => Promise<boolean>;
    finalize: () => boolean;
  }): Promise<boolean> {
    this.finalizeActiveCalls += 1;
    if (this.finalizeActiveValue !== undefined) return this.finalizeActiveValue;
    const current = this.selections.get(desktopComputerSelectionKey(input.scope));
    if (!current || current.state !== "active" ||
        current.selectionId !== input.selection.selectionId ||
        current.sessionId !== input.selection.sessionId ||
        current.controlEpoch !== input.selection.controlEpoch ||
        current.connectionId !== input.selection.connectionId ||
        current.bundleId !== input.selection.bundleId ||
        current.expiresAt !== input.selection.expiresAt ||
        current.expiresAt <= Date.now()) return false;
    if (!await input.verify()) return false;
    return input.finalize();
  }

  async scopesForTurn(): Promise<DesktopRunScope[]> {
    return [];
  }

  async scopesForDevice(): Promise<DesktopRunScope[]> {
    return [];
  }

  async select(input: { scope: DesktopRunScope; selectionId: string; bundleId: string }): Promise<DesktopComputerSelection> {
    this.selectCalls.push(input);
    if (this.failSelect) throw this.failSelect;
    const key = desktopComputerSelectionKey(input.scope);
    const existing = this.selections.get(key);
    if (existing && existing.connectionId === input.scope.connectionId) {
      if (existing.state === "paused" || existing.state === "pausing") {
        throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
      }
      if (existing.state === "active" && existing.selectionId !== input.selectionId) {
        throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
      }
    }
    const now = Date.now();
    const selection: DesktopComputerSelection = {
      v: 1, state: "active", ownerId: input.scope.ownerId, deviceId: input.scope.deviceId,
      conversationId: input.scope.conversationId, turnId: input.scope.turnId,
      runtimeGeneration: input.scope.runtimeGeneration, connectionId: input.scope.connectionId,
      sessionId: randomUUID(), selectionId: input.selectionId, bundleId: input.bundleId,
      controlEpoch: randomUUID(), expiresAt: now + this.sessionExpiryMs, pendingInput: null,
    };
    this.selections.set(key, selection);
    return selection;
  }

  async pause(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection> {
    this.pauseCalls.push(input);
    if (this.failPause) throw this.failPause;
    const selection = this.require(input.scope, input.selectionId);
    if (selection.state === "paused" || selection.state === "pausing") return selection;
    if (selection.state !== "active") throw new DesktopComputerSelectionError("COMPUTER_UNAVAILABLE");
    selection.state = "pausing";
    return selection;
  }

  async confirmPause(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<DesktopComputerSelection> {
    const selection = this.require(input.scope, input.selection.selectionId);
    if (selection.state === "paused") return selection;
    if (selection.state !== "pausing" || selection.sessionId !== input.selection.sessionId) {
      throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
    }
    selection.state = "paused";
    return selection;
  }

  async resume(input: {
    scope: DesktopRunScope; selectionId: string; newSelectionId: string;
  }): Promise<DesktopComputerSelection> {
    this.resumeCalls.push(input);
    if (this.failResume) throw this.failResume;
    const selection = this.require(input.scope, input.selectionId);
    if (selection.state === "active" && selection.selectionId === input.newSelectionId) return selection;
    if (selection.state !== "paused" || input.newSelectionId === input.selectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
    }
    selection.selectionId = input.newSelectionId;
    selection.state = "active";
    return selection;
  }

  async stop(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection> {
    this.stopCalls.push(input);
    const selection = this.require(input.scope, input.selectionId);
    selection.state = "stopped";
    return selection;
  }

  async clear(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<boolean> {
    this.clearCalls.push({ scope, selection });
    const key = desktopComputerSelectionKey(scope);
    const existing = this.selections.get(key);
    if (!existing || existing.selectionId !== selection.selectionId ||
        existing.connectionId !== selection.connectionId) return false;
    this.selections.delete(key);
    return true;
  }

  async discard(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<void> {
    this.discardCalls.push(input);
    await this.clear(input.scope, input.selection);
  }

  private require(scope: DesktopRunScope, selectionId: string): DesktopComputerSelection {
    const selection = this.selections.get(desktopComputerSelectionKey(scope));
    if (!selection || selection.connectionId !== scope.connectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_UNAVAILABLE");
    }
    if (selection.selectionId !== selectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
    }
    return selection;
  }
}

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
const isControlResult = (frame: Frame): frame is Frame => frame.type === "computer.control.result";

async function waitFor(predicate: () => Promise<boolean> | boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached");
    await delay(10);
  }
}

function commandOf(frame: Frame): Extract<DesktopExecutionCommand, { operation: "computer.execute" }> {
  const command = desktopExecutionCommandSchema.parse(frame);
  if (command.operation !== "computer.execute") throw new Error("unexpected command operation");
  return command;
}

function controlResultOf(frame: Frame): DesktopComputerControlResult {
  return desktopComputerControlResultSchema.parse(frame);
}

function controlFrame(action: "select" | "pause" | "resume" | "stop", scope: DesktopRunScope, selectionId: string, extra = {}) {
  return {
    type: "computer.control", id: randomUUID(),
    body: {
      action, conversation_id: scope.conversationId, turn_id: scope.turnId, selection_id: selectionId,
      ...(action === "select" ? { bundle_id: bundleId } : {}),
      ...extra,
    },
  };
}

async function fixture() {
  const repository = new MemoryDesktopDeviceRepository();
  repository.owners.set(owner, { status: "active", authValidAfter: new Date(0) });
  const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  const service = new DesktopDeviceService(repository, coordinator);
  const app = Fastify();
  const leases = new DesktopRunLeases(redis.client, async () => true);
  const store = new FakeControlStore();
  const occupancy = new LocalComputerGuiOccupancy(redis.client);
  const audit = vi.fn(async () => {});
  let authorizeFailure: Error | undefined;
  let verifyGate: Promise<void> | undefined;
  let verifyFailure: Error | undefined;
  let verifyStartResolvers: Array<() => void> = [];
  const authorize = vi.fn(async (input: {
    scope: DesktopRunScope;
    capability: "computer.observe" | "computer.act";
    bundleId: string;
  }): Promise<LocalComputerActionAuthorization> => {
    if (authorizeFailure) throw authorizeFailure;
    const selection = await store.read(input.scope);
    if (!selection) throw new AppError("FORBIDDEN");
    return {
      scope: input.scope, sessionId: selection.sessionId, grantId: randomUUID(),
      capability: input.capability, bundleId: input.bundleId, expiresAt: new Date(Date.now() + 120_000),
    };
  });
  const verifyDispatch = vi.fn(async (
    _input: {
      scope: DesktopRunScope;
      sessionId: string;
      grantId: string;
      capability: "computer.observe" | "computer.act";
      bundleId: string;
      expiresAt: Date;
    },
    finalize?: () => boolean | Promise<boolean>,
  ) => {
    const started = verifyStartResolvers;
    verifyStartResolvers = [];
    for (const resolve of started) resolve();
    if (verifyGate) await verifyGate;
    if (verifyFailure) throw verifyFailure;
    if (finalize && !await finalize()) throw new AppError("FORBIDDEN");
  });
  const routeRef: { control?: DesktopComputerControl } = {};
  const transport = new DesktopDeviceTransport(
    redis.client,
    async (binding, command, admission, barrier) => {
      const scope = {
        ownerId: command.owner_id, deviceId: binding.deviceId, connectionId: binding.connectionId,
        conversationId: command.conversation_id, turnId: command.turn_id,
        runtimeGeneration: command.runtime_generation,
      };
      if (command.operation === "computer.execute") {
        if (command.body.request.kind === "quiesce") {
          return coordinator.isCurrentConnection(binding.deviceId, binding.connectionId);
        }
        if (!admission || !routeRef.control) return false;
        return await routeRef.control.admit({
          scope, request: command.body.request, commandId: command.id,
          sessionId: command.body.session_id, selectionId: command.body.selection_id,
          holderId: command.body.holder_id, admission,
        }, barrier);
      }
      return await leases.isActiveToolScope(scope);
    },
    app.log, encryption,
    async (
      binding: DesktopExecutionBinding & { ownerId: string; toolOperations: readonly string[] },
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
          if (!routeRef.control) throw new AppError("RUNNER_UNAVAILABLE");
          return routeRef.control.execute(input);
        },
      }, scope, frame, signal);
    },
  );
  const control = new DesktopComputerControl({
    store, transport, occupancy, authorize,
    verifyDispatch: (input, finalize) => verifyDispatch(input, finalize),
    claimNativeCall: (turnId, nativeCallId) => leases.claimComputerNativeCall(turnId, nativeCallId),
  });
  routeRef.control = control;
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
    execution: transport, computerExecute: true, computerControl: control,
  });
  await app.ready();
  const cleanup = async () => { await app.close(); };
  return {
    app, leases, store, control, transport, occupancy, audit, authorize, verifyDispatch, cleanup,
    nextVerifyStarted: () => new Promise<void>(resolve => { verifyStartResolvers.push(resolve); }),
    setAuthorizeFailure: (error: Error | undefined) => { authorizeFailure = error; },
    setVerifyGate: (gate: Promise<void> | undefined) => { verifyGate = gate; },
    setVerifyFailure: (error: Error | undefined) => { verifyFailure = error; },
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
  kind: "status" | "observe" | "act", scope: DesktopRunScope, runToken: string,
  extra: Record<string, unknown> = {}, nativeCallId = "native-call-1",
): ComputerExecuteToolRequest {
  const request = desktopToolRequestSchema.parse({
    type: "tool.request", id: randomUUID(), conversation_id: scope.conversationId,
    runtime_generation: scope.runtimeGeneration, turn_id: scope.turnId,
    expires_at: new Date(Date.now() + 25_000).toISOString(), run_token: runToken,
    operation: "computer.execute",
    body: kind === "act"
      ? { kind: "act", native_call_id: nativeCallId, input: { action: "click", observation_id: "obs-1", ref: "e1" } }
      : { kind },
    ...extra,
  });
  if (request.operation !== "computer.execute") throw new Error("unexpected tool operation");
  return request;
}

function commandResult(command: DesktopExecutionCommand, result: unknown) {
  return desktopExecutionResultSchema.parse({
    type: "command.result", id: command.id, operation: "computer.execute", ok: true, result,
  });
}

async function prepareSocket(
  state: Awaited<ReturnType<typeof fixture>>, offer = "computer.execute",
) {
  const { device, token } = await paired(state.app);
  const { socket } = await connect(state.app, token, offer);
  const frames = frameQueue(socket);
  const binding = await state.transport.connection(device.id);
  if (!binding) throw new Error("product socket did not negotiate execution");
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const runtimeGeneration = randomUUID();
  const scope: DesktopRunScope = {
    ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
    conversationId, turnId, runtimeGeneration,
  };
  state.store.conversations.set(`${conversationId}:${device.id}`, { deviceId: device.id, runtimeGeneration });
  const runToken = await issueRun(state.leases, device.id, binding.connectionId, conversationId, turnId, runtimeGeneration);
  return { token, socket, frames, binding, scope, runToken, device };
}

async function select(state: Awaited<ReturnType<typeof fixture>>, socket: WebSocket, frames: ReturnType<typeof frameQueue>, scope: DesktopRunScope, selectionId = selectionA) {
  const frame = controlFrame("select", scope, selectionId);
  socket.send(JSON.stringify(frame));
  const result = controlResultOf(await frames.until(isControlResult));
  expect(result).toMatchObject({ type: "computer.control.result", id: frame.id, ok: true });
  return result;
}

describe("M1b product computer control", () => {
  it("selects only through the negotiated authenticated socket and bind the server ids", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const result = await select(state, socket, frames, scope);
      if (!result.ok) throw new Error("select failed");
      expect(result.data.state).toBe("active");
      expect(result.data.selection_id).toBe(selectionA);
      expect(result.data.runtime_generation).toBe(scope.runtimeGeneration);
      expect(state.store.selectCalls).toHaveLength(1);
      expect(state.store.selectCalls[0]).toMatchObject({
        scope: { ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
          conversationId: scope.conversationId, turnId: scope.turnId, runtimeGeneration: scope.runtimeGeneration },
        selectionId: selectionA, bundleId,
      });

      const observe = toolRequest("observe", scope, runToken);
      socket.send(JSON.stringify(observe));
      const command = commandOf(await frames.until(isCommand));
      expect(command.body).toMatchObject({
        session_id: result.data.session_id, selection_id: result.data.selection_id, holder_id: expect.any(String),
        request: { kind: "observe" },
      });
      expect(JSON.stringify(command)).not.toMatch(/window|pid|title|\/tmp/u);
      socket.send(JSON.stringify(commandResult(command, { kind: "observe", result: observation })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "observe", result: observation } });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("rejects control before computer.execute negotiation", async () => {
    const state = await fixture();
    try {
      const { device, token } = await paired(state.app);
      const { socket } = await connect(state.app, token, "web.search");
      const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
      const binding = await state.transport.connection(device.id);
      if (!binding) throw new Error("execution binding missing");
      const scope: DesktopRunScope = {
        ownerId: owner, deviceId: device.id, connectionId: binding.connectionId,
        conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
      };
      socket.send(JSON.stringify(controlFrame("select", scope, selectionA)));
      expect((await closed)[0]).toBe(4400);
      expect(state.store.selectCalls).toHaveLength(0);
    } finally {
      await state.cleanup();
    }
  });

  it("fails foreign, cloud, and unbound conversations without mutating selection", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      const foreign = { ...scope, conversationId: randomUUID() };
      socket.send(JSON.stringify(controlFrame("select", foreign, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACCESS_DENIED",
      });
      expect(state.store.selectCalls).toHaveLength(0);

      state.store.failSelect = new AppError("FORBIDDEN");
      socket.send(JSON.stringify(controlFrame("select", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACCESS_DENIED",
      });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);
    } finally {
      await state.cleanup();
    }
  });

  it("does not acknowledge or replace a refused same-id renewal", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const key = desktopComputerSelectionKey(scope);
      const before = state.store.selections.get(key);
      if (!before) throw new Error("selection missing");

      const failures = [
        { error: new DesktopComputerSelectionError("COMPUTER_ACCESS_DENIED"), code: "COMPUTER_ACCESS_DENIED" },
        { error: new DesktopComputerSelectionError("COMPUTER_TIMEOUT"), code: "COMPUTER_TIMEOUT" },
        { error: new Error("database unavailable"), code: "COMPUTER_UNAVAILABLE" },
      ] as const;
      for (const failure of failures) {
        state.store.failSelect = failure.error;
        const frame = controlFrame("select", scope, selectionA);
        socket.send(JSON.stringify(frame));
        expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
          id: frame.id, ok: false, error_code: failure.code,
        });
        expect(state.store.selections.get(key)).toEqual(before);
        expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);
      }
      expect(state.store.selectCalls).toHaveLength(4);
    } finally {
      await state.cleanup();
    }
  });

  it("ignores target fields from the tool request and closes on a non-strict frame", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
      socket.send(JSON.stringify({
        type: "tool.request", id: randomUUID(), conversation_id: scope.conversationId,
        runtime_generation: scope.runtimeGeneration, turn_id: scope.turnId,
        expires_at: new Date(Date.now() + 25_000).toISOString(), run_token: `lsdr_${"a".repeat(43)}`,
        operation: "computer.execute",
        body: { kind: "observe", bundle_id: bundleId, selection_id: selectionB, window_id: 4 },
      }));
      expect((await closed)[0]).toBe(4400);
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(scope.deviceId)) ?? "null")).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("pauses only after the native quiesce ack and rejects a queued old act", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      let releaseVerify!: () => void;
      const verifyGate = new Promise<void>(resolve => { releaseVerify = resolve; });
      state.setVerifyGate(verifyGate);
      const actStarted = state.nextVerifyStarted();
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() })));
      await actStarted;

      const pauseFrame = controlFrame("pause", scope, selectionA);
      socket.send(JSON.stringify(pauseFrame));
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body).toMatchObject({
        holder_id: observe.body.holder_id, selection_id: selectionA, request: { kind: "quiesce" },
      });
      expect(Date.parse(quiesce.expires_at) - Date.now()).toBeLessThanOrEqual(5_000);
      // Before the exact native ack, no success is reported.
      expect((await frames.settle(50)).filter(frame => frame.type === "computer.control.result")).toEqual([]);
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: pauseFrame.id, ok: true, data: { state: "paused", session_id: selected.data.session_id },
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("paused");
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);

      state.setVerifyGate(undefined);
      releaseVerify();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("does not report pause success when the native ack is a failure, and keeps admission closed", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, {
        kind: "failure", error: "COMPUTER_ACTION_FAILED",
      })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACTION_FAILED",
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("pausing");
    } finally {
      await state.cleanup();
    }
  });

  it("pages through pause, explicit resume, and fresh observe without reviving old actions", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const first = await select(state, socket, frames, scope);
      if (!first.ok) throw new Error("select failed");
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ ok: true, data: { state: "paused" } });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });

      socket.send(JSON.stringify(controlFrame("resume", scope, selectionA, { new_selection_id: selectionB })));
      const resumed = controlResultOf(await frames.until(isControlResult));
      expect(resumed).toMatchObject({ ok: true, data: { state: "active", selection_id: selectionB } });
      expect(state.store.resumeCalls).toHaveLength(1);

      // Resume does not revive an act; a fresh observe is required.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_STALE_OBSERVATION" },
      });

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      expect(observe.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      expect(act.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(act, { kind: "act", result: { ok: true, effect: "done", waited_ms: 1 } })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "act" } });
    } finally {
      await state.cleanup();
    }
  });

  it("stops, revokes every later use, and releases after the exact native ack", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(controlFrame("stop", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      const stopped = controlResultOf(await frames.until(isControlResult));
      if (!stopped.ok) throw new Error("stop failed");
      expect(stopped.data.state).toBe("stopped");
      expect(state.store.stopCalls).toHaveLength(1);
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("cleans selection, occupancy, and the exact session on run revoke without releasing a newer holder", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      const occupancyKey = localComputerGuiOccupancyKey(device.id);
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({ holderId: observe.body.holder_id });

      // A newer holder on the same device must survive stale cleanup.
      await redis.client.set(occupancyKey, JSON.stringify({
        v: 1, holderId: randomUUID(), expiresAt: Date.now() + 30_000,
        scope, sessionId: randomUUID(), bundleId, selectionId: selectionC,
      }), "PX", 30_000);
      await state.control.revokeTurn(scope.turnId);
      expect(state.store.discardCalls).toHaveLength(1);
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({ selectionId: selectionC });

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
    } finally {
      await state.cleanup();
    }
  });

  it("denies a queued act after a run revoke without sending it", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      let releaseVerify!: () => void;
      state.setVerifyGate(new Promise<void>(resolve => { releaseVerify = resolve; }));
      const started = state.nextVerifyStarted();
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() })));
      await started;
      await state.control.revokeTurn(scope.turnId);
      expect(state.store.discardCalls).toHaveLength(1);
      releaseVerify();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("keeps selections per device and per turn", async () => {
    const state = await fixture();
    try {
      const first = await prepareSocket(state);
      await select(state, first.socket, first.frames, first.scope);

      const second = await paired(state.app);
      const secondSocket = await connect(state.app, second.token, "computer.execute");
      const secondFrames = frameQueue(secondSocket.socket);
      secondSocket.socket.send(JSON.stringify(controlFrame("select", first.scope, selectionB)));
      expect(controlResultOf(await secondFrames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACCESS_DENIED",
      });
      expect(state.store.selectCalls).toHaveLength(1);

      const secondTurn: DesktopRunScope = {
        ...first.scope, turnId: randomUUID(),
      };
      const secondToken = await issueRun(
        state.leases, secondTurn.deviceId, secondTurn.connectionId,
        secondTurn.conversationId, secondTurn.turnId, secondTurn.runtimeGeneration,
      );
      first.socket.send(JSON.stringify(toolRequest("observe", secondTurn, secondToken)));
      expect(await first.frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      const selected = controlResultOf(await (async () => {
        first.socket.send(JSON.stringify(controlFrame("select", secondTurn, selectionB)));
        return await first.frames.until(isControlResult);
      })());
      expect(selected).toMatchObject({ ok: true, data: { selection_id: selectionB } });
      expect(state.store.selections.has(desktopComputerSelectionKey(secondTurn))).toBe(true);
    } finally {
      await state.cleanup();
    }
  });

  it("fences a queued act across an explicit renewal without disturbing the live holder", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      let releaseVerify!: () => void;
      state.setVerifyGate(new Promise<void>(resolve => { releaseVerify = resolve; }));
      const started = state.nextVerifyStarted();
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() })));
      await started;
      const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
      if (!selection) throw new Error("selection missing");
      // Simulate the explicit renewal commit while the act waits for its DB
      // recheck: same session, advanced control epoch.
      selection.controlEpoch = randomUUID();
      releaseVerify();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // The live holder and session remain usable under the new epoch.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() }, "native-call-2")));
      const act = commandOf(await frames.until(isCommand));
      expect(act.body.holder_id).toBe(observe.body.holder_id);
      socket.send(JSON.stringify(commandResult(act, { kind: "act", result: { ok: true, effect: "done", waited_ms: 1 } })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "act" } });
    } finally {
      await state.cleanup();
    }
  });

  it("rejects a repeated control id without replaying it", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      const frame = controlFrame("select", scope, selectionA);
      socket.send(JSON.stringify(frame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ id: frame.id, ok: true });
      socket.send(JSON.stringify(frame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: frame.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      expect(state.store.selectCalls).toHaveLength(1);
    } finally {
      await state.cleanup();
    }
  });

  it("retains one answer for a duplicate of the in-flight control id", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      let releaseFinalize!: () => void;
      const finalizeGate = new Promise<void>(resolve => { releaseFinalize = resolve; });
      let finalizeStarted!: () => void;
      const started = new Promise<void>(resolve => { finalizeStarted = resolve; });
      const originalFinalize = state.store.finalizeActive.bind(state.store);
      state.store.finalizeActive = async input => {
        finalizeStarted();
        await finalizeGate;
        return originalFinalize(input);
      };

      const frame = controlFrame("select", scope, selectionA);
      socket.send(JSON.stringify(frame));
      await started;
      // The duplicate arrives while the original transition is still in
      // flight. It must not produce a failure before the original ack.
      socket.send(JSON.stringify(frame));
      await delay(100);
      expect((await frames.settle(0)).filter(frame => frame.type === "computer.control.result")).toEqual([]);

      releaseFinalize();
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: frame.id, ok: true,
      });
      expect((await frames.settle(100)).filter(frame => frame.type === "computer.control.result")).toEqual([]);
      expect(state.store.selectCalls).toHaveLength(1);

      // Once finished, the bounded finished-id policy still rejects a replay.
      socket.send(JSON.stringify(frame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: frame.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
    } finally {
      await state.cleanup();
    }
  });

  it("does not carry an old selection across a connection replacement", async () => {
    const state = await fixture();
    try {
      const first = await prepareSocket(state);
      await select(state, first.socket, first.frames, first.scope);
      const closed = once(first.socket, "close", { signal: AbortSignal.timeout(2_000) });

      const second = await connect(state.app, first.token, "computer.execute");
      expect((await closed)[0]).toBe(4409);
      const deadline = Date.now() + 2_000;
      while (!state.store.clearCalls.length && Date.now() < deadline) await delay(20);
      expect(state.store.clearCalls.length).toBeGreaterThan(0);

      const replacementBinding = await state.transport.connection(first.device.id);
      if (!replacementBinding) throw new Error("replacement binding missing");
      const replacementScope = {
        ...first.scope, connectionId: replacementBinding.connectionId, turnId: randomUUID(),
      };
      state.store.conversations.set(`${replacementScope.conversationId}:${first.device.id}`, {
        deviceId: first.device.id, runtimeGeneration: replacementScope.runtimeGeneration,
      });
      const token = await issueRun(
        state.leases, first.device.id, replacementBinding.connectionId,
        replacementScope.conversationId, replacementScope.turnId, replacementScope.runtimeGeneration,
      );
      const frames = frameQueue(second.socket);
      second.socket.send(JSON.stringify(toolRequest("observe", replacementScope, token)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      const selected = controlResultOf(await (async () => {
        second.socket.send(JSON.stringify(controlFrame("select", replacementScope, selectionB)));
        return await frames.until(isControlResult);
      })());
      expect(selected).toMatchObject({ ok: true, data: { selection_id: selectionB } });
    } finally {
      await state.cleanup();
    }
  });

  it("does not acknowledge pause when the quiesce ack is lost and retries the exact transition", async () => {
    const store = new FakeControlStore();
    const scope: DesktopRunScope = {
      ownerId: owner, deviceId: randomUUID(), connectionId: randomUUID(),
      conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
    };
    store.conversations.set(`${scope.conversationId}:${scope.deviceId}`, {
      deviceId: scope.deviceId, runtimeGeneration: scope.runtimeGeneration,
    });
    const selection = await store.select({ scope, selectionId: selectionA, bundleId });
    const pendingCommandId = randomUUID();
    selection.pendingInput = {
      holderId: randomUUID(), controlEpoch: selection.controlEpoch, admittedAt: Date.now(),
      commandId: pendingCommandId,
    };
    let sends = 0;
    const control = new DesktopComputerControl({
      store,
      transport: {
        connection: async deviceId => ({ deviceId, connectionId: scope.connectionId, gatewayId: randomUUID() }),
        send: async (_binding, command) => {
          sends += 1;
          // The first native ack is lost; the API must not report success and
          // must not replay the command by itself.
          if (sends === 1) throw new DesktopCommandUncertainError();
          return desktopExecutionResultSchema.parse({
            type: "command.result", id: command.id, operation: "computer.execute", ok: true,
            result: { kind: "quiesce", result: { quiesced: true } },
          });
        },
      },
      occupancy: {
        acquire: async () => ({ status: "device_busy" as const }),
        match: async () => ({ status: "not_held" as const, reason: "missing" as const }),
        release: async () => false,
        read: async () => null,
      },
      authorize: async () => { throw new Error("unused"); },
      verifyDispatch: async () => {},
      claimNativeCall: async () => true,
    });
    const pause = () => control.handle({
      ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: {
          action: "pause", conversation_id: scope.conversationId,
          turn_id: scope.turnId, selection_id: selectionA,
        },
      },
    });
    expect(await pause()).toMatchObject({ ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" });
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("pausing");
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeDefined();
    expect(await pause()).toMatchObject({ ok: true, data: { state: "paused" } });
    expect(sends).toBe(2);
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
  });

  it("keeps the authorized observe lease through the grant for a delayed approved act", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      // The lease acquired by the explicit authorized observe must cover the
      // absolute grant, not the 45s GUI occupancy TTL. The fixture grant
      // expires in 120s, so a holder that expires within 45s is too short for
      // the three-minute native approval window.
      const held = JSON.parse(
        await redis.client.get(localComputerGuiOccupancyKey(device.id)) ?? "null",
      ) as { expiresAt?: number; holderId?: string } | null;
      expect(held?.holderId).toBe(observe.body.holder_id);
      expect((held?.expiresAt ?? 0) - Date.now()).toBeGreaterThan(90_000);

      // No act request and no reobserve in between: the same scope and holder
      // run exactly one act.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      expect(act.body).toMatchObject({
        holder_id: observe.body.holder_id, selection_id: selected.data.selection_id,
      });
      socket.send(JSON.stringify(commandResult(act, {
        kind: "act", result: { ok: true, effect: "done", waited_ms: 1 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "act" } });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("retains the adopted observe holder across a native typed failure and a repeated observe", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const occupancyKey = localComputerGuiOccupancyKey(device.id);

      // The device received and adopted the observe holder, then reported a
      // typed native failure. That is not proof of non-delivery.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const first = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(desktopExecutionResultSchema.parse({
        type: "command.result", id: first.id, operation: "computer.execute", ok: false,
        error_code: "RUNNER_UNAVAILABLE",
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({
        holderId: first.body.holder_id,
      });

      // A repeated observe reuses that holder. Its typed failure must not drop
      // the holder the device may already have adopted.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken, { id: randomUUID() })));
      const repeat = commandOf(await frames.until(isCommand));
      expect(repeat.body.holder_id).toBe(first.body.holder_id);
      socket.send(JSON.stringify(desktopExecutionResultSchema.parse({
        type: "command.result", id: repeat.id, operation: "computer.execute", ok: false,
        error_code: "RUNNER_UNAVAILABLE",
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({
        holderId: first.body.holder_id,
      });
    } finally {
      await state.cleanup();
    }
  });

  it("refuses an act after the selection/grant expiry without sending", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
      if (!selection) throw new Error("selection missing");
      selection.expiresAt = Date.now() - 1;
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("keeps a second scope busy until the first observe lease is released", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      const second: DesktopRunScope = { ...scope, turnId: randomUUID() };
      state.store.conversations.set(`${second.conversationId}:${device.id}`, {
        deviceId: device.id, runtimeGeneration: second.runtimeGeneration,
      });
      const secondToken = await issueRun(
        state.leases, device.id, second.connectionId,
        second.conversationId, second.turnId, second.runtimeGeneration,
      );
      socket.send(JSON.stringify(controlFrame("select", second, selectionB)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { selection_id: selectionB },
      });
      socket.send(JSON.stringify(toolRequest("observe", second, secondToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "DEVICE_BUSY" },
      });

      socket.send(JSON.stringify(controlFrame("stop", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "stopped" },
      });

      socket.send(JSON.stringify(toolRequest("observe", second, secondToken)));
      const secondObserve = commandOf(await frames.until(isCommand));
      expect(secondObserve.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(secondObserve, { kind: "observe", result: observation })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "observe" } });
    } finally {
      await state.cleanup();
    }
  });

  it("keeps a rejected second act from clearing the first pending proof", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      // The first act is admitted and sent; its native result stays deferred.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      await frames.until(isCommand);
      const selectionKey = desktopComputerSelectionKey(scope);
      await waitFor(() => state.store.selections.get(selectionKey)?.pendingInput != null);
      const firstPending = state.store.selections.get(selectionKey)?.pendingInput;
      if (!firstPending) throw new Error("pending proof missing");

      // A second act with the exact same holder is rejected without a send.
      // It must not clear the first command's admission proof.
      socket.send(JSON.stringify(toolRequest("act", scope, runToken, { id: randomUUID() }, "native-call-2")));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_ACCESS_DENIED" },
      });
      expect(state.store.selections.get(selectionKey)?.pendingInput).toEqual(firstPending);

      // Occupancy loss is not proof that no input exists: pause must quiesce
      // the exact recorded holder before acknowledging.
      await redis.client.del(localComputerGuiOccupancyKey(device.id));
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body).toMatchObject({
        holder_id: firstPending.holderId, selection_id: selectionA, request: { kind: "quiesce" },
      });
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });
      expect(state.store.selections.get(selectionKey)?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("keeps the pending proof on act uncertainty and clears it after the exact quiesce", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      await waitFor(() => state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput != null);
      // A transport timeout/cancel surfaces as the same bounded uncertainty.
      socket.send(JSON.stringify(desktopExecutionResultSchema.parse({
        type: "command.result", id: act.id, operation: "computer.execute", ok: false,
        error_code: "RUNNER_OPERATION_UNCERTAIN",
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "RUNNER_OPERATION_UNCERTAIN" },
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput)
        .toMatchObject({ commandId: act.id });

      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body.holder_id).toBe(observe.body.holder_id);
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("rolls back only its own marker when the final send is not provable", async () => {
    const store = new FakeControlStore();
    const scope: DesktopRunScope = {
      ownerId: owner, deviceId: randomUUID(), connectionId: randomUUID(),
      conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
    };
    store.conversations.set(`${scope.conversationId}:${scope.deviceId}`, {
      deviceId: scope.deviceId, runtimeGeneration: scope.runtimeGeneration,
    });
    const selection = await store.select({ scope, selectionId: selectionA, bundleId });
    const holderId = randomUUID();
    const held = {
      v: 1 as const, holderId, expiresAt: Date.now() + 45_000, scope,
      sessionId: selection.sessionId, bundleId, selectionId: selection.selectionId,
    };
    const control = new DesktopComputerControl({
      store,
      transport: {
        connection: async deviceId => ({ deviceId, connectionId: scope.connectionId, gatewayId: randomUUID() }),
        send: async () => { throw new Error("unused"); },
      },
      occupancy: {
        acquire: async () => ({ status: "device_busy" as const }),
        match: async () => ({ status: "held" as const, expiresAt: held.expiresAt }),
        release: async () => true,
        read: async () => held,
      },
      authorize: async () => { throw new Error("unused"); },
      verifyDispatch: async (_input, finalize) => {
        if (finalize && !await finalize()) throw new AppError("FORBIDDEN");
      },
      claimNativeCall: async () => true,
    });
    const commandA = randomUUID();
    const commandB = randomUUID();
    const admission = {
      scope, sessionId: selection.sessionId, grantId: randomUUID(),
      capability: "computer.act" as const, bundleId, expiresAt: new Date(Date.now() + 120_000),
      controlEpoch: selection.controlEpoch,
    };
    // The claim is written, then the socket send is not provable. Only this
    // command's marker is rolled back.
    expect(await control.admit({
      scope, request: { kind: "act", native_call_id: "native-a", input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 1_000 } },
      commandId: commandA, sessionId: selection.sessionId, selectionId: selection.selectionId,
      holderId, admission,
    }, { mayDispatch: async () => true, finalize: () => false })).toBe(false);
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();

    // A successful admission keeps its marker. A following command that
    // cannot claim (and whose send is not provable) must not clear it.
    expect(await control.admit({
      scope, request: { kind: "act", native_call_id: "native-b", input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 1_000 } },
      commandId: commandB, sessionId: selection.sessionId, selectionId: selection.selectionId,
      holderId, admission,
    }, { mayDispatch: async () => true, finalize: () => true })).toBe(true);
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput)
      .toMatchObject({ commandId: commandB });
    expect(await control.admit({
      scope, request: { kind: "act", native_call_id: "native-c", input: { action: "click", observation_id: "obs-1", ref: "e1", timeout_ms: 1_000 } },
      commandId: randomUUID(), sessionId: selection.sessionId, selectionId: selection.selectionId,
      holderId, admission,
    }, { mayDispatch: async () => true, finalize: () => false })).toBe(false);
    expect(store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput)
      .toMatchObject({ commandId: commandB });
  });

  it("suppresses the positive active ack when the final locked check fails", async () => {
    const store = new FakeControlStore();
    const scope: DesktopRunScope = {
      ownerId: owner, deviceId: randomUUID(), connectionId: randomUUID(),
      conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
    };
    store.conversations.set(`${scope.conversationId}:${scope.deviceId}`, {
      deviceId: scope.deviceId, runtimeGeneration: scope.runtimeGeneration,
    });
    const control = new DesktopComputerControl({
      store,
      transport: {
        connection: async deviceId => ({ deviceId, connectionId: scope.connectionId, gatewayId: randomUUID() }),
        send: async () => { throw new Error("unused"); },
      },
      occupancy: {
        acquire: async () => ({ status: "device_busy" as const }),
        match: async () => ({ status: "not_held" as const, reason: "missing" as const }),
        release: async () => false,
        read: async () => null,
      },
      authorize: async () => { throw new Error("unused"); },
      verifyDispatch: async () => {},
      claimNativeCall: async () => true,
    });
    store.finalizeActiveValue = false;
    const replies: DesktopComputerControlResult[] = [];
    const result = await control.handle({
      ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: { action: "select", conversation_id: scope.conversationId, turn_id: scope.turnId, selection_id: selectionA, bundle_id: bundleId },
      },
    }, reply => { replies.push(reply); return true; });
    expect(result.ok).toBe(false);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ok).toBe(false);
    expect((await store.read(scope))?.state).toBe("active");
  });

  it("never sends a second reply when the final transaction fails after the ack", async () => {
    const store = new FakeControlStore();
    const scope: DesktopRunScope = {
      ownerId: owner, deviceId: randomUUID(), connectionId: randomUUID(),
      conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
    };
    store.conversations.set(`${scope.conversationId}:${scope.deviceId}`, {
      deviceId: scope.deviceId, runtimeGeneration: scope.runtimeGeneration,
    });
    const control = new DesktopComputerControl({
      store,
      transport: {
        connection: async deviceId => ({ deviceId, connectionId: scope.connectionId, gatewayId: randomUUID() }),
        send: async () => { throw new Error("unused"); },
      },
      occupancy: {
        acquire: async () => ({ status: "device_busy" as const }),
        match: async () => ({ status: "not_held" as const, reason: "missing" as const }),
        release: async () => false,
        read: async () => null,
      },
      authorize: async () => { throw new Error("unused"); },
      verifyDispatch: async () => {},
      claimNativeCall: async () => true,
    });
    store.finalizeActive = async input => {
      input.finalize();
      throw new Error("commit failed after the single send");
    };
    const replies: DesktopComputerControlResult[] = [];
    const result = await control.handle({
      ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
      verifyCredential: async () => true,
      frame: {
        type: "computer.control", id: randomUUID(),
        body: { action: "select", conversation_id: scope.conversationId, turn_id: scope.turnId, selection_id: selectionA, bundle_id: bundleId },
      },
    }, reply => { replies.push(reply); return true; });
    expect(result.ok).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ok).toBe(true);
  });

  // api-stop-race: begin
  it("lets one exact same-selection stop take over a select awaiting its active ack without a late positive ack", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      let releaseFinalize!: () => void;
      const finalizeGate = new Promise<void>(resolve => { releaseFinalize = resolve; });
      let finalizeStarted!: () => void;
      const started = new Promise<void>(resolve => { finalizeStarted = resolve; });
      const originalFinalize = state.store.finalizeActive.bind(state.store);
      state.store.finalizeActive = async input => {
        finalizeStarted();
        await finalizeGate;
        return originalFinalize(input);
      };

      // The renewal commits the selection, then waits before its active ack.
      const selectFrame = controlFrame("select", scope, selectionA);
      socket.send(JSON.stringify(selectFrame));
      await started;
      expect(state.store.selections.get(key)?.state).toBe("active");

      // Every unrelated transition keeps the existing immediate rejection.
      const foreignStop = controlFrame("stop", scope, selectionB);
      socket.send(JSON.stringify(foreignStop));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: foreignStop.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });

      // The exact same-selection stop reserves the one takeover slot and
      // waits; it must not run before the select transition has settled.
      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      expect((await frames.settle(50)).filter(frame => frame.type === "computer.control.result")).toEqual([]);
      expect(state.store.stopCalls).toHaveLength(0);

      releaseFinalize();
      // The late positive active ack is suppressed. A negative result for the
      // superseded select is allowed, and it arrives before the stop result.
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: selectFrame.id, ok: false,
      });
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true, data: { state: "stopped", selection_id: selectionA },
      });
      expect(state.store.stopCalls).toHaveLength(1);
      expect(state.store.selections.get(key)?.state).toBe("stopped");

      // The stopped selection grants no usable subsequent authorization.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // A replay of the finished stop id is the bounded rejection, never a
      // second execution.
      socket.send(JSON.stringify(stopFrame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      expect(state.store.stopCalls).toHaveLength(1);
    } finally {
      await state.cleanup();
    }
  });

  it("rejects a select that arrives while an earlier stop still owns the transition", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      expect(state.store.selectCalls).toHaveLength(1);

      let releaseStop!: () => void;
      const stopGate = new Promise<void>(resolve => { releaseStop = resolve; });
      let stopStarted!: () => void;
      const started = new Promise<void>(resolve => { stopStarted = resolve; });
      const originalStop = state.store.stop.bind(state.store);
      state.store.stop = async input => {
        stopStarted();
        await stopGate;
        return originalStop(input);
      };

      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      await started;

      // The stop got the slot first. A select arriving afterwards is never a
      // takeover and must not recreate authorization from that frame.
      socket.send(JSON.stringify(controlFrame("select", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      expect(state.store.selectCalls).toHaveLength(1);

      releaseStop();
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true, data: { state: "stopped" },
      });
      expect(state.store.stopCalls).toHaveLength(1);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
    } finally {
      await state.cleanup();
    }
  });
  // api-stop-race: end
});
