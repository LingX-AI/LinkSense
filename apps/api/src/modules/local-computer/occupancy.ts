import { localComputerGrantSchema } from "@linksense/shared";
import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { desktopDeviceConnectionKey } from "../desktop-devices/coordinator.js";
import {
  desktopRunScopeSchema,
  type DesktopRunScope,
} from "../desktop-credentials/run-leases.js";
import type { LocalComputerActionAuthorization } from "./authorization.js";

/**
 * Single-device GUI occupancy for local computer use.
 *
 * One device has at most one live holder. The holder is created only by an explicit authorized
 * `computer.observe`; act paths must `match` or `refresh` the holder returned by that observation and
 * can never create one. Ownership is bound to the canonical run scope carried by the authorization
 * permit, the verified local computer session and application grant, and an opaque host-issued
 * selection id. There is no separately supplied scope, model selector, window title, or PID.
 *
 * All state is one Redis key per device together with the existing device connection key. Every
 * transition is a single Lua comparison, so competing API workers cannot both acquire. There is no
 * process memory, distributed lock, or second permission plane. TTL and expiry decisions use Redis
 * TIME inside the same evaluation, so a request delayed between authorization and mutation cannot
 * write a lease after its grant expired.
 *
 * Every matching holder is returned and persisted no later than the presented authorization expiry.
 * An expired holder is never renewed; only a fresh authorized observe can acquire again. A malformed
 * stored value denies match/refresh, is not removed by release, and blocks acquisition until its
 * existing TTL removes it.
 *
 * The product lane may ask an explicit authorized observe to hold the lease through that grant's
 * expiry instead of the short GUI TTL, because native approval of a later act can take minutes. A
 * repeat observe only extends forward to its own (newer) grant; an older delayed grant can never
 * shorten or overwrite a newer holder. A product act match reports min(stored, presented) as its
 * own command deadline but leaves the longer stored lease intact; only the fixture lane keeps the
 * old cap-and-write contract.
 *
 * Cancellation is `release` with the server-issued holder id; compare-and-delete keeps a stale stop
 * from deleting a newer holder. The `device_busy` and `target_changed` statuses are the internal
 * counterparts of the planned `DEVICE_BUSY` and `COMPUTER_TARGET_CHANGED` outcomes; no API mapping is
 * added here.
 *
 * This is not wired into routes, the runner, or native dispatch yet. It does not cancel a Mac input
 * already in flight and does not by itself release occupancy on turn end, pause, disconnect, crash, or
 * device revocation. Native dispatch must recheck or cancel immediately before touching input.
 */
export const localComputerGuiOccupancyTtlMs = 45_000;
const uuidLower = z.uuid().transform(value => value.toLowerCase());
const capabilitySchema = z.enum(["computer.observe", "computer.act"]);
const bundleIdSchema = localComputerGrantSchema.shape.target.shape.bundle_id;
const lossReasonSchema = z.enum([
  "missing",
  "expired",
  "connection",
  "scope",
  "session",
  "bundle",
  "holder",
  "malformed",
]);
const acquireResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("acquired"),
    holderId: z.uuid(),
    expiresAt: z.number().int().positive(),
    reused: z.boolean(),
  }),
  z.strictObject({ status: z.literal("device_busy") }),
  z.strictObject({ status: z.literal("target_changed") }),
  z.strictObject({ status: z.literal("not_held"), reason: lossReasonSchema }),
]);
const matchResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("held"), expiresAt: z.number().int().positive() }),
  z.strictObject({ status: z.literal("target_changed") }),
  z.strictObject({ status: z.literal("not_held"), reason: lossReasonSchema }),
]);
const refreshResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("refreshed"), expiresAt: z.number().int().positive() }),
  z.strictObject({ status: z.literal("target_changed") }),
  z.strictObject({ status: z.literal("not_held"), reason: lossReasonSchema }),
]);
const bindingSchema = z.strictObject({
  scope: desktopRunScopeSchema,
  sessionId: z.uuid(),
  bundleId: bundleIdSchema,
  selectionId: z.uuid(),
});
/** The exact stored holder; read-only callers compare it with the current selection. */
const heldSchema = z.strictObject({
  v: z.literal(1),
  holderId: z.uuid(),
  expiresAt: z.number().int().positive(),
  scope: desktopRunScopeSchema,
  sessionId: z.uuid(),
  bundleId: bundleIdSchema,
  selectionId: z.uuid(),
});
export type LocalComputerGuiHeld = z.infer<typeof heldSchema>;

