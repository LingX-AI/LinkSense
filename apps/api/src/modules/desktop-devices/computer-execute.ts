import { randomUUID } from "node:crypto";
import {
  computerExecuteResultSchema,
  desktopComputerExecuteBodySchema,
  desktopComputerQuiesceLifetimeMs,
  desktopExecutionCommandSchema,
  localComputerGrantSchema,
  type ComputerExecuteInput,
  type ComputerExecuteResult,
  type ComputerFailureCode,
  type DesktopComputerExecuteBody,
  type DesktopExecutionResult,
  type DesktopToolRequest,
} from "@linksense/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

import {
  DesktopCommandUncertainError,
  type DesktopDeviceTransport,
} from "../../adapters/desktop-device-transport.js";
import { sha256 } from "../../lib/crypto.js";
import { desktopRunScopeSchema, type DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type {
  LocalComputerActionAuthorization,
  LocalComputerActionCapability,
} from "../local-computer/authorization.js";
import { localComputerGuiOccupancyKey, type LocalComputerGuiOccupancy } from "../local-computer/occupancy.js";
import type {
  DesktopComputerDispatchAdmission,
  DesktopComputerDispatchAdmissionInput,
} from "./computer-admission.js";
import { desktopExecutionBindingSchema, type DesktopExecutionBinding } from "./coordinator.js";

type ComputerExecuteToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>;
const selectionIdSchema = z.uuid().transform(value => value.toLowerCase());
const bundleIdSchema = localComputerGrantSchema.shape.target.shape.bundle_id;

export type DesktopComputerExecuteSelect = (input: {
  scope: DesktopRunScope;
  capability: LocalComputerActionCapability;
}) => { selectionId: string; bundleId: string };
/**
 * Bound form of `authorizeLocalComputerAction`. Callers pass only the canonical
 * run scope, capability, host-selected bundle, and scoped run bearer.
 */
export type DesktopComputerExecuteAuthorize = (input: {
  scope: DesktopRunScope;
  capability: LocalComputerActionCapability;
  bundleId: string;
  runToken: string;
}) => Promise<LocalComputerActionAuthorization>;
/** Dependencies supplied by the single API dispatch path, not by the model. */
export type DesktopComputerExecuteHost = {
  authorize: DesktopComputerExecuteAuthorize;
  bindings: DesktopComputerFixtureBindings;
  occupancy: Pick<LocalComputerGuiOccupancy, "acquire" | "match" | "release">;
  transport: Pick<DesktopDeviceTransport, "connection" | "send">;
  claimNativeCall: (turnId: string, nativeCallId: string) => Promise<boolean>;
  /** Exact-entry recheck of the original grant/session at dispatch time. */
  verifyDispatch: (input: {
    scope: DesktopRunScope;
    sessionId: string;
    grantId: string;
    capability: LocalComputerActionCapability;
    bundleId: string;
    expiresAt: Date;
  }) => Promise<void>;
};
/** Fixture-lane factory; app.ts never supplies it. */
export type DesktopComputerExecuteFactory = (host: DesktopComputerExecuteHost) => DesktopComputerExecuteFixture;

const fixtureBindingInputSchema = z.strictObject({
  v: z.literal(1),
  selectionId: z.uuid(),
  sessionId: z.uuid(),
  holderId: z.uuid(),
  binding: desktopExecutionBindingSchema,
});
const fixtureBindingSchema = fixtureBindingInputSchema.extend({
  expiresAt: z.number().int().positive(),
});
type FixtureBindingInput = z.infer<typeof fixtureBindingInputSchema>;
type FixtureBinding = z.infer<typeof fixtureBindingSchema>;

// The occupancy key remains the only authority. This script atomically proves
// the candidate is still the exact current occupancy holder for this canonical
// scope using Redis TIME, then keeps a bounded grace copy for quiesce. It never
// extends the occupancy holder, and a stale observe cannot overwrite a newer
// proven occupancy because its holder no longer matches the occupancy key.
const setBindingScript = `
local raw = redis.call('GET', KEYS[2])
if not raw then return 0 end
local ok, occupancy = pcall(cjson.decode, raw)
if not ok or type(occupancy) ~= 'table' or occupancy.v ~= 1 then return 0 end
if occupancy.holderId ~= ARGV[1] or occupancy.selectionId ~= ARGV[2]
  or occupancy.sessionId ~= ARGV[3] then return 0 end
local scope = occupancy.scope
if type(scope) ~= 'table' or scope.ownerId ~= ARGV[4] or scope.connectionId ~= ARGV[5]
  or scope.conversationId ~= ARGV[6] or scope.turnId ~= ARGV[7]
  or scope.runtimeGeneration ~= ARGV[8] or scope.deviceId ~= ARGV[9] then return 0 end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if type(occupancy.expiresAt) ~= 'number' or occupancy.expiresAt <= now then return 0 end
local bindingOk, binding = pcall(cjson.decode, ARGV[10])
if not bindingOk or type(binding) ~= 'table' then return 0 end
binding.expiresAt = occupancy.expiresAt
local ttl = occupancy.expiresAt + tonumber(ARGV[11]) - now
if ttl <= 0 then return 0 end
redis.call('SET', KEYS[1], cjson.encode(binding), 'PX', ttl)
return 1
`;
const findBindingScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local ok, binding = pcall(cjson.decode, raw)
if not ok or type(binding) ~= 'table' or binding.v ~= 1
  or type(binding.expiresAt) ~= 'number' then return nil end
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if now > binding.expiresAt + tonumber(ARGV[1]) then return nil end
return raw
`;
const clearBindingScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, existing = pcall(cjson.decode, raw)
if not ok or type(existing) ~= 'table' or existing.holderId ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

/**
 * Bounded quiesce grace copy, never a second authorization plane.
 *
 * A binding is written only after the reviewed occupancy overlay acquired a
 * holder, and `bind` atomically rechecks the exact holder/selection/session and
 * canonical scope against the actual occupancy key using Redis TIME. The copy
 * lives only until the occupancy deadline plus the shared 5s quiesce grace; the
 * occupancy holder itself is not extended. A stale observe whose holder is no
 * longer current cannot write or clobber, while a proven newer occupancy after
 * expiry replaces the older grace copy. Malformed or beyond-grace state reads
 * as absent, and `clear` compare-deletes by holder so a stale quiesce can never
 * release a newer holder.
 */
export class DesktopComputerFixtureBindings {
  constructor(private readonly redis: Pick<Redis, "eval">) {}

  async bind(scope: DesktopRunScope, input: FixtureBindingInput): Promise<boolean> {
    const value = fixtureBindingInputSchema.parse(input);
    return await this.redis.eval(
      setBindingScript, 2, bindingKey(scope), localComputerGuiOccupancyKey(scope.deviceId),
      value.holderId, value.selectionId, value.sessionId,
      scope.ownerId, scope.connectionId, scope.conversationId, scope.turnId, scope.runtimeGeneration, scope.deviceId,
      JSON.stringify(value), String(desktopComputerQuiesceLifetimeMs),
    ) === 1;
  }

  async find(scope: DesktopRunScope): Promise<FixtureBinding | null> {
    const raw = await this.redis.eval(
      findBindingScript, 1, bindingKey(scope), String(desktopComputerQuiesceLifetimeMs),
    );
    if (typeof raw !== "string") return null;
    try {
      const parsed = fixtureBindingSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Removes this exact holder only; a newer holder is never released. */
  async clear(scope: DesktopRunScope, holderId: string): Promise<boolean> {
    return await this.redis.eval(
      clearBindingScript, 1, bindingKey(scope), z.uuid().parse(holderId),
    ) === 1;
  }
}

/**
 * Smallest TS side of the M1b fixture route.
 *
 * Status/observe/act arrive as an existing `tool.request`; only the canonical
 * scope and run bearer cross into authorization, and occupancy derives its key
 * from the authorized scope. Status sends `holder_id: null` and never acquires;
 * the first authorized observe binds the API-issued holder in Redis, and act or
 * quiesce must match that exact holder.
 *
 * A canceled, timed-out, or late act result never releases occupancy. Only a
 * separate correlated `quiesce` command result proves the native executor
 * returned; the native executor's own mutex serializes input and is the
 * authority for that proof. Quiesce skips grant/session authorization so it can
 * stop already expired or revoked input, but it requires strictly current
 * control and never sends after the bound connection/gateway changed. The
 * occupancy holder is not extended; only its exact metadata is retained for the
 * bounded 5s quiesce grace after the occupancy deadline. Act still requires a
 * fresh authorization and a live occupancy match, and a stale quiesce only
 * compare-deletes its own holder.
 */
export class DesktopComputerExecuteFixture {
  constructor(private readonly options: DesktopComputerExecuteHost & { select: DesktopComputerExecuteSelect }) {}

  async execute(input: {
    scope: DesktopRunScope;
    request: ComputerExecuteToolRequest;
    signal: AbortSignal;
  }): Promise<ComputerExecuteResult> {
    const scope = desktopRunScopeSchema.parse(input.scope);
    const { body } = input.request;
    const capability: LocalComputerActionCapability = body.kind === "act" ? "computer.act" : "computer.observe";
    const selected = this.options.select({ scope, capability });
    const selectionId = selectionIdSchema.parse(selected.selectionId);
    const bundleId = bundleIdSchema.parse(selected.bundleId);
    const authorization = await this.options.authorize({
      scope, capability, bundleId, runToken: input.request.run_token,
    });
    if (!sameScope(desktopRunScopeSchema.parse(authorization.scope), scope)) return failure("COMPUTER_ACCESS_DENIED");
    const sessionId = z.uuid().parse(authorization.sessionId);
    const admission: DesktopComputerDispatchAdmissionInput = {
      scope, sessionId, grantId: z.uuid().parse(authorization.grantId),
      capability, bundleId, expiresAt: authorization.expiresAt.toISOString(),
    };
    input.signal.throwIfAborted();
    const toolExpiresAt = Date.parse(input.request.expires_at);
    if (!Number.isFinite(toolExpiresAt)) return failure("COMPUTER_INVALID");

    if (body.kind === "status") {
      // Read-only check: authorization is required, but status never acquires
      // or adopts a holder, so there is no holder to invent.
      const binding = await this.currentBinding(scope);
      if (!binding) return failure("COMPUTER_UNAVAILABLE");
      const expiresAt = Math.min(toolExpiresAt, authorization.expiresAt.getTime());
      if (expiresAt <= Date.now()) return failure("COMPUTER_TIMEOUT");
      const result = await this.send(
        binding, scope, sessionId, selectionId, null, { kind: "status" }, expiresAt, input.signal, admission,
      );
      return expectKind(result, "status");
    }

    if (body.kind === "observe") {
      const acquired = await this.options.occupancy.acquire({ authorization, selectionId });
      if (acquired.status !== "acquired") return acquireFailure(acquired);
      const binding = await this.currentBinding(scope);
      if (!binding) return failure("COMPUTER_UNAVAILABLE");
      const bound = await this.options.bindings.bind(scope, {
        v: 1, selectionId, sessionId, holderId: acquired.holderId, binding,
      });
      // The occupancy key changed since acquisition; never adopt that holder.
      if (!bound) return failure("COMPUTER_TARGET_CHANGED");
      const expiresAt = Math.min(toolExpiresAt, authorization.expiresAt.getTime(), acquired.expiresAt);
      if (expiresAt <= Date.now()) return failure("COMPUTER_TIMEOUT");
      const result = await this.send(
        binding, scope, sessionId, selectionId, acquired.holderId, { kind: "observe" }, expiresAt, input.signal, admission,
      );
      return expectKind(result, "observe");
    }

    const bound = await this.options.bindings.find(scope);
    if (!bound) return failure("COMPUTER_STALE_OBSERVATION");
    // The host selection may have changed since observe; occupancy reports
    // target_changed instead of letting a new selection overlap old input.
    const matched = await this.options.occupancy.match({
      authorization, selectionId, holderId: bound.holderId,
    });
    if (matched.status === "target_changed") return failure("COMPUTER_TARGET_CHANGED");
    if (matched.status === "not_held") {
      // A stale holder reference is never released here; its own TTL or an
      // explicit quiesce owns that transition.
      return failure(matched.reason === "connection" || matched.reason === "malformed"
        ? "COMPUTER_UNAVAILABLE" : "COMPUTER_STALE_OBSERVATION");
    }
    const binding = await this.currentBinding(scope);
    if (!binding) return failure("COMPUTER_UNAVAILABLE");
    // Re-prove the exact current occupancy holder and refresh the bounded
    // grace copy after the fresh match; a changed holder is never adopted.
    if (!await this.options.bindings.bind(scope, {
      v: 1, selectionId: bound.selectionId, sessionId: bound.sessionId, holderId: bound.holderId, binding,
    })) {
      return failure("COMPUTER_STALE_OBSERVATION");
    }
    // One native action per authorized run, even under a new transport request.
    if (!await this.options.claimNativeCall(scope.turnId, body.native_call_id)) {
      return failure("RUNNER_OPERATION_UNCERTAIN");
    }
    const expiresAt = Math.min(toolExpiresAt, authorization.expiresAt.getTime(), matched.expiresAt);
    if (expiresAt <= Date.now()) return failure("COMPUTER_TIMEOUT");
    const result = await this.send(
      binding, scope, bound.sessionId, bound.selectionId, bound.holderId, body, expiresAt, input.signal, admission,
    );
    return expectKind(result, "act");
  }

  /**
   * Internal gateway admission for one queued command. The selector is re-derived
   * from trusted fixture policy, never from model or device input, and the exact
   * original session/grant/capability/application must still be live in
   * PostgreSQL. Scope, selection, holder, or capability changes deny dispatch.
   */
  async admit(input: {
    scope: DesktopRunScope;
    request: DesktopComputerExecuteBody["request"];
    sessionId: string;
    selectionId: string;
    holderId: string | null;
    admission: DesktopComputerDispatchAdmission;
  }): Promise<boolean> {
    try {
      const scope = desktopRunScopeSchema.parse(input.scope);
      const capability: LocalComputerActionCapability | undefined = input.request.kind === "act"
        ? "computer.act" : input.request.kind === "quiesce" ? undefined : "computer.observe";
      if (!capability) return false;
      const selected = this.options.select({ scope, capability });
      const selectionId = selectionIdSchema.parse(selected.selectionId);
      const bundleId = bundleIdSchema.parse(selected.bundleId);
      if (!sameScope(desktopRunScopeSchema.parse(input.admission.scope), scope)) return false;
      if (input.admission.capability !== capability || input.admission.bundleId !== bundleId) return false;
      if (input.admission.expiresAt.getTime() <= Date.now()) return false;
      if (input.sessionId !== input.admission.sessionId) return false;
      if (input.selectionId !== selectionId) return false;
      if (input.request.kind !== "status") {
        // A newer observe, a different selection, or an occupancy deadline that
        // has passed must not inherit this queued command. The grace copy is
        // for quiesce only; act/observe still need live occupancy.
        const bound = await this.options.bindings.find(scope);
        if (!bound || bound.holderId !== input.holderId || bound.selectionId !== selectionId ||
            bound.expiresAt <= Date.now()) return false;
      }
      await this.options.verifyDispatch({
        scope, sessionId: input.admission.sessionId, grantId: input.admission.grantId,
        capability, bundleId, expiresAt: input.admission.expiresAt,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fixture success barrier. Quiesce intentionally skips grant/session
   * authorization so it can stop expired or revoked input, but it requires the
   * exact current connection and gateway that owns the bound holder. Occupancy
   * is released only after the matching Mac ack and only by compare-and-delete.
   */
  async quiesce(input: { scope: DesktopRunScope; signal: AbortSignal }): Promise<ComputerExecuteResult> {
    const scope = desktopRunScopeSchema.parse(input.scope);
    const bound = await this.options.bindings.find(scope);
    if (!bound) return failure("COMPUTER_UNAVAILABLE");
    const current = await this.options.transport.connection(scope.deviceId);
    if (!current || current.connectionId !== bound.binding.connectionId ||
        current.gatewayId !== bound.binding.gatewayId) {
      return failure("COMPUTER_UNAVAILABLE");
    }
    const result = await this.send(
      current, scope, bound.sessionId, bound.selectionId, bound.holderId,
      { kind: "quiesce" }, Date.now() + desktopComputerQuiesceLifetimeMs, input.signal,
    );
    if (result.kind === "quiesce") {
      await this.options.occupancy.release(scope.deviceId, bound.holderId);
      await this.options.bindings.clear(scope, bound.holderId);
    }
    return result;
  }

  private async currentBinding(scope: DesktopRunScope): Promise<DesktopExecutionBinding | null> {
    const binding = await this.options.transport.connection(scope.deviceId);
    return binding?.connectionId === scope.connectionId ? binding : null;
  }

  private async send(
    binding: DesktopExecutionBinding,
    scope: DesktopRunScope,
    sessionId: string,
    selectionId: string,
    holderId: string | null,
    request: ComputerExecuteInput | { kind: "quiesce" },
    expiresAt: number,
    signal: AbortSignal,
    admission?: DesktopComputerDispatchAdmissionInput,
  ): Promise<ComputerExecuteResult> {
    const command = desktopExecutionCommandSchema.parse({
      type: "command", id: randomUUID(), owner_id: scope.ownerId,
      conversation_id: scope.conversationId, runtime_generation: scope.runtimeGeneration, turn_id: scope.turnId,
      expires_at: new Date(expiresAt).toISOString(), operation: "computer.execute",
      body: desktopComputerExecuteBodySchema.parse({
        session_id: sessionId, selection_id: selectionId, holder_id: holderId, request,
      }),
    });
    signal.throwIfAborted();
    let frame: DesktopExecutionResult;
    try {
      frame = await this.options.transport.send(binding, command, signal, admission);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DesktopCommandUncertainError) return failure("RUNNER_OPERATION_UNCERTAIN");
      return failure("COMPUTER_UNAVAILABLE");
    }
    signal.throwIfAborted();
    if (!frame.ok) return failure(commandFailure(frame));
    if (frame.operation !== "computer.execute") return failure("RUNNER_OPERATION_UNCERTAIN");
    return computerExecuteResultSchema.parse(frame.result);
  }
}

const bindingKey = (scope: DesktopRunScope) =>
  `linksense:desktop-computer-fixture:${sha256(scopeKey(scope))}`;
/** White-box key for fixture tests only. */
export const desktopComputerFixtureBindingKey = (scope: DesktopRunScope): string => bindingKey(scope);

function scopeKey(scope: DesktopRunScope): string {
  return [
    scope.ownerId, scope.deviceId, scope.connectionId, scope.conversationId,
    scope.turnId, scope.runtimeGeneration,
  ].join(":");
}

function sameScope(a: DesktopRunScope, b: DesktopRunScope): boolean {
  return a.ownerId === b.ownerId && a.deviceId === b.deviceId && a.connectionId === b.connectionId &&
    a.conversationId === b.conversationId && a.turnId === b.turnId && a.runtimeGeneration === b.runtimeGeneration;
}

function failure(error: ComputerFailureCode): ComputerExecuteResult {
  return { kind: "failure", error };
}

function expectKind(result: ComputerExecuteResult, kind: "status" | "observe" | "act"): ComputerExecuteResult {
  return result.kind === "failure" || result.kind === kind ? result : failure("RUNNER_OPERATION_UNCERTAIN");
}

function acquireFailure(result: Exclude<
  Awaited<ReturnType<LocalComputerGuiOccupancy["acquire"]>>, { status: "acquired" }
>): ComputerExecuteResult {
  if (result.status === "device_busy") return failure("DEVICE_BUSY");
  if (result.status === "target_changed") return failure("COMPUTER_TARGET_CHANGED");
  return failure(result.reason === "expired" ? "COMPUTER_ACCESS_DENIED" : "COMPUTER_UNAVAILABLE");
}

function commandFailure(frame: Extract<DesktopExecutionResult, { ok: false }>): ComputerFailureCode {
  if (frame.error_code === "RUNNER_OPERATION_UNCERTAIN") return "RUNNER_OPERATION_UNCERTAIN";
  if (frame.error_code === "FORBIDDEN") return "COMPUTER_ACCESS_DENIED";
  return "COMPUTER_UNAVAILABLE";
}
