import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_COMPUTER_STATUS_HEADER,
  DESKTOP_EXECUTION_PROTOCOL_HEADER,
  DESKTOP_TOOL_OPERATIONS_HEADER,
  DESKTOP_TOOL_PROTOCOL_HEADER,
  desktopComputerControlResultSchema,
  desktopExecutionCommandSchema,
  desktopExecutionDeviceReadySchema,
  desktopComputerStatusProtocolVersion,
  desktopExecutionProtocolVersion,
  desktopExecutionResultSchema,
  desktopToolProtocolVersion,
  desktopToolRequestSchema,
  localComputerGrantSchema,
  timestampSchema,
  uuidSchema,
  type ComputerObservation,
  type DesktopComputerControlResult,
  type DesktopExecutionAck,
  type DesktopExecutionCallback,
  type DesktopExecutionCommand,
  type DesktopToolRequest,
} from "@linksense/shared";
import { DesktopDeviceTransport, DesktopCommandUncertainError } from "../src/adapters/desktop-device-transport.js";
import { AppError } from "../src/lib/errors.js";
import type { DesktopComputerReadPublication } from "../src/modules/desktop-devices/computer-admission.js";
import { sendAppError } from "../src/lib/http.js";
import {
  DesktopComputerControl,
  DesktopComputerSelectionError,
  desktopComputerPauseAuditId,
  desktopComputerSelectionKey,
  type DesktopComputerControlStore,
  type DesktopComputerPauseReceipt,
  type DesktopComputerResumeReceipt,
  type DesktopComputerSelection,
} from "../src/modules/desktop-devices/computer-control.js";
import { DesktopDeviceService } from "../src/modules/desktop-devices/service.js";
import { RedisDesktopDeviceCoordinator, type DesktopExecutionBinding } from "../src/modules/desktop-devices/coordinator.js";
import { registerDesktopDeviceRoutes } from "../src/modules/desktop-devices/routes.js";
import { executeDesktopTool } from "../src/modules/desktop-devices/tool-requests.js";
import { DesktopRunLeases, desktopRunScopeSchema, type DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
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

// Exact pre-change admission contract: no requestKind exists on the wire.
const preChangeDispatchAdmissionSchema = z.strictObject({
  scope: desktopRunScopeSchema,
  sessionId: uuidSchema,
  grantId: uuidSchema,
  capability: z.enum(["computer.observe", "computer.act"]),
  bundleId: localComputerGrantSchema.shape.target.shape.bundle_id,
  expiresAt: timestampSchema.transform(value => new Date(value)),
  controlEpoch: uuidSchema.optional(),
});

let redis: Awaited<ReturnType<typeof createRedisFixture>>;

beforeAll(async () => { redis = await createRedisFixture(); });
beforeEach(async () => { await redis.client.flushdb(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await redis.close(); });

type Frame = Record<string, unknown>;
type ComputerExecuteToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>;

/** Storage snapshots never share nested state with the double's live map. */
function snapshot(selection: DesktopComputerSelection): DesktopComputerSelection {
  return {
    ...selection,
    pendingInput: selection.pendingInput === null ? null : { ...selection.pendingInput },
  };
}

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
  finalCheckCalls = 0;
  presenceLiveValue = true;
  finalCheckGate: Promise<void> | undefined;
  finalCheckStartResolvers: Array<() => void> = [];
  sessionExpiryMs = 5 * 60_000;

  async resolve(input: { ownerId: string; deviceId: string; conversationId: string }) {
    const value = this.conversations.get(`${input.conversationId}:${input.deviceId}`);
    return value && input.ownerId === owner ? { runtimeGeneration: value.runtimeGeneration } : null;
  }

  async read(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    const selection = this.selections.get(desktopComputerSelectionKey(scope));
    return selection ? snapshot(selection) : null;
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

  async verifyActiveFinal(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<boolean> {
    this.finalCheckCalls += 1;
    const started = this.finalCheckStartResolvers;
    this.finalCheckStartResolvers = [];
    for (const resolve of started) resolve();
    if (this.finalCheckGate) await this.finalCheckGate;
    if (!this.bindingLiveValue || !this.presenceLiveValue) return false;
    const current = this.selections.get(desktopComputerSelectionKey(scope));
    return !!current && current.state === "active" && current.expiresAt > Date.now() &&
      current.selectionId === selection.selectionId &&
      current.sessionId === selection.sessionId &&
      current.connectionId === scope.connectionId &&
      current.controlEpoch === selection.controlEpoch &&
      current.bundleId === selection.bundleId &&
      current.expiresAt === selection.expiresAt;
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
    const now = Date.now();
    if (existing && existing.connectionId === input.scope.connectionId) {
      if (existing.state === "paused" || existing.state === "pausing") {
        throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
      }
      if (existing.selectionId === input.selectionId) {
        // Production-like same-id renewal: the exact session and grant identity
        // is kept, only a later bounded expiry and a new control epoch are
        // written. A live act-marker or a non-live selection never renews.
        if (existing.bundleId !== input.bundleId) {
          throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
        }
        if (existing.state !== "active" || existing.expiresAt <= now || existing.pendingInput) {
          throw new DesktopComputerSelectionError("COMPUTER_ACCESS_DENIED");
        }
        const renewed: DesktopComputerSelection = {
          ...existing, state: "active", controlEpoch: randomUUID(),
          expiresAt: Math.max(now + this.sessionExpiryMs, existing.expiresAt + 1),
          pendingInput: null,
        };
        this.selections.set(key, renewed);
        return { ...renewed };
      }
      if (existing.state === "active") {
        throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
      }
    }
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
    onResumed?: (receipt: DesktopComputerResumeReceipt) => void;
  }): Promise<DesktopComputerSelection> {
    this.resumeCalls.push(input);
    if (this.failResume) throw this.failResume;
    const selection = this.selections.get(desktopComputerSelectionKey(input.scope));
    if (!selection || selection.connectionId !== input.scope.connectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_UNAVAILABLE");
    }
    // Production-like lost-ack retry: the already-active successor is returned
    // without a write before the predecessor id is compared, so it must never
    // create a resume receipt.
    if (selection.state === "active" && selection.selectionId === input.newSelectionId) return selection;
    if (selection.selectionId !== input.selectionId ||
        selection.state !== "paused" || input.newSelectionId === input.selectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
    }
    selection.selectionId = input.newSelectionId;
    // Production-like true paused->active commit: the server rotates the
    // control epoch so an earlier Pause of this same native selection id is a
    // different generation. The already-active retry above writes nothing.
    selection.controlEpoch = randomUUID();
    selection.state = "active";
    input.onResumed?.({ predecessor: input.selectionId, successor: snapshot(selection) });
    return selection;
  }

  async stop(input: {
    scope: DesktopRunScope; selectionId: string; receipt?: DesktopComputerResumeReceipt;
  }): Promise<DesktopComputerSelection> {
    this.stopCalls.push(input);
    const selection = this.selections.get(desktopComputerSelectionKey(input.scope));
    if (!selection || selection.connectionId !== input.scope.connectionId) {
      throw new DesktopComputerSelectionError("COMPUTER_UNAVAILABLE");
    }
    if (selection.selectionId !== input.selectionId) {
      // Production-like alias: only the exact still-active successor of the
      // receipt's predecessor may be stopped through the predecessor id.
      const receipt = input.receipt;
      if (!receipt || receipt.predecessor !== input.selectionId ||
          receipt.successor.ownerId !== input.scope.ownerId ||
          receipt.successor.deviceId !== input.scope.deviceId ||
          receipt.successor.connectionId !== input.scope.connectionId ||
          receipt.successor.conversationId !== input.scope.conversationId ||
          receipt.successor.turnId !== input.scope.turnId ||
          receipt.successor.runtimeGeneration !== input.scope.runtimeGeneration ||
          selection.state !== "active" ||
          selection.selectionId !== receipt.successor.selectionId ||
          selection.sessionId !== receipt.successor.sessionId ||
          selection.controlEpoch !== receipt.successor.controlEpoch ||
          selection.bundleId !== receipt.successor.bundleId ||
          selection.expiresAt !== receipt.successor.expiresAt) {
        throw new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
      }
    }
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
/** A pong proves the socket processed the prior frame without an early reply. */
const isPongOrControlResult = (frame: Frame): frame is Frame =>
  frame.type === "pong" || isControlResult(frame);

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
  let auditGate: Promise<void> | undefined;
  let auditStartResolvers: Array<() => void> = [];
  const audit = vi.fn(async (entry: {
    action: string;
    result: string;
    metadata?: Record<string, unknown>;
  }) => {
    void entry;
    const started = auditStartResolvers;
    auditStartResolvers = [];
    for (const resolve of started) resolve();
    if (auditGate) await auditGate;
  });
  // Pause audit supervision is route-owned; this double records the exact
  // server-proven receipt, can hold or reject the write, and proves that only
  // one issued write runs at a time.
  const pauseAudits: DesktopComputerPauseReceipt[] = [];
  let pauseAuditGate: Promise<void> | undefined;
  let pauseAuditsInFlight = 0;
  let pauseAuditsMaxInFlight = 0;
  const recordPauseAudit = vi.fn(async (receipt: DesktopComputerPauseReceipt) => {
    pauseAudits.push(receipt);
    pauseAuditsInFlight += 1;
    pauseAuditsMaxInFlight = Math.max(pauseAuditsMaxInFlight, pauseAuditsInFlight);
    try {
      if (pauseAuditGate) await pauseAuditGate;
    } finally {
      pauseAuditsInFlight -= 1;
    }
  });
  const closePauseAudit = vi.fn(async () => {});
  let authorizeFailure: Error | undefined;
  let actAuthorizeFailure: Error | undefined;
  let verifyGate: Promise<void> | undefined;
  let verifyFailure: Error | undefined;
  let verifyStartResolvers: Array<() => void> = [];
  let authorizeGate: Promise<void> | undefined;
  let authorizeStartResolvers: Array<() => void> = [];
  const authorize = vi.fn(async (input: {
    scope: DesktopRunScope;
    capability: "computer.observe" | "computer.act";
    bundleId: string;
  }): Promise<LocalComputerActionAuthorization> => {
    if (authorizeFailure || (input.capability === "computer.act" && actAuthorizeFailure)) {
      throw authorizeFailure ?? actAuthorizeFailure;
    }
    const selection = await store.read(input.scope);
    if (!selection) throw new AppError("FORBIDDEN");
    const authorization: LocalComputerActionAuthorization = {
      scope: input.scope, sessionId: selection.sessionId, grantId: randomUUID(),
      capability: input.capability, bundleId: input.bundleId, expiresAt: new Date(Date.now() + 120_000),
    };
    const started = authorizeStartResolvers;
    authorizeStartResolvers = [];
    for (const resolve of started) resolve();
    if (authorizeGate) await authorizeGate;
    return authorization;
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
      binding: DesktopExecutionBinding & {
        ownerId: string; toolOperations: readonly string[]; computerStatus: boolean;
      },
      frame: DesktopExecutionCallback,
      signal: AbortSignal,
      readDelivery?: (
        publication: DesktopComputerReadPublication,
        ack: DesktopExecutionAck,
      ) => Promise<boolean>,
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
        computerWait: binding.toolOperations.includes("computer.execute") &&
          binding.toolOperations.includes("computer.wait"),
        computerStatus: binding.computerStatus,
        computerExecute: (input, publishRead) => {
          if (!routeRef.control) throw new AppError("RUNNER_UNAVAILABLE");
          return routeRef.control.execute(input, publishRead);
        },
      }, scope, frame, signal, readDelivery);
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
    execution: transport, computerExecute: true, computerControl: control, recordPauseAudit, closePauseAudit,
  });
  await app.ready();
  const cleanup = async () => { await app.close(); };
  return {
    app, leases, store, control, transport, occupancy, audit, authorize, verifyDispatch, cleanup,
    pauseAudits, recordPauseAudit, closePauseAudit,
    pauseAuditMaxInFlight: () => pauseAuditsMaxInFlight,
    nextVerifyStarted: () => new Promise<void>(resolve => { verifyStartResolvers.push(resolve); }),
    nextAuthorizeStarted: () => new Promise<void>(resolve => { authorizeStartResolvers.push(resolve); }),
    setAuthorizeGate: (gate: Promise<void> | undefined) => { authorizeGate = gate; },
    nextAuditStarted: () => new Promise<void>(resolve => { auditStartResolvers.push(resolve); }),
    nextFinalCheckStarted: () => new Promise<void>(resolve => { store.finalCheckStartResolvers.push(resolve); }),
    setFinalCheckGate: (gate: Promise<void> | undefined) => { store.finalCheckGate = gate; },
    setAuthorizeFailure: (error: Error | undefined) => { authorizeFailure = error; },
    setActAuthorizeFailure: (error: Error | undefined) => { actAuthorizeFailure = error; },
    setAuditGate: (gate: Promise<void> | undefined) => { auditGate = gate; },
    setVerifyGate: (gate: Promise<void> | undefined) => { verifyGate = gate; },
    setVerifyFailure: (error: Error | undefined) => { verifyFailure = error; },
    setPauseAuditGate: (gate: Promise<void> | undefined) => { pauseAuditGate = gate; },
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

async function connect(
  app: ReturnType<typeof Fastify>, token: string, offer: string | undefined,
  options: { computerStatus?: boolean } = {},
) {
  const address = app.server.listening
    ? `http://127.0.0.1:${(app.server.address() as import("node:net").AddressInfo).port}`
    : await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${address.replace(/^http/u, "ws")}/api/v1/desktop/devices/socket`, {
    headers: {
      [DESKTOP_EXECUTION_PROTOCOL_HEADER]: String(desktopExecutionProtocolVersion),
      ...(options.computerStatus ? {
        [DESKTOP_COMPUTER_STATUS_HEADER]: String(desktopComputerStatusProtocolVersion),
      } : {}),
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
  kind: "status" | "observe" | "act" | "wait", scope: DesktopRunScope, runToken: string,
  extra: Record<string, unknown> = {}, nativeCallId = "native-call-1",
): ComputerExecuteToolRequest {
  const request = desktopToolRequestSchema.parse({
    type: "tool.request", id: randomUUID(), conversation_id: scope.conversationId,
    runtime_generation: scope.runtimeGeneration, turn_id: scope.turnId,
    expires_at: new Date(Date.now() + 25_000).toISOString(), run_token: runToken,
    operation: "computer.execute",
    body: kind === "act"
      ? { kind: "act", native_call_id: nativeCallId, input: { action: "click", observation_id: "obs-1", ref: "e1" } }
      : kind === "wait"
        ? { kind: "wait", input: { observation_id: "obs-1", ref: "@obs-1:e1" } }
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
  options: { computerStatus?: boolean } = {},
) {
  const { device, token } = await paired(state.app);
  const { socket, ready } = await connect(state.app, token, offer, options);
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
  return { token, socket, ready, frames, binding, scope, runToken, device };
}

async function sendCancelAndAwaitApplied(
  state: Awaited<ReturnType<typeof fixture>>, socket: WebSocket,
  cancel: {
    id: string; operation: "computer.execute"; conversation_id: string;
    turn_id: string; runtime_generation: string;
  },
) {
  const original = state.transport.cancelTool.bind(state.transport);
  let acknowledge!: () => void;
  const applied = new Promise<void>(resolve => { acknowledge = resolve; });
  const cancelTool = vi.spyOn(state.transport, "cancelTool").mockImplementation((connectionId, received) => {
    original(connectionId, received);
    if (received.id === cancel.id) acknowledge();
  });
  try {
    socket.send(JSON.stringify({ type: "tool.cancel", ...cancel }));
    await applied;
  } finally {
    cancelTool.mockRestore();
  }
}

async function select(state: Awaited<ReturnType<typeof fixture>>, socket: WebSocket, frames: ReturnType<typeof frameQueue>, scope: DesktopRunScope, selectionId = selectionA) {
  const frame = controlFrame("select", scope, selectionId);
  socket.send(JSON.stringify(frame));
  const result = controlResultOf(await frames.until(isControlResult));
  expect(result).toMatchObject({ type: "computer.control.result", id: frame.id, ok: true });
  return result;
}

/** Adopts the exact observe holder that a Pause/Stop must quiesce and release. */
async function holdObserve(
  socket: WebSocket, frames: ReturnType<typeof frameQueue>,
  scope: DesktopRunScope, runToken: string,
) {
  socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
  const observe = commandOf(await frames.until(isCommand));
  socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
  await frames.until(isToolResult);
  return observe;
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

  it("omits requestKind from every encrypted dispatch admission so a pre-change receiver stays compatible", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      const send = vi.spyOn(state.transport, "send");
      const expectLegacyAdmission = (kind: "status" | "observe" | "act") => {
        const admission = send.mock.calls.at(-1)?.[3];
        const wire = JSON.parse(JSON.stringify(admission)) as unknown;
        const parsed = preChangeDispatchAdmissionSchema.safeParse(wire);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(admission).not.toHaveProperty("requestKind");
        expect(admission).toMatchObject({
          capability: kind === "act" ? "computer.act" : "computer.observe",
        });
        expect(state.verifyDispatch.mock.lastCall?.[0]).toMatchObject({ requestKind: kind });
      };

      socket.send(JSON.stringify(toolRequest("status", scope, runToken)));
      const status = commandOf(await frames.until(isCommand));
      expectLegacyAdmission("status");
      socket.send(JSON.stringify(commandResult(status, {
        kind: "status", result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
      })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      expectLegacyAdmission("observe");
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      expectLegacyAdmission("act");
      socket.send(JSON.stringify(commandResult(act, {
        kind: "act", result: { ok: true, effect: "done", waited_ms: 1 },
      })));
      await frames.until(isToolResult);
    } finally {
      await state.cleanup();
    }
  });

  it("publishes a positive status only under the negotiated exact act authority and one send", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, ready } = await prepareSocket(
        state, "computer.execute", { computerStatus: true },
      );
      expect(ready.computer_status_version).toBe(desktopComputerStatusProtocolVersion);
      await select(state, socket, frames, scope);
      const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
      if (!selection) throw new Error("selection missing");
      const send = vi.spyOn(state.transport, "send");

      socket.send(JSON.stringify(toolRequest("status", scope, runToken)));
      const command = commandOf(await frames.until(isCommand));
      expect(command.body).toMatchObject({
        session_id: selection.sessionId, selection_id: selectionA, holder_id: null,
        request: {
          kind: "status",
          selection_expires_at: new Date(selection.expiresAt).toISOString(),
        },
      });
      socket.send(JSON.stringify(commandResult(command, {
        kind: "status",
        result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true,
        data: { kind: "status", result: { available: true, active_grant: true } },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result"))
        .toEqual([]);

      const actCall = state.authorize.mock.calls.findIndex(([input]) => input.capability === "computer.act");
      expect(actCall).toBeGreaterThanOrEqual(0);
      const actAuthorization = await state.authorize.mock.results[actCall]!.value;
      expect(state.verifyDispatch.mock.lastCall?.[0]).toMatchObject({
        scope, sessionId: selection.sessionId, grantId: actAuthorization.grantId,
        capability: "computer.act", bundleId, expiresAt: actAuthorization.expiresAt,
      });
      expect(state.store.finalCheckCalls).toBe(1);
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(await redis.client.keys("linksense:desktop-native-call:*")).toHaveLength(0);
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        action: "desktop_tool_requested", result: "success",
        metadata: expect.objectContaining({ computer_request: "status" }),
      }));
      // The positive publication reuses the transport's single send, not a
      // second device command.
      expect(send.mock.calls.filter(([, value]) => value.operation === "computer.execute")).toHaveLength(1);
    } finally {
      await state.cleanup();
    }
  });

  it("keeps legacy, unnegotiated, paused, and act-only status diagnostics false", async () => {
    for (const variant of ["legacy", "paused", "act-denied"] as const) {
      const state = await fixture();
      try {
        const negotiated = variant !== "legacy";
        const { socket, frames, scope, runToken, ready } = await prepareSocket(
          state, "computer.execute", negotiated ? { computerStatus: true } : {},
        );
        expect(ready.computer_status_version).toBe(
          negotiated ? desktopComputerStatusProtocolVersion : undefined,
        );
        await select(state, socket, frames, scope);
        if (variant === "paused") {
          const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
          if (!selection) throw new Error("selection missing");
          selection.state = "paused";
        }
        if (variant === "act-denied") state.setActAuthorizeFailure(new AppError("FORBIDDEN"));

        socket.send(JSON.stringify(toolRequest("status", scope, runToken)));
        const command = commandOf(await frames.until(isCommand));
        expect(command.body.holder_id).toBeNull();
        if (variant !== "legacy") expect(command.body.request).toEqual({ kind: "status" });
        socket.send(JSON.stringify(commandResult(command, {
          kind: "status",
          result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
        })));
        expect(await frames.until(isToolResult)).toMatchObject({
          ok: true,
          data: { kind: "status", result: { available: true, active_grant: false } },
        });
        expect(state.authorize.mock.calls.some(([input]) => input.capability === "computer.act"))
          .toBe(variant === "legacy" ? false : variant !== "paused");
        expect(state.verifyDispatch.mock.calls.some(([input]) => input.capability === "computer.act"))
          .toBe(false);
        expect((await frames.settle()).filter(frame => frame.type === "tool.result")).toEqual([]);
      } finally {
        await state.cleanup();
      }
    }
  });

  it("rejects a model-supplied status selection expiry before any native command", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(
        state, "computer.execute", { computerStatus: true },
      );
      await select(state, socket, frames, scope);
      const closed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
      const request = toolRequest("status", scope, runToken);
      socket.send(JSON.stringify({
        ...request,
        body: { kind: "status", selection_expires_at: new Date(Date.now() + 60_000).toISOString() },
      }));
      expect((await closed)[0]).toBe(4400);
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(state.authorize.mock.calls.some(([input]) => input.capability === "computer.act")).toBe(false);
    } finally {
      await state.cleanup();
    }
  });

  it("withholds positive status when the original act authority is revoked, renewed, or expires before publication", async () => {
    for (const loss of ["revoke", "renewal", "expiry"] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } = await prepareSocket(
          state, "computer.execute", { computerStatus: true },
        );
        await select(state, socket, frames, scope);
        let releaseAudit!: () => void;
        state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
        const auditStarted = state.nextAuditStarted();
        socket.send(JSON.stringify(toolRequest("status", scope, runToken)));
        const command = commandOf(await frames.until(isCommand));
        socket.send(JSON.stringify(commandResult(command, {
          kind: "status",
          result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
        })));
        await auditStarted;
        const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
        if (!selection) throw new Error("selection missing");
        if (loss === "revoke") state.setVerifyFailure(new AppError("FORBIDDEN"));
        if (loss === "renewal") selection.controlEpoch = randomUUID();
        if (loss === "expiry") selection.expiresAt = Date.now() - 1;
        releaseAudit();
        const result = await frames.until(isToolResult);
        expect(result).toMatchObject({
          ok: true, data: { kind: "status", result: { active_grant: false } },
        });
        expect(JSON.stringify(result)).not.toContain('"active_grant":true');
        expect((await frames.settle()).filter(frame => frame.type === "tool.result")).toEqual([]);
        expect(state.store.claimInputCalls).toHaveLength(0);
      } finally {
        await state.cleanup();
      }
    }
  });

  it("suppresses a positive status after a late tool cancel without replaying the command", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(
        state, "computer.execute", { computerStatus: true },
      );
      await select(state, socket, frames, scope);
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      const request = toolRequest("status", scope, runToken);
      socket.send(JSON.stringify(request));
      const command = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(command, {
        kind: "status",
        result: { available: true, permissions: { accessibility: "granted" }, active_grant: true },
      })));
      await auditStarted;
      await sendCancelAndAwaitApplied(state, socket, {
        id: request.id, operation: "computer.execute",
        conversation_id: request.conversation_id, turn_id: request.turn_id,
        runtime_generation: request.runtime_generation,
      });
      releaseAudit();
      const leftover = await frames.settle(250);
      expect(leftover.filter(frame => frame.type === "tool.result")).toEqual([]);
      expect(JSON.stringify(leftover)).not.toContain('"active_grant":true');
      expect(leftover.filter(frame => frame.type === "command")).toEqual([]);
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
      socket.send(JSON.stringify(controlFrame("pause", foreign, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACCESS_DENIED",
      });
      await delay(20);
      expect(state.pauseAudits).toEqual([]);

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
      await holdObserve(socket, frames, scope, runToken);
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, {
        kind: "failure", error: "COMPUTER_ACTION_FAILED",
      })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_ACTION_FAILED",
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("pausing");
      await delay(20);
      expect(state.pauseAudits).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("records one server-proven Pause audit only after the exact reply is accepted", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      await holdObserve(socket, frames, scope, runToken);

      const pauseFrame = controlFrame("pause", scope, selectionA);
      socket.send(JSON.stringify(pauseFrame));
      const quiesce = commandOf(await frames.until(isCommand));
      // The transition is still awaiting its exact native proof: no audit.
      expect(state.pauseAudits).toEqual([]);
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: pauseFrame.id, ok: true, data: { state: "paused", session_id: selected.data.session_id },
      });
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(1));
      const paused = state.store.selections.get(desktopComputerSelectionKey(scope));
      expect(state.pauseAudits[0]).toMatchObject({
        ownerId: owner, sessionId: selected.data.session_id,
        selectionId: selectionA, controlEpoch: paused?.controlEpoch,
      });
      expect(state.pauseAudits[0]!.acknowledgedAt).toBeInstanceOf(Date);
      // Only the server-proven account/session/generation and the accepted
      // reply time may cross this seam: no bundle, window, frame, credential,
      // or free-form input.
      expect(Object.keys(state.pauseAudits[0]!).sort())
        .toEqual(["acknowledgedAt", "controlEpoch", "ownerId", "selectionId", "sessionId"]);
    } finally {
      await state.cleanup();
    }
  });

  it("does not record a Pause whose exact holder release is refused", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      await holdObserve(socket, frames, scope, runToken);
      const release = vi.spyOn(state.occupancy, "release").mockResolvedValue(false);
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_UNAVAILABLE",
      });
      await delay(20);
      expect(state.pauseAudits).toEqual([]);
      release.mockRestore();
    } finally {
      await state.cleanup();
    }
  });

  it("drops a duplicate control id and keys a fresh idempotent Pause to one generation", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const first = controlFrame("pause", scope, selectionA);
      socket.send(JSON.stringify(first));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: first.id, ok: true, data: { state: "paused" },
      });
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(1));

      // The exact request id is dropped by the existing replay guard.
      socket.send(JSON.stringify(first));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: first.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      await delay(20);
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);

      // A fresh request id repeats the idempotent Pause. Its audit identity is
      // the same trusted generation, so persistence keeps one row.
      const duplicate = controlFrame("pause", scope, selectionA);
      socket.send(JSON.stringify(duplicate));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: duplicate.id, ok: true, data: { state: "paused" },
      });
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(2));
      expect(state.pauseAudits[1]!.acknowledgedAt).toBeInstanceOf(Date);
      expect(desktopComputerPauseAuditId(state.pauseAudits[1]!))
        .toBe(desktopComputerPauseAuditId(state.pauseAudits[0]!));
    } finally {
      await state.cleanup();
    }
  });

  it("issues one Pause audit at a time, dedupes a pending generation, and bounds the backlog", async () => {
    const state = await fixture();
    let release!: () => void;
    try {
      state.setPauseAuditGate(new Promise<void>(resolve => { release = resolve; }));
      const warn = vi.spyOn(state.app.log, "warn");
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);

      // The first acknowledged Pause occupies the single issued slot.
      let current = selectionA;
      socket.send(JSON.stringify(controlFrame("pause", scope, current)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });

      // Each accepted control reply is the barrier proving its own schedule
      // already ran. Fill the bounded admission with distinct generations;
      // none of the queued writes may be invoked while the first is unsettled.
      for (let index = 0; index < 31; index += 1) {
        const next = randomUUID();
        socket.send(JSON.stringify(controlFrame("resume", scope, current, { new_selection_id: next })));
        expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
          ok: true, data: { state: "active" },
        });
        current = next;
        socket.send(JSON.stringify(controlFrame("pause", scope, current)));
        expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
          ok: true, data: { state: "paused" },
        });
      }
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      expect(state.pauseAuditMaxInFlight()).toBe(1);
      expect(warn).not.toHaveBeenCalled();

      // A repeat of the live generation is the same audit id: it is
      // acknowledged and dropped from admission without a second write.
      socket.send(JSON.stringify(controlFrame("pause", scope, current)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();

      // The admission is full: a further distinct generation still gets its
      // normal Pause reply but is dropped with the one fixed warning.
      const overflowNext = randomUUID();
      socket.send(JSON.stringify(controlFrame("resume", scope, current, { new_selection_id: overflowNext })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "active" },
      });
      const overflow = controlFrame("pause", scope, overflowNext);
      socket.send(JSON.stringify(overflow));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: overflow.id, ok: true, data: { state: "paused" },
      });
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith("desktop computer pause audit was not recorded");

      // Releasing the real settlement gate runs every admitted write, one at a
      // time, and never the dropped one.
      release();
      release = () => {};
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(32), { timeout: 5_000 });
      expect(state.pauseAuditMaxInFlight()).toBe(1);
      expect(state.pauseAudits).toHaveLength(32);
    } finally {
      release();
      await state.cleanup();
    }
  });

  it("closes the Pause audit client only after admitted writes settle", async () => {
    const state = await fixture();
    let release: () => void = () => {};
    let closed = false;
    try {
      state.setPauseAuditGate(new Promise<void>(resolve => { release = resolve; }));
      state.closePauseAudit.mockImplementationOnce(async () => { closed = true; });
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(1));

      // Resume installs a distinct generation whose acknowledged Pause is
      // admitted behind the still-blocked first write.
      socket.send(JSON.stringify(controlFrame("resume", scope, selectionA, { new_selection_id: selectionB })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "active" },
      });
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionB)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused" },
      });
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      const warn = vi.spyOn(state.app.log, "warn");

      // Fastify runs preClose before closing the server and preClose terminates
      // every socket first, so the close event is the exact shutdown barrier.
      const socketClosed = once(socket, "close", { signal: AbortSignal.timeout(2_000) });
      const closing = state.app.close();
      await socketClosed;
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      expect(state.closePauseAudit).not.toHaveBeenCalled();

      release();
      release = () => {};
      await closing;
      expect(closed).toBe(true);
      expect(state.closePauseAudit).toHaveBeenCalledTimes(1);
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);
      expect(state.pauseAuditMaxInFlight()).toBe(1);
      expect(warn.mock.calls.filter(([message]) =>
        message === "desktop computer pause audit was not recorded")).toHaveLength(1);
    } finally {
      release();
      await state.cleanup();
    }
  });

  it("does not claim a Pause audit without an accepted receiver", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      await select(state, socket, frames, scope);

      // No delivery continuation: the existing successful reply is unchanged,
      // but nothing here proves a receiver accepted it, so no claim is made.
      const absentReceipts: DesktopComputerPauseReceipt[] = [];
      const absent = await state.control.handle({
        ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
        verifyCredential: async () => true,
        frame: {
          type: "computer.control", id: randomUUID(),
          body: {
            action: "pause", conversation_id: scope.conversationId,
            turn_id: scope.turnId, selection_id: selectionA,
          },
        },
        onPauseAcknowledged: receipt => absentReceipts.push(receipt),
      });
      expect(absent).toMatchObject({ ok: true, data: { state: "paused" } });
      expect(absentReceipts).toEqual([]);

      // The same refusal after an explicit receiver answer: the reply is not
      // accepted and the Pause is not claimed either.
      socket.send(JSON.stringify(controlFrame("resume", scope, selectionA, { new_selection_id: selectionB })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "active" },
      });
      const refusedReceipts: DesktopComputerPauseReceipt[] = [];
      const refused = await state.control.handle({
        ownerId: owner, deviceId: scope.deviceId, connectionId: scope.connectionId,
        verifyCredential: async () => true,
        frame: {
          type: "computer.control", id: randomUUID(),
          body: {
            action: "pause", conversation_id: scope.conversationId,
            turn_id: scope.turnId, selection_id: selectionB,
          },
        },
        onPauseAcknowledged: receipt => refusedReceipts.push(receipt),
      }, () => false);
      expect(refused).toMatchObject({ ok: false, error_code: "COMPUTER_UNAVAILABLE" });
      expect(refusedReceipts).toEqual([]);
      expect(state.recordPauseAudit).not.toHaveBeenCalled();
    } finally {
      await state.cleanup();
    }
  });

  it("settles an exact Stop while the Pause audit is unresolved and warns once when it fails", async () => {
    const state = await fixture();
    let failGate!: () => void;
    const gate = new Promise<void>((_, reject) => { failGate = () => reject(new Error("audit store unavailable")); });
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      await holdObserve(socket, frames, scope, runToken);
      state.setPauseAuditGate(gate);
      const pauseFrame = controlFrame("pause", scope, selectionA);
      socket.send(JSON.stringify(pauseFrame));
      const quiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: pauseFrame.id, ok: true, data: { state: "paused" },
      });
      await vi.waitFor(() => expect(state.recordPauseAudit).toHaveBeenCalledTimes(1));

      const warn = vi.spyOn(state.app.log, "warn");
      // The audit write is still unresolved; emergency Stop must settle now.
      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true, data: { state: "stopped" },
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("stopped");
      expect(state.recordPauseAudit).toHaveBeenCalledTimes(1);

      failGate();
      await vi.waitFor(() => expect(warn)
        .toHaveBeenCalledWith("desktop computer pause audit was not recorded"));
      // A failed audit never rewrites the transition or emits another reply.
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.state).toBe("stopped");
      expect((await frames.settle(20)).filter(isControlResult)).toEqual([]);
    } finally {
      failGate();
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

  it("does not publish a late observe holder after Pause releases A and Resume installs B", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const occupancyKey = localComputerGuiOccupancyKey(device.id);

      // Hold the observe after its authorization was computed for A but before
      // it may acquire. Pause/Resume then settle while it waits.
      let releaseAuthorize!: () => void;
      state.setAuthorizeGate(new Promise<void>(resolve => { releaseAuthorize = resolve; }));
      const authorizeStarted = state.nextAuthorizeStarted();
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      await authorizeStarted;

      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult)))
        .toMatchObject({ ok: true, data: { state: "paused" } });
      socket.send(JSON.stringify(controlFrame("resume", scope, selectionA, { new_selection_id: selectionB })));
      expect(controlResultOf(await frames.until(isControlResult)))
        .toMatchObject({ ok: true, data: { state: "active", selection_id: selectionB } });
      expect(await redis.client.exists(occupancyKey)).toBe(0);

      state.setAuthorizeGate(undefined);
      releaseAuthorize();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });

      // No predecessor holder was published and no command was sent.
      expect(await redis.client.exists(occupancyKey)).toBe(0);
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // The successor remains cleanly stoppable: no orphan A holder can make
      // the exact Stop of B fail as a mismatched target.
      socket.send(JSON.stringify(controlFrame("stop", scope, selectionB)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "stopped", selection_id: selectionB },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
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

  it("relays one read-only wait on the adopted holder without a native claim or pending input", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } =
        await prepareSocket(state, "computer.execute,computer.wait");
      await select(state, socket, frames, scope);
      const send = vi.spyOn(state.transport, "send");
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
      const wait = commandOf(await frames.until(isCommand));
      expect(send.mock.lastCall?.[3]).not.toHaveProperty("requestKind");
      expect(wait.body).toMatchObject({
        session_id: observe.body.session_id,
        selection_id: selectionA,
        holder_id: observe.body.holder_id,
        request: {
          kind: "wait",
          input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 8_000 },
        },
      });
      expect(wait.body.request).not.toHaveProperty("native_call_id");
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      expect(await redis.client.keys("linksense:desktop-native-call:*")).toHaveLength(0);

      socket.send(JSON.stringify(commandResult(wait, {
        kind: "wait", result: { result: "timed_out", waited_ms: 8_000 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "wait", result: { result: "timed_out", waited_ms: 8_000 } },
      });
      // Observe acquisition/admission/publication plus the wait's admission
      // transaction and exact post-result recheck.
      expect(state.verifyDispatch).toHaveBeenCalledTimes(5);
      expect(state.verifyDispatch.mock.calls[3]?.[0]).toMatchObject({
        capability: "computer.observe", requestKind: "wait",
      });
      expect(state.verifyDispatch.mock.calls[4]?.[0]).toMatchObject({
        scope, sessionId: observe.body.session_id, capability: "computer.observe", requestKind: "wait",
      });
      const selection = state.store.selections.get(desktopComputerSelectionKey(scope));
      expect(selection?.pendingInput).toBeNull();
      expect(JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(device.id)) ?? "null"))
        .toMatchObject({ holderId: observe.body.holder_id });
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        action: "desktop_tool_requested", result: "success",
        metadata: expect.objectContaining({ operation: "computer.execute" }),
      }));
      const lastAudit = JSON.stringify(state.audit.mock.lastCall);
      expect(lastAudit).not.toContain("computer_action");
      expect(lastAudit).not.toContain("obs-1");
      expect(lastAudit).not.toContain("@obs-1:e1");
      expect(lastAudit).not.toContain("timeout_ms");
    } finally {
      await state.cleanup();
    }
  });

  it("refuses a wait that the connection did not negotiate before the lane or a command", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("fails a wait closed when the selection renewal, pause, or stop lands before its result", async () => {
    for (const action of ["renew", "pause", "stop"] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } =
          await prepareSocket(state, "computer.execute,computer.wait");
        await select(state, socket, frames, scope);
        socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
        const observe = commandOf(await frames.until(isCommand));
        socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
        await frames.until(isToolResult);

        socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
        const wait = commandOf(await frames.until(isCommand));
        socket.send(JSON.stringify(action === "renew"
          ? controlFrame("select", scope, selectionA)
          : controlFrame(action, scope, selectionA)));
        if (action !== "renew") {
          // Pause/stop wait for the exact native quiesce ack before releasing.
          const quiesce = commandOf(await frames.until(isCommand));
          expect(quiesce.body.request).toEqual({ kind: "quiesce" });
          socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
        }
        await frames.until(isControlResult);

        // A result that belonged to the pre-renewal/pre-stop binding is never
        // published as a success.
        socket.send(JSON.stringify(commandResult(wait, {
          kind: "wait", result: { result: "met", waited_ms: 20 },
        })));
        expect(await frames.until(isToolResult)).toMatchObject({
          ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
        });
        expect(state.store.claimInputCalls).toHaveLength(0);
      } finally {
        await state.cleanup();
      }
    }
  });

  it("denies an altered wait result and keeps a transport ambiguity a clean timeout", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state, "computer.execute,computer.wait");
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      const altered = vi.spyOn(state.transport, "send").mockResolvedValueOnce({
        type: "command.result", id: randomUUID(), operation: "computer.execute", ok: true,
        result: { kind: "wait", result: { result: "met", waited_ms: 20_001 } },
      } as unknown as Awaited<ReturnType<typeof state.transport.send>>);
      socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect(altered).toHaveBeenCalledOnce();
      altered.mockRestore();

      const uncertain = vi.spyOn(state.transport, "send").mockRejectedValueOnce(
        new DesktopCommandUncertainError(),
      );
      socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TIMEOUT" },
      });
      expect(uncertain).toHaveBeenCalledOnce();
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("withholds a wait success when the original grant is no longer live", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state, "computer.execute,computer.wait");
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      socket.send(JSON.stringify(toolRequest("wait", scope, runToken)));
      const wait = commandOf(await frames.until(isCommand));
      // The command was admitted under the live grant; the grant is then
      // revoked before the bounded read returns.
      state.setVerifyFailure(new AppError("FORBIDDEN"));
      socket.send(JSON.stringify(commandResult(wait, {
        kind: "wait", result: { result: "met", waited_ms: 3 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
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

  it("lets a second session take over after Pause releases the holder and ignores the old receipt", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const firstObserve = await holdObserve(socket, frames, scope, runToken);

      // A second independent run scope on the same Mac selects while A holds,
      // but cannot observe: occupancy is per device.
      const second: DesktopRunScope = {
        ...scope, conversationId: randomUUID(), turnId: randomUUID(),
      };
      state.store.conversations.set(`${second.conversationId}:${device.id}`, {
        deviceId: device.id, runtimeGeneration: second.runtimeGeneration,
      });
      const secondToken = await issueRun(
        state.leases, device.id, second.connectionId,
        second.conversationId, second.turnId, second.runtimeGeneration,
      );
      await select(state, socket, frames, second, selectionB);
      socket.send(JSON.stringify(toolRequest("observe", second, secondToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "DEVICE_BUSY" },
      });

      // Pause releases the exact holder only after the native quiesce ack.
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body).toMatchObject({
        holder_id: firstObserve.body.holder_id, selection_id: selectionA, request: { kind: "quiesce" },
      });
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused", selection_id: selectionA },
      });

      // The second session takes over with its own selection and holder.
      socket.send(JSON.stringify(toolRequest("observe", second, secondToken)));
      const secondObserve = commandOf(await frames.until(isCommand));
      expect(secondObserve.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(secondObserve, { kind: "observe", result: observation })));
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "observe" } });

      // A duplicate of A's old quiesce receipt must not release or clear B's
      // holder: a fresh observe still runs on the second selection.
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      await frames.settle();
      socket.send(JSON.stringify(toolRequest("observe", second, secondToken)));
      const thirdObserve = commandOf(await frames.until(isCommand));
      expect(thirdObserve.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(thirdObserve, { kind: "observe", result: observation })));
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

  it("does not acknowledge pause until the exact marker is idle and the exact holder is released", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken, device } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      const occupancyKey = localComputerGuiOccupancyKey(device.id);
      await select(state, socket, frames, scope);
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);
      socket.send(JSON.stringify(toolRequest("act", scope, runToken)));
      const act = commandOf(await frames.until(isCommand));
      await waitFor(() => state.store.selections.get(key)?.pendingInput != null);
      expect(state.store.selections.get(key)?.pendingInput).toMatchObject({
        holderId: observe.body.holder_id, commandId: act.id,
      });

      // A clear write error is not proof that the admitted act is over, and the
      // exact marker and holder stay for the next exact proof.
      const clearInput = vi.spyOn(state.store, "clearInput")
        .mockRejectedValueOnce(new Error("redis write failed"));
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const firstQuiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(firstQuiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_UNAVAILABLE",
      });
      expect(clearInput).toHaveBeenCalledTimes(1);
      expect(state.store.selections.get(key)).toMatchObject({ state: "pausing" });
      expect(state.store.selections.get(key)?.pendingInput).toMatchObject({ commandId: act.id });
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({
        holderId: observe.body.holder_id,
      });
      clearInput.mockRestore();

      // A refused release with the exact holder still current is not proof
      // that this holder left, even though the exact marker was cleared.
      const release = vi.spyOn(state.occupancy, "release").mockResolvedValueOnce(false);
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const secondQuiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(secondQuiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_UNAVAILABLE",
      });
      expect(release).toHaveBeenCalledTimes(1);
      expect(state.store.selections.get(key)).toMatchObject({ state: "paused" });
      expect(state.store.selections.get(key)?.pendingInput).toBeNull();
      expect(JSON.parse(await redis.client.get(occupancyKey) ?? "null")).toMatchObject({
        holderId: observe.body.holder_id,
      });
      release.mockRestore();

      // Only the real compare-and-release of that exact holder acknowledges
      // the Pause; no unrelated occupancy is touched.
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      const thirdQuiesce = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(thirdQuiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused", selection_id: selectionA },
      });
      expect(await redis.client.exists(occupancyKey)).toBe(0);
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

  it("lets one exact original-selection stop take over a resume awaiting its active ack without a late positive ack", async () => {
    const state = await fixture();
    let releaseFinalize!: () => void;
    const finalizeGate = new Promise<void>(resolve => { releaseFinalize = resolve; });
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      const cancelRunTools = vi.spyOn(state.transport, "cancelRunTools");
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused", selection_id: selectionA },
      });

      // Park the resume in its final positive publication after the store has
      // already written the new selection B as active.
      const originalFinalize = state.store.finalizeActive.bind(state.store);
      let finalizeStarted!: () => void;
      const started = new Promise<void>(resolve => { finalizeStarted = resolve; });
      state.store.finalizeActive = async input => {
        finalizeStarted();
        await finalizeGate;
        return originalFinalize(input);
      };
      const resumeFrame = controlFrame("resume", scope, selectionA, { new_selection_id: selectionB });
      socket.send(JSON.stringify(resumeFrame));
      await started;
      expect(state.store.selections.get(key)).toMatchObject({ state: "active", selectionId: selectionB });

      // A different target is never the takeover: it keeps the immediate
      // rejection and must not reserve the one slot.
      const foreignStop = controlFrame("stop", scope, selectionC);
      socket.send(JSON.stringify(foreignStop));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: foreignStop.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });

      // The real Mac controller still names the original A while it waits for
      // the resume ack. That exact stop is reserved and must not run early.
      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      // Frames are handled in order, so a pong before any control result
      // proves this stop was parked by the synchronous reservation rather
      // than rejected or executed.
      socket.send(JSON.stringify({ type: "ping" }));
      expect((await frames.until(isPongOrControlResult)).type).toBe("pong");
      expect(state.store.stopCalls).toHaveLength(0);

      releaseFinalize();
      // The late positive active ack is suppressed; only a negative result for
      // the superseded resume may arrive, before the reserved stop result.
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: resumeFrame.id, ok: false,
      });
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true, data: { state: "stopped", selection_id: selectionA },
      });
      expect(state.store.stopCalls).toHaveLength(1);
      const afterStop = await frames.settle();
      expect(afterStop.filter(isControlResult)).toEqual([]);
      expect(afterStop.filter(frame => frame.type === "command")).toEqual([]);

      // The persisted current B can no longer drive input.
      expect(state.store.selections.get(key)?.state).not.toBe("active");
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // A replay of the finished stop id is the bounded rejection, never a
      // second execution, and the resume was never retried.
      socket.send(JSON.stringify(stopFrame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
      });
      expect(state.store.resumeCalls).toHaveLength(1);
      expect(state.store.stopCalls).toHaveLength(1);
      expect(cancelRunTools).not.toHaveBeenCalled();
    } finally {
      releaseFinalize();
      await state.cleanup();
    }
  });

  it("lets one exact same-selection stop take over a pause awaiting a proven or failed quiesce", async () => {
    for (const outcome of ["acked", "failed"] as const) {
      const state = await fixture();
      let prepared: Awaited<ReturnType<typeof prepareSocket>> | undefined;
      let quiesce: ReturnType<typeof commandOf> | undefined;
      let quiesceSettled = false;
      try {
        prepared = await prepareSocket(state);
        const { socket, frames, scope, runToken } = prepared;
        const key = desktopComputerSelectionKey(scope);
        const cancelRunTools = vi.spyOn(state.transport, "cancelRunTools");
        await select(state, socket, frames, scope);
        socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
        const observe = commandOf(await frames.until(isCommand));
        socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
        await frames.until(isToolResult);

        // Pause A is parked on its one issued quiesce before the native ack.
        const pauseFrame = controlFrame("pause", scope, selectionA);
        socket.send(JSON.stringify(pauseFrame));
        quiesce = commandOf(await frames.until(isCommand));
        expect(quiesce.body).toMatchObject({ selection_id: selectionA, request: { kind: "quiesce" } });
        expect(state.store.selections.get(key)?.state).toBe("pausing");

        // The Mac still names the installed A while the pause is gated. That
        // exact stop is reserved, never answered with uncertainty, and must not
        // run before the pause transition has settled.
        const stopFrame = controlFrame("stop", scope, selectionA);
        socket.send(JSON.stringify(stopFrame));
        socket.send(JSON.stringify({ type: "ping" }));
        // Frames are handled in order, so a pong before any control result
        // proves this stop was parked by the synchronous reservation rather
        // than rejected or executed.
        expect((await frames.until(isPongOrControlResult)).type).toBe("pong");
        expect(state.store.stopCalls).toHaveLength(0);

        if (outcome === "acked") {
          socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
          quiesceSettled = true;
          // The superseded pause reports only a negative result; the reserved
          // stop then revokes the paused selection with no second quiesce.
          expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
            id: pauseFrame.id, ok: false,
          });
          expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
            id: stopFrame.id, ok: true, data: { state: "stopped", selection_id: selectionA },
          });
        } else {
          // The native quiesce failed, so the pause reports only a negative
          // result and retains the exact holder. The reserved stop must run
          // once, revoke the selection, and issue its own new cleanup quiesce
          // for that same selection and holder instead of retrying the pause.
          socket.send(JSON.stringify(desktopExecutionResultSchema.parse({
            type: "command.result", id: quiesce.id, operation: "computer.execute", ok: false,
            error_code: "RUNNER_OPERATION_UNCERTAIN",
          })));
          quiesceSettled = true;
          expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
            id: pauseFrame.id, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN",
          });
          expect(JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(scope.deviceId)) ?? "null"))
            .toMatchObject({ holderId: observe.body.holder_id, selectionId: selectionA });
          const cleanup = commandOf(await frames.until(isCommand));
          expect(cleanup.id).not.toBe(quiesce.id);
          expect(cleanup.body).toMatchObject({
            session_id: observe.body.session_id, selection_id: selectionA,
            holder_id: observe.body.holder_id, request: { kind: "quiesce" },
          });
          // Only the exact cleanup proof may produce the positive stop reply.
          expect((await frames.settle(50)).filter(isControlResult)).toEqual([]);
          socket.send(JSON.stringify(commandResult(cleanup, { kind: "quiesce", result: { quiesced: true } })));
          expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
            id: stopFrame.id, ok: true, data: { state: "stopped", selection_id: selectionA },
          });
        }
        expect(state.store.stopCalls).toHaveLength(1);
        expect(state.store.selections.get(key)?.state).toBe("stopped");
        // A superseded positive Pause reply must never produce an audit row.
        expect(state.pauseAudits).toEqual([]);
        expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);
        const afterStop = await frames.settle();
        expect(afterStop.filter(isControlResult)).toEqual([]);
        expect(afterStop.filter(frame => frame.type === "command")).toEqual([]);

        // The stopped predecessor can no longer drive input.
        socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
        expect(await frames.until(isToolResult)).toMatchObject({
          ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
        });
        expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
        expect(cancelRunTools).not.toHaveBeenCalled();
      } finally {
        // A failed assertion must not leave the pause parked on its quiesce.
        if (prepared && quiesce && !quiesceSettled && prepared.socket.readyState === WebSocket.OPEN) {
          prepared.socket.send(JSON.stringify(
            commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } }),
          ));
          await prepared.frames.settle(50);
        }
        await state.cleanup();
      }
    }
  });

  it("lets one exact original-selection stop stop the committed resume after its active ack", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused", selection_id: selectionA },
      });
      const resumeFrame = controlFrame("resume", scope, selectionA, { new_selection_id: selectionB });
      socket.send(JSON.stringify(resumeFrame));
      const resumed = controlResultOf(await frames.until(isControlResult));
      expect(resumed).toMatchObject({
        id: resumeFrame.id, ok: true, data: { state: "active", selection_id: selectionB },
      });
      if (!resumed.ok) throw new Error("resume failed");

      // The Mac still names A after the ack: it did not install B, so it never
      // adopted a B holder. The one receipt this socket saved still stops the
      // actual committed successor B, and the reply correlates to A.
      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true,
        data: { state: "stopped", selection_id: selectionA, session_id: resumed.data.session_id },
      });
      expect(state.store.stopCalls).toHaveLength(1);
      expect(state.store.selections.get(key)).toMatchObject({ state: "stopped", selectionId: selectionB });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("quiesces an exact successor holder recorded on the server when a receipt aliases the stop", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      const selected = await select(state, socket, frames, scope);
      if (!selected.ok) throw new Error("select failed");
      socket.send(JSON.stringify(controlFrame("pause", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "paused", selection_id: selectionA },
      });
      const resumeFrame = controlFrame("resume", scope, selectionA, { new_selection_id: selectionB });
      socket.send(JSON.stringify(resumeFrame));
      const resumed = controlResultOf(await frames.until(isControlResult));
      expect(resumed).toMatchObject({
        id: resumeFrame.id, ok: true, data: { state: "active", selection_id: selectionB },
      });
      if (!resumed.ok) throw new Error("resume failed");

      // This fixture only simulates an exact successor holder already recorded
      // on the server; it does not prove that the cancelled Mac adopted B.
      // The synthetic quiesce ack proves the server continuation, not a native
      // terminal.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      expect(observe.body.selection_id).toBe(selectionB);
      socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
      await frames.until(isToolResult);

      const stopFrame = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopFrame));
      const quiesce = commandOf(await frames.until(isCommand));
      expect(quiesce.body).toMatchObject({
        holder_id: observe.body.holder_id, selection_id: selectionB,
        session_id: resumed.data.session_id, request: { kind: "quiesce" },
      });
      socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopFrame.id, ok: true,
        data: { state: "stopped", selection_id: selectionA, session_id: resumed.data.session_id },
      });
      expect(state.store.stopCalls).toHaveLength(1);
      expect(state.store.selections.get(key)).toMatchObject({ state: "stopped", selectionId: selectionB });
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(0);

      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
    } finally {
      await state.cleanup();
    }
  });

  it("never lets an idempotent resume or a later selection authorize the original stop id", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope } = await prepareSocket(state);
      const key = desktopComputerSelectionKey(scope);
      // A fresh pick B, then an already-active resume A->B: it writes nothing,
      // so the arbitrary prior A is never associated with B.
      await select(state, socket, frames, scope, selectionB);
      const resumeFrame = controlFrame("resume", scope, selectionA, { new_selection_id: selectionB });
      socket.send(JSON.stringify(resumeFrame));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: resumeFrame.id, ok: true, data: { state: "active", selection_id: selectionB },
      });

      const stopA = controlFrame("stop", scope, selectionA);
      socket.send(JSON.stringify(stopA));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        id: stopA.id, ok: false, error_code: "COMPUTER_TARGET_CHANGED",
      });
      expect(state.store.selections.get(key)).toMatchObject({ state: "active", selectionId: selectionB });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);

      // B is stopped exactly, then a fresh pick C is current. The old
      // predecessor A still cannot revoke that different selection.
      socket.send(JSON.stringify(controlFrame("stop", scope, selectionB)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: true, data: { state: "stopped", selection_id: selectionB },
      });
      await select(state, socket, frames, scope, selectionC);
      socket.send(JSON.stringify(controlFrame("stop", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({
        ok: false, error_code: "COMPUTER_TARGET_CHANGED",
      });
      expect(state.store.selections.get(key)).toMatchObject({ state: "active", selectionId: selectionC });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
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
  // ---------------------------------------------------------------------
  // P1-23 publication repair: a read-only wait success is authoritative only
  // through the final locked compare immediately before the one socket send.
  // ---------------------------------------------------------------------
  async function observingWait(state: Awaited<ReturnType<typeof fixture>>) {
    const prepared = await prepareSocket(state, "computer.execute,computer.wait");
    const selected = await select(state, prepared.socket, prepared.frames, prepared.scope);
    if (!selected.ok) throw new Error("select failed");
    prepared.socket.send(JSON.stringify(toolRequest("observe", prepared.scope, prepared.runToken)));
    const observe = commandOf(await prepared.frames.until(isCommand));
    prepared.socket.send(JSON.stringify(commandResult(observe, { kind: "observe", result: observation })));
    await prepared.frames.until(isToolResult);
    return { ...prepared, selected, observe };
  }

  async function startWait(
    socket: WebSocket, frames: ReturnType<typeof frameQueue>, scope: DesktopRunScope, runToken: string,
    extra: Record<string, unknown> = {},
  ) {
    const request = toolRequest("wait", scope, runToken, extra);
    socket.send(JSON.stringify(request));
    const command = commandOf(await frames.until(isCommand));
    return { request, command };
  }

  it("withholds an observe success when pause, stop, or same-id renewal lands during the audit", async () => {
    const staleObservation: ComputerObservation = {
      observation_id: "obs-stale", tree_quality: "good", truncated: false,
      nodes: [{ ref: "e-stale", role: "text", name: "PRIVATE_STALE_AX_TEXT" }],
    };
    for (const action of ["renew", "pause", "stop"] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } =
          await prepareSocket(state, "computer.execute,computer.wait");
        await select(state, socket, frames, scope);
        let releaseAudit!: () => void;
        state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
        const auditStarted = state.nextAuditStarted();
        socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
        const observe = commandOf(await frames.until(isCommand));
        socket.send(JSON.stringify(commandResult(observe, {
          kind: "observe", result: staleObservation,
        })));
        await auditStarted;
        // The native AX text is already inside the API, but the audit and every
        // later publication step are still pending.
        socket.send(JSON.stringify(action === "renew"
          ? controlFrame("select", scope, selectionA)
          : controlFrame(action, scope, selectionA)));
        if (action !== "renew") {
          const quiesce = commandOf(await frames.until(isCommand));
          expect(quiesce.body.request).toEqual({ kind: "quiesce" });
          socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
        }
        expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ ok: true });
        releaseAudit();
        const result = await frames.until(isToolResult);
        expect(result).toMatchObject({
          ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
        });
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain("PRIVATE_STALE_AX_TEXT");
        expect(serialized).not.toContain("obs-stale");
        expect(serialized).not.toContain("e-stale");
        expect(state.audit).toHaveBeenCalledTimes(1);
        expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
          action: "desktop_tool_requested", result: "success",
          metadata: expect.objectContaining({ computer_request: "observe" }),
        }));
        expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
        expect(state.store.claimInputCalls).toHaveLength(0);
        expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      } finally {
        await state.cleanup();
      }
    }
  });

  it("fails an observe closed as unavailable on a different reply kind without replaying a command", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      // The Mac answered with a wait read for an observe request. The request
      // kind, the proof, and the returned read kind must all agree.
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, {
        kind: "wait", result: { result: "met", waited_ms: 1 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("fails an uncertain observe transport as a bounded timeout and retains the adopted holder", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      const uncertain = vi.spyOn(state.transport, "send").mockRejectedValueOnce(
        new DesktopCommandUncertainError(),
      );
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TIMEOUT" },
      });
      expect(uncertain).toHaveBeenCalledOnce();
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      // The adopted holder stays available for pause/stop quiesce.
      expect(await redis.client.exists(localComputerGuiOccupancyKey(scope.deviceId))).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("suppresses an observe result after a late tool cancel and never replays its AX text", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      const request = toolRequest("observe", scope, runToken);
      socket.send(JSON.stringify(request));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, {
        kind: "observe", result: {
          observation_id: "obs-private", tree_quality: "good", truncated: false,
          nodes: [{ ref: "e-private", role: "text", name: "PRIVATE_CANCEL_AX_TEXT" }],
        },
      })));
      await auditStarted;
      await sendCancelAndAwaitApplied(state, socket, {
        id: request.id, operation: "computer.execute",
        conversation_id: request.conversation_id, turn_id: request.turn_id,
        runtime_generation: request.runtime_generation,
      });
      releaseAudit();
      const leftover = await frames.settle(200);
      expect(leftover.filter(frame => frame.type === "tool.result")).toEqual([]);
      // The native observe command is never replayed after the late cancel.
      expect(leftover.filter(frame => frame.type === "command")).toEqual([]);
      expect(state.audit).toHaveBeenCalledTimes(1);
      expect(state.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        action: "desktop_tool_requested", result: "success",
        metadata: expect.objectContaining({ computer_request: "observe", delivery: "unconfirmed" }),
      }));
      expect(JSON.stringify(state.audit.mock.calls)).not.toContain("PRIVATE_CANCEL_AX_TEXT");
    } finally {
      await state.cleanup();
    }
  });

  it("withholds an observe success when the original grant is no longer live at publication", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await prepareSocket(state);
      await select(state, socket, frames, scope);
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      socket.send(JSON.stringify(toolRequest("observe", scope, runToken)));
      const observe = commandOf(await frames.until(isCommand));
      socket.send(JSON.stringify(commandResult(observe, {
        kind: "observe", result: {
          observation_id: "obs-private", tree_quality: "good", truncated: false,
          nodes: [{ ref: "e-private", role: "text", name: "PRIVATE_DENIED_AX_TEXT" }],
        },
      })));
      await auditStarted;
      // The command was admitted under the live grant; the grant is revoked
      // before the audit resolves. The exact final compare must withhold it.
      state.setVerifyFailure(new AppError("FORBIDDEN"));
      releaseAudit();
      const result = await frames.until(isToolResult);
      expect(result).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_DENIED_AX_TEXT");
      // The internal proof carries the exact observe kind into the final compare.
      expect(state.verifyDispatch.mock.lastCall?.[0]).toMatchObject({
        capability: "computer.observe", requestKind: "observe",
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("publishes exactly one wait success under the original selection and grant", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { command } = await startWait(socket, frames, scope, runToken);
      const waitAuthorization = await state.authorize.mock.results.at(-1)?.value;
      if (!waitAuthorization) throw new Error("wait authorization missing");

      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "wait", result: { result: "met", waited_ms: 4 } },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
      // Observe acquisition/admission/publication, wait admission, and the
      // final wait publication compare.
      expect(state.verifyDispatch).toHaveBeenCalledTimes(5);
      const publication = state.verifyDispatch.mock.calls.at(-1);
      expect(publication?.[0]).toMatchObject({
        scope, sessionId: command.body.session_id, grantId: waitAuthorization.grantId,
        capability: "computer.observe", bundleId, expiresAt: waitAuthorization.expiresAt,
      });
      expect(typeof publication?.[1]).toBe("function");
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("withholds a wait success when only the final atomic read spans an elapsed command deadline", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const occupancyKey = localComputerGuiOccupancyKey(scope.deviceId);
      const held = JSON.parse(await redis.client.get(occupancyKey) ?? "null");
      await redis.client.set(occupancyKey, JSON.stringify({ ...held, expiresAt: Date.now() + 700 }));
      let releaseFinal!: () => void;
      state.setFinalCheckGate(new Promise<void>(resolve => { releaseFinal = resolve; }));
      const finalStarted = state.nextFinalCheckStarted();
      const { command } = await startWait(socket, frames, scope, runToken);
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      await Promise.race([
        finalStarted,
        delay(1_000).then(() => { throw new Error("final atomic read was not reached"); }),
      ]);
      // The callback and session remain live; only the final atomic read
      // straddles the original command/holder deadline.
      await delay(800);
      releaseFinal();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TIMEOUT" },
      });
      expect(state.store.finalCheckCalls).toBe(2);
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("withholds a wait success when the final atomic read sees run or presence lost after earlier reads", async () => {
    for (const loss of ["run", "presence"] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } = await observingWait(state);
        let releaseFinal!: () => void;
        state.setFinalCheckGate(new Promise<void>(resolve => { releaseFinal = resolve; }));
        const finalStarted = state.nextFinalCheckStarted();
        const { command } = await startWait(socket, frames, scope, runToken);
        socket.send(JSON.stringify(commandResult(command, {
          kind: "wait", result: { result: "met", waited_ms: 4 },
        })));
        await Promise.race([
          finalStarted,
          delay(1_000).then(() => { throw new Error("final atomic read was not reached"); }),
        ]);
        if (loss === "run") state.store.bindingLiveValue = false;
        else state.store.presenceLiveValue = false;
        releaseFinal();
        expect(await frames.until(isToolResult)).toMatchObject({
          ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
        });
        expect(state.store.finalCheckCalls).toBe(2);
        expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
      } finally {
        await state.cleanup();
      }
    }
  });

  it("rejects a wait result whose waited_ms exceeds this request's timeout, and accepts the exact bound", async () => {
    for (const waitedMs of [101, 100] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } = await observingWait(state);
        const { command } = await startWait(socket, frames, scope, runToken, {
          body: {
            kind: "wait",
            input: { observation_id: "obs-1", ref: "@obs-1:e1", timeout_ms: 100 },
          },
        });
        socket.send(JSON.stringify(commandResult(command, {
          kind: "wait", result: { result: "timed_out", waited_ms: waitedMs },
        })));
        expect(await frames.until(isToolResult)).toMatchObject(waitedMs === 100
          ? { ok: true, data: { kind: "wait", result: { result: "timed_out", waited_ms: 100 } } }
          : { ok: true, data: { kind: "failure", error: "COMPUTER_INVALID" } });
        expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
        expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      } finally {
        await state.cleanup();
      }
    }
  });

  it("records a wait attempt with unconfirmed delivery and no observation content", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { command } = await startWait(socket, frames, scope, runToken);
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "wait", result: { result: "met", waited_ms: 4 } },
      });
      const audit = state.audit.mock.calls.at(-1)?.[0];
      expect(audit).toMatchObject({
        action: "desktop_tool_requested", result: "success",
        metadata: {
          operation: "computer.execute", computer_request: "wait", delivery: "unconfirmed",
        },
      });
      expect(Object.keys(audit?.metadata ?? {})).not.toEqual(expect.arrayContaining([
        "observation_id", "ref", "timeout_ms",
      ]));
    } finally {
      await state.cleanup();
    }
  });

  it("withholds a wait success whose audit resolves after a same-id renewal", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { command } = await startWait(socket, frames, scope, runToken);
      const key = desktopComputerSelectionKey(scope);
      const before = state.store.selections.get(key);
      if (!before) throw new Error("selection missing");
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      await auditStarted;
      // The device result is already inside the API, but the audit and every
      // later publication step are still pending. Renewal writes a new control
      // epoch first; the read that belonged to the old epoch must not publish.
      socket.send(JSON.stringify(controlFrame("select", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ ok: true });
      // Same session and grant identity; only the exact epoch/expiry advanced.
      expect(state.store.selections.get(key)?.sessionId).toBe(before.sessionId);
      expect(state.store.selections.get(key)?.controlEpoch).not.toBe(before.controlEpoch);
      releaseAudit();
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      // The pre-publication attempt row is already written and stays
      // unconfirmed after the late denial; it never claims a final publish.
      const audit = state.audit.mock.calls.at(-1)?.[0];
      expect(audit).toMatchObject({
        action: "desktop_tool_requested", result: "success",
        metadata: { computer_request: "wait", delivery: "unconfirmed" },
      });
    } finally {
      await state.cleanup();
    }
  });

  it("withholds a wait success when pause or stop lands during the audit", async () => {
    for (const action of ["pause", "stop"] as const) {
      const state = await fixture();
      try {
        const { socket, frames, scope, runToken } = await observingWait(state);
        const { command } = await startWait(socket, frames, scope, runToken);
        let releaseAudit!: () => void;
        state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
        const auditStarted = state.nextAuditStarted();
        socket.send(JSON.stringify(commandResult(command, {
          kind: "wait", result: { result: "timed_out", waited_ms: 8_000 },
        })));
        await auditStarted;
        socket.send(JSON.stringify(controlFrame(action, scope, selectionA)));
        const quiesce = commandOf(await frames.until(isCommand));
        expect(quiesce.body.request).toEqual({ kind: "quiesce" });
        socket.send(JSON.stringify(commandResult(quiesce, { kind: "quiesce", result: { quiesced: true } })));
        expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ ok: true });
        releaseAudit();
        expect(await frames.until(isToolResult)).toMatchObject({
          ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
        });
        expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
        expect(state.store.claimInputCalls).toHaveLength(0);
        expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
      } finally {
        await state.cleanup();
      }
    }
  });

  it("withholds a wait success when a same-id renewal commits while the final authorization waits", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { command } = await startWait(socket, frames, scope, runToken);
      const key = desktopComputerSelectionKey(scope);
      const before = state.store.selections.get(key);
      if (!before) throw new Error("selection missing");
      let releaseVerify!: () => void;
      state.setVerifyGate(new Promise<void>(resolve => { releaseVerify = resolve; }));
      const verifyStarted = state.nextVerifyStarted();
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      await verifyStarted;
      // The final authorization is waiting for the conversation lock; the
      // renewal commits first. The same session and grant ids are still live,
      // so only the exact request-local selection/epoch compare can withhold
      // success.
      socket.send(JSON.stringify(controlFrame("select", scope, selectionA)));
      expect(controlResultOf(await frames.until(isControlResult))).toMatchObject({ ok: true });
      expect(state.store.selections.get(key)?.sessionId).toBe(before.sessionId);
      expect(state.store.selections.get(key)?.controlEpoch).not.toBe(before.controlEpoch);
      releaseVerify();
      state.setVerifyGate(undefined);
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_TARGET_CHANGED" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("never publishes a wait success after a late tool cancel", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { request, command } = await startWait(socket, frames, scope, runToken);
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      await auditStarted;
      await sendCancelAndAwaitApplied(state, socket, {
        id: request.id, operation: "computer.execute",
        conversation_id: scope.conversationId, turn_id: scope.turnId,
        runtime_generation: scope.runtimeGeneration,
      });
      releaseAudit();
      expect((await frames.settle(200)).filter(frame => frame.type === "tool.result")).toEqual([]);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("suppresses an in-flight duplicate wait and answers a settled duplicate as a clean read failure", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { request, command } = await startWait(socket, frames, scope, runToken);
      let releaseAudit!: () => void;
      state.setAuditGate(new Promise<void>(resolve => { releaseAudit = resolve; }));
      const auditStarted = state.nextAuditStarted();
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "timed_out", waited_ms: 8_000 },
      })));
      await auditStarted;
      // Existing in-flight identical frame suppression is unchanged.
      socket.send(JSON.stringify(request));
      await delay(50);
      expect((await frames.settle(0)).filter(frame => frame.type === "command")).toEqual([]);
      releaseAudit();
      expect(await frames.until(isToolResult)).toMatchObject({ ok: true, data: { kind: "wait" } });
      expect((await frames.settle()).filter(frame => frame.type === "command" || frame.type === "tool.result")).toEqual([]);

      // A settled duplicate is a clean read failure, never mutation uncertainty,
      // and it never sends the wait again.
      socket.send(JSON.stringify(request));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      expect((await frames.settle()).filter(frame => frame.type === "command")).toEqual([]);
      expect(state.store.claimInputCalls).toHaveLength(0);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });

  it("fails a wait closed with a clean read failure when the audit write is rejected", async () => {
    const state = await fixture();
    try {
      const { socket, frames, scope, runToken } = await observingWait(state);
      const { command } = await startWait(socket, frames, scope, runToken);
      state.audit.mockRejectedValueOnce(new Error("audit unavailable"));
      socket.send(JSON.stringify(commandResult(command, {
        kind: "wait", result: { result: "met", waited_ms: 4 },
      })));
      expect(await frames.until(isToolResult)).toMatchObject({
        ok: true, data: { kind: "failure", error: "COMPUTER_UNAVAILABLE" },
      });
      // Observe acquisition/admission/publication plus the wait admission; the
      // wait publication never ran.
      expect(state.verifyDispatch).toHaveBeenCalledTimes(4);
      expect(state.store.selections.get(desktopComputerSelectionKey(scope))?.pendingInput).toBeNull();
    } finally {
      await state.cleanup();
    }
  });
  // api-stop-race: end
});