export type LocalComputerGuiLossReason = z.infer<typeof lossReasonSchema>;
export type LocalComputerGuiAcquireResult = z.infer<typeof acquireResultSchema>;
export type LocalComputerGuiMatchResult = z.infer<typeof matchResultSchema>;
export type LocalComputerGuiRefreshResult = z.infer<typeof refreshResultSchema>;
type OccupancyBindingInput = {
  authorization: LocalComputerActionAuthorization;
  /** Opaque host-issued selection id; never a model/tool argument. */
  selectionId: string;
  /**
   * Product lane only: hold this authenticated observe lease through the
   * presented grant expiry (never beyond it) instead of the short GUI TTL.
   * The joined fixture keeps the existing short-lease behavior.
   */
  throughAuthorizationExpiry?: boolean;
};
type OccupancyHolderInput = OccupancyBindingInput & { holderId: string };
type OccupancyMatchInput = OccupancyHolderInput & {
  /**
   * Product lane only: report min(stored, authorized) to the caller but never
   * persist a shorter stored lease just because an older valid grant was
   * presented. The joined fixture keeps the existing cap-and-write contract.
   */
  preserveStoredExpiry?: boolean;
};
type ParsedBinding = z.infer<typeof bindingSchema>;

/** The one occupancy key per device. Exported for white-box checks only. */
export const localComputerGuiOccupancyKey = (deviceId: string) =>
  `linksense:desktop-devices:${uuidLower.parse(deviceId)}:gui-occupancy`;

const redisNow = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
`;
const decodeStoredLease = `
local ok, lease = pcall(cjson.decode, raw)
local valid = ok and type(lease) == 'table' and lease.v == 1
  and type(lease.scope) == 'table' and type(lease.expiresAt) == 'number'
  and type(lease.scope.connectionId) == 'string' and type(lease.scope.ownerId) == 'string'
  and type(lease.scope.deviceId) == 'string' and type(lease.scope.conversationId) == 'string'
  and type(lease.scope.turnId) == 'string' and type(lease.scope.runtimeGeneration) == 'string'
  and type(lease.holderId) == 'string' and type(lease.sessionId) == 'string'
  and type(lease.bundleId) == 'string' and type(lease.selectionId) == 'string'
`;
// The stored connection must still equal the current input connection. Acquisition checks the
// presence key separately and may replace a holder from a superseded connection.
const sameScope = `lease.scope.connectionId == ARGV[1]
  and lease.scope.ownerId == ARGV[2]
  and lease.scope.deviceId == ARGV[6]
  and lease.scope.conversationId == ARGV[3]
  and lease.scope.turnId == ARGV[4]
  and lease.scope.runtimeGeneration == ARGV[5]`;

const acquireScript = `
local presence = redis.call('GET', KEYS[2])
if presence ~= ARGV[1] then return cjson.encode({status='not_held', reason='connection'}) end
${redisNow}
local authExpiry = tonumber(ARGV[12])
if authExpiry <= now then return cjson.encode({status='not_held', reason='expired'}) end
local raw = redis.call('GET', KEYS[1])
if raw then
  ${decodeStoredLease}
  if not valid then
    return cjson.encode({status='device_busy'})
  elseif lease.expiresAt <= now or lease.scope.connectionId ~= presence then
    redis.call('DEL', KEYS[1])
  elseif ${sameScope} then
    if lease.sessionId == ARGV[7] and lease.bundleId == ARGV[8] and lease.selectionId == ARGV[9] then
      -- A repeat authorized observe can extend the exact live holder forward
      -- to its own newer grant, but a delayed older grant never shortens or
      -- overwrites a newer holder. The fixture lane keeps the existing
      -- cap-to-presented-authorization behavior.
      local expiresAt = lease.expiresAt
      if ARGV[14] == '1' then
        if authExpiry > expiresAt then expiresAt = authExpiry end
      elseif authExpiry < expiresAt then
        expiresAt = authExpiry
      end
      if expiresAt ~= lease.expiresAt then
        lease.expiresAt = expiresAt
        redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', math.floor(expiresAt - now))
      end
      return cjson.encode({status='acquired', holderId=lease.holderId, expiresAt=expiresAt, reused=true})
    end
    return cjson.encode({status='target_changed'})
  else
    return cjson.encode({status='device_busy'})
  end
end
local expiresAt = authExpiry
if ARGV[14] ~= '1' then expiresAt = math.min(now + tonumber(ARGV[11]), authExpiry) end
local lease = cjson.decode(ARGV[10])
lease.expiresAt = expiresAt
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', math.floor(expiresAt - now))
return cjson.encode({status='acquired', holderId=ARGV[13], expiresAt=expiresAt, reused=false})
`;

const matchOrRefreshScript = `
local presence = redis.call('GET', KEYS[2])
if presence ~= ARGV[1] then return cjson.encode({status='not_held', reason='connection'}) end
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({status='not_held', reason='missing'}) end
${decodeStoredLease}
if not valid then return cjson.encode({status='not_held', reason='malformed'}) end
${redisNow}
local authExpiry = tonumber(ARGV[11])
if lease.expiresAt <= now then
  redis.call('DEL', KEYS[1])
  return cjson.encode({status='not_held', reason='expired'})
end
if lease.holderId ~= ARGV[10] then return cjson.encode({status='not_held', reason='holder'}) end
if not (${sameScope}) then return cjson.encode({status='not_held', reason='scope'}) end
if lease.sessionId ~= ARGV[7] then return cjson.encode({status='not_held', reason='session'}) end
if lease.bundleId ~= ARGV[8] then return cjson.encode({status='not_held', reason='bundle'}) end
if lease.selectionId ~= ARGV[9] then return cjson.encode({status='target_changed'}) end
-- A delayed expired permit must not erase a holder renewed by a newer authorization. Only the
-- stored holder's own expiry above may delete it.
if authExpiry <= now then return cjson.encode({status='not_held', reason='expired'}) end
local expiresAt = lease.expiresAt
if ARGV[13] == '1' then
  local target = now + tonumber(ARGV[12])
  if target > authExpiry then target = authExpiry end
  if target > expiresAt then expiresAt = target end
end
-- The reported deadline is always bounded by the presented authorization.
local reportedExpiresAt = expiresAt
if reportedExpiresAt > authExpiry then reportedExpiresAt = authExpiry end
-- The fixture lane persists that cap. The product lane (-preserve) keeps the
-- longer lease acquired through its own grant; a later/older act permit must
-- not shorten it.
if ARGV[14] ~= '1' and expiresAt > authExpiry then expiresAt = authExpiry end
if expiresAt ~= lease.expiresAt then
  lease.expiresAt = expiresAt
  redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', math.floor(expiresAt - now))
end
if ARGV[13] == '1' then
  return cjson.encode({status='refreshed', expiresAt=reportedExpiresAt})
end
return cjson.encode({status='held', expiresAt=reportedExpiresAt})
`;

const releaseScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
${decodeStoredLease}
if not valid or lease.holderId ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

export class LocalComputerGuiOccupancy {
  constructor(private readonly redis: Pick<Redis, "eval">) {}

  /**
   * Acquires occupancy for an explicit authorized observe. The server chooses the holder id. An
   * identical call returns the same holder, capped by the presented authorization, without extending
   * it. A different run scope on the same device is `device_busy`; a different
   * selection/session/bundle for the same run is `target_changed` so the caller must release and
   * observe again.
   */
  async acquire(input: OccupancyBindingInput): Promise<LocalComputerGuiAcquireResult> {
    const binding = parseBinding(input);
    if (input.authorization.capability !== "computer.observe") throw new AppError("FORBIDDEN");
    const holderId = randomUUID();
    const template = JSON.stringify({
      v: 1,
      holderId,
      expiresAt: 0,
      scope: binding.scope,
      sessionId: binding.sessionId,
      bundleId: binding.bundleId,
      selectionId: binding.selectionId,
    });
    return this.run(acquireScript, acquireResultSchema, binding.scope, [
      binding.scope.connectionId, binding.scope.ownerId, binding.scope.conversationId,
      binding.scope.turnId, binding.scope.runtimeGeneration, binding.scope.deviceId,
      binding.sessionId, binding.bundleId, binding.selectionId,
      template, String(localComputerGuiOccupancyTtlMs), String(authorizationExpiry(input.authorization)), holderId,
      input.throughAuthorizationExpiry === true ? "1" : "0",
    ]);
  }

  /**
   * Verifies the caller still owns this exact selection without extending the
   * lease. The reported deadline never exceeds the presented authorization;
   * the product lane can opt out of persisting that shorter cap so an older
   * valid act permit does not truncate the observe-acquired lease.
   */
  async match(input: OccupancyMatchInput): Promise<LocalComputerGuiMatchResult> {
    const { binding, holderId } = parseHolderBinding(input);
    return this.run(matchOrRefreshScript, matchResultSchema, binding.scope, [
      ...this.holderArguments(binding, holderId),
      String(authorizationExpiry(input.authorization)), String(localComputerGuiOccupancyTtlMs), "0",
      input.preserveStoredExpiry === true ? "1" : "0",
    ]);
  }

  /**
   * Extends an existing holder for a heartbeat, capped by the presented authorization's expiry. A
   * missing, expired, replaced-connection, or different holder is never recreated.
   */
  async refresh(input: OccupancyHolderInput): Promise<LocalComputerGuiRefreshResult> {
    const { binding, holderId } = parseHolderBinding(input);
    return this.run(matchOrRefreshScript, refreshResultSchema, binding.scope, [
      ...this.holderArguments(binding, holderId),
      String(authorizationExpiry(input.authorization)), String(localComputerGuiOccupancyTtlMs), "1", "0",
    ]);
  }

  /** Compare-and-release: a stale holder id cannot remove a newer holder. */
  async release(deviceId: string, holderId: string): Promise<boolean> {
    const device = uuidLower.parse(deviceId);
    const holder = uuidLower.parse(holderId);
    return await this.redis.eval(releaseScript, 1, localComputerGuiOccupancyKey(device), holder) === 1;
  }

  /**
   * Reads the exact current holder without extending or deleting it. Malformed
   * state reads as absent. Callers must still compare every stored field with
   * the selected session/selection before treating it as their own input.
   */
  async read(deviceId: string): Promise<LocalComputerGuiHeld | null> {
    const raw = await this.redis.eval(
      "local raw = redis.call('GET', KEYS[1]); if not raw then return nil end; return raw",
      1, localComputerGuiOccupancyKey(uuidLower.parse(deviceId)),
    );
    if (typeof raw !== "string") return null;
    try {
      const parsed = heldSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private holderArguments(binding: ParsedBinding, holderId: string): string[] {
    const { scope } = binding;
    return [
      scope.connectionId, scope.ownerId, scope.conversationId, scope.turnId,
      scope.runtimeGeneration, scope.deviceId, binding.sessionId, binding.bundleId,
      binding.selectionId, holderId,
    ];
  }

  private async run<T>(
    script: string,
    schema: z.ZodType<T>,
    scope: DesktopRunScope,
    args: string[],
  ): Promise<T> {
    const result = await this.redis.eval(
      script, 2,
      localComputerGuiOccupancyKey(scope.deviceId),
      desktopDeviceConnectionKey(scope.deviceId),
      ...args,
    );
    if (typeof result !== "string") throw new Error("Unexpected GUI occupancy result");
    return schema.parse(JSON.parse(result));
  }
}

function parseBinding(input: OccupancyBindingInput): ParsedBinding {
  return bindingSchema.parse({
    scope: input.authorization.scope,
    sessionId: input.authorization.sessionId,
    bundleId: input.authorization.bundleId,
    selectionId: input.selectionId,
  });
}

function parseHolderBinding(input: OccupancyHolderInput): {
  binding: ParsedBinding;
  holderId: string;
} {
  capabilitySchema.parse(input.authorization.capability);
  return {
    binding: parseBinding(input),
    holderId: uuidLower.parse(input.holderId),
  };
}

function authorizationExpiry(authorization: LocalComputerActionAuthorization): number {
  if (!(authorization.expiresAt instanceof Date) || !Number.isFinite(authorization.expiresAt.getTime())) {
    throw new AppError("FORBIDDEN");
  }
  return authorization.expiresAt.getTime();
}
