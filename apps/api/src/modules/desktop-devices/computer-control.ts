import { randomUUID } from "node:crypto";
import {
  desktopComputerQuiesceLifetimeMs,
  localComputerGrantSchema,
  type ComputerExecuteInput,
  type ComputerExecuteResult,
  type DesktopComputerControl as DesktopComputerControlFrame,
  type DesktopComputerControlFailureCode,
  type DesktopComputerControlResult,
  type DesktopToolRequest,
} from "@linksense/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

import { DesktopCommandUncertainError, type DesktopDeviceTransport } from "../../adapters/desktop-device-transport.js";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import {
  desktopRunLeaseKey,
  desktopRunScopeSchema,
  type DesktopRunLeases,
  type DesktopRunScope,
} from "../desktop-credentials/run-leases.js";
import type {
  LocalComputerActionAuthorization,
  LocalComputerActionCapability,
} from "../local-computer/authorization.js";
import {
  localComputerGuiOccupancyKey,
  type LocalComputerGuiHeld,
  type LocalComputerGuiOccupancy,
} from "../local-computer/occupancy.js";
import {
  desktopComputerSelectionExpiry,
  endDesktopComputerSession,
  extendDesktopComputerSelection,
  prepareDesktopComputerSelection,
  readActiveDesktopComputerSession,
  requireRunningDesktopComputerTurn,
  withDesktopComputerLock,
  type DesktopComputerSelectionScope,
} from "../local-computer/selection.js";
import { auditLocalComputerChange, endLocalComputerSessions } from "../local-computer/repository.js";
import {
  acquireComputerExecuteFailure,
  computerExecuteFailure,
  expectComputerExecuteKind,
  sameDesktopRunScope,
  sendComputerExecute,
} from "./computer-execute.js";
import type { DesktopComputerDispatchAdmission } from "./computer-admission.js";
import { desktopDeviceConnectionKey, type DesktopExecutionBinding } from "./coordinator.js";

type ComputerExecuteToolRequest = Extract<DesktopToolRequest, { operation: "computer.execute" }>;
const idSchema = z.uuid().transform(value => value.toLowerCase());
const bundleIdSchema = localComputerGrantSchema.shape.target.shape.bundle_id;

/**
 * Short-lived product selection metadata. It contains only opaque ids, the
 * application bundle the user explicitly picked, the server expiry, and the
 * control state. It never contains titles, screenshots, input, window ids, or
 * paths. `pausing` is internal: it blocks admission while a control-only
 * quiesce is still waiting for the exact native terminal/refs-clear ack.
 */
export const desktopComputerSelectionSchema = z.strictObject({
  v: z.literal(1),
  state: z.enum(["active", "pausing", "paused", "stopped"]),
  ownerId: idSchema,
  deviceId: idSchema,
  conversationId: idSchema,
  turnId: idSchema,
  runtimeGeneration: idSchema,
  connectionId: idSchema,
  sessionId: idSchema,
  selectionId: idSchema,
  /** Changes on an explicit renewal so pre-renewal queued acts never revive. */
  controlEpoch: idSchema,
  bundleId: bundleIdSchema,
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  /**
   * Durable proof that one act may have reached the native executor under the
   * exact occupancy holder. It is written atomically with the live holder
   * immediately before the one socket send and removed only by a terminal act
   * result or the exact quiesce ack. Missing selection metadata therefore
   * never proves that no input was admitted; the marker survives the 45s
   * occupancy TTL for the lifetime of the selection key.
   */
  pendingInput: z.strictObject({
    holderId: idSchema,
    controlEpoch: idSchema,
    admittedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    /** Exact generated transport command UUID; only its own result/quiesce clears it. */
    commandId: idSchema,
  }).nullable(),
});
export type DesktopComputerSelection = z.infer<typeof desktopComputerSelectionSchema>;

type SelectionKeyScope = Pick<
  DesktopRunScope, "ownerId" | "deviceId" | "conversationId" | "turnId" | "runtimeGeneration"
>;
/** One selection per run; the connection is stored and compared, not part of the key. */
export const desktopComputerSelectionKey = (scope: SelectionKeyScope): string =>
  `linksense:desktop-computer:selection:${sha256([
    scope.ownerId, scope.deviceId, scope.conversationId, scope.turnId, scope.runtimeGeneration,
  ].join(":"))}`;
/** Bounded durable lookup for turn-terminal cleanup across replicas. */
const desktopComputerTurnIndexKey = (turnId: string): string =>
  `linksense:desktop-computer:turn:${idSchema.parse(turnId)}`;
/** Bounded durable lookup for connection-replacement cleanup across replicas. */
const desktopComputerDeviceIndexKey = (deviceId: string): string =>
  `linksense:desktop-computer:device:${idSchema.parse(deviceId)}`;
const maxIndexedScopes = 64;

function keyScopeMatches(selection: DesktopComputerSelection, scope: SelectionKeyScope): boolean {
  return selection.ownerId === scope.ownerId && selection.deviceId === scope.deviceId &&
    selection.conversationId === scope.conversationId && selection.turnId === scope.turnId &&
    selection.runtimeGeneration === scope.runtimeGeneration;
}

function selectionMatchesScope(selection: DesktopComputerSelection, scope: DesktopRunScope): boolean {
  return keyScopeMatches(selection, scope) && selection.connectionId === scope.connectionId;
}

function matchesHeld(held: LocalComputerGuiHeld, scope: DesktopRunScope, selection: DesktopComputerSelection): boolean {
  return held.scope.ownerId === scope.ownerId && held.scope.deviceId === scope.deviceId &&
    held.scope.connectionId === scope.connectionId && held.scope.conversationId === scope.conversationId &&
    held.scope.turnId === scope.turnId && held.scope.runtimeGeneration === scope.runtimeGeneration &&
    held.sessionId === selection.sessionId && held.selectionId === selection.selectionId &&
    held.bundleId === selection.bundleId;
}

export class DesktopComputerSelectionError extends Error {
  constructor(readonly code: DesktopComputerControlFailureCode) {
    super(code);
    this.name = "DesktopComputerSelectionError";
  }
}

const unavailable = () => new DesktopComputerSelectionError("COMPUTER_UNAVAILABLE");
const accessDenied = () => new DesktopComputerSelectionError("COMPUTER_ACCESS_DENIED");
const targetChanged = () => new DesktopComputerSelectionError("COMPUTER_TARGET_CHANGED");
const timedOut = () => new DesktopComputerSelectionError("COMPUTER_TIMEOUT");

const luaSelectionHelpers = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local function decode(raw)
  if not raw then return nil end
  local ok, lease = pcall(cjson.decode, raw)
  if not ok or type(lease) ~= 'table' or lease.v ~= 1 then return nil end
  if type(lease.state) ~= 'string' or type(lease.expiresAt) ~= 'number' then return nil end
  if type(lease.ownerId) ~= 'string' or type(lease.deviceId) ~= 'string'
    or type(lease.conversationId) ~= 'string' or type(lease.turnId) ~= 'string'
    or type(lease.runtimeGeneration) ~= 'string' or type(lease.connectionId) ~= 'string'
    or type(lease.sessionId) ~= 'string' or type(lease.selectionId) ~= 'string'
    or type(lease.controlEpoch) ~= 'string' or type(lease.bundleId) ~= 'string' then return nil end
  if lease.pendingInput ~= nil and lease.pendingInput ~= cjson.null then
    if type(lease.pendingInput) ~= 'table' or type(lease.pendingInput.holderId) ~= 'string'
      or type(lease.pendingInput.controlEpoch) ~= 'string'
      or type(lease.pendingInput.commandId) ~= 'string'
      or type(lease.pendingInput.admittedAt) ~= 'number' then return nil end
  end
  return lease
end
-- The canonical run lease is the durable exact binding. A missing, malformed,
-- expired, or 'revoked' value, or any differing owner/device/connection/
-- conversation/generation/turn, is not a live binding. The database credential
-- and materialized turn are proven separately under the conversation lock.
local function exactRunBinding(raw, at)
  if not raw then return false end
  local ok, run = pcall(cjson.decode, raw)
  if not ok or type(run) ~= 'table' or type(run.scope) ~= 'table' or type(run.expiresAt) ~= 'number' then
    return false
  end
  if run.expiresAt <= now then return false end
  local scope = run.scope
  return scope.ownerId == ARGV[at] and scope.deviceId == ARGV[at + 1]
    and scope.connectionId == ARGV[at + 2] and scope.conversationId == ARGV[at + 3]
    and scope.turnId == ARGV[at + 4] and scope.runtimeGeneration == ARGV[at + 5]
end
-- Bounded durable indexes are written atomically with the selection so
-- turn-terminal and connection-replacement cleanup does not depend on the
-- process-local tracked map.
local function writeIndex(indexRaw, ttl, maxIndex)
  if type(indexRaw) ~= 'string' or indexRaw == '' or ttl <= 0 then return end
  redis.call('SET', KEYS[4], indexRaw, 'PX', ttl)
  redis.call('ZADD', KEYS[5], now, indexRaw)
  redis.call('ZREMRANGEBYRANK', KEYS[5], 0, -((tonumber(maxIndex) or 64) + 1))
  redis.call('PEXPIRE', KEYS[5], ttl)
end
`;
const presenceCheck = `
local presence = redis.call('GET', KEYS[2])
if presence ~= ARGV[1] then return cjson.encode({status='unavailable'}) end
`;

const selectScript = `
${luaSelectionHelpers}
${presenceCheck}
local nextOk, nextLease = pcall(cjson.decode, ARGV[2])
if not nextOk or type(nextLease) ~= 'table' or nextLease.v ~= 1 or type(nextLease.expiresAt) ~= 'number' then
  return cjson.encode({status='unavailable'})
end
if nextLease.expiresAt <= now then return cjson.encode({status='timeout'}) end
-- Select and resume carry no run bearer, so the exact canonical run lease is
-- rechecked inside the same CAS that writes selection metadata. A pending
-- transaction can never resurrect a revoked or rebound run.
if not exactRunBinding(redis.call('GET', KEYS[3]), 6) then return cjson.encode({status='unavailable'}) end
local raw = redis.call('GET', KEYS[1])
if raw then
  local lease = decode(raw)
  if not lease then return cjson.encode({status='unavailable'}) end
  -- Same-id, same-session continuation is an explicit renewal through the
  -- dedicated exact-previous-version CAS. The first-select lane must never
  -- renew implicitly, not even when the stored window has already expired
  -- at Redis TIME: falling through to the SET below would rewrite metadata
  -- that the locked renewal was authorized against.
  if lease.selectionId == nextLease.selectionId and lease.sessionId == nextLease.sessionId then
    return cjson.encode({status='conflict'})
  end
  if lease.expiresAt > now and lease.connectionId == presence then
    if lease.state == 'pausing' or lease.state == 'paused' then
      return cjson.encode({status='conflict'})
    elseif lease.state == 'active' then
      if lease.selectionId ~= nextLease.selectionId or lease.bundleId ~= nextLease.bundleId then
        return cjson.encode({status='conflict'})
      end
      -- A still-live active selection that may have admitted input cannot be
      -- replaced in this CAS: the pending proof belongs to the current
      -- session/epoch, and writing a new epoch would make its exact
      -- terminal/quiesce clear impossible. Pause and stop remain available.
      if lease.pendingInput ~= nil and lease.pendingInput ~= cjson.null then
        return cjson.encode({status='conflict'})
      end
      local ended = ',' .. ARGV[4] .. ','
      if not string.find(ended, ',' .. lease.sessionId .. ',', 1, true) then
        return cjson.encode({status='conflict'})
      end
    elseif lease.state ~= 'stopped' then
      return cjson.encode({status='unavailable'})
    end
  end
end
local ttl = math.floor(nextLease.expiresAt + tonumber(ARGV[5]) - now)
if ttl <= 0 then return cjson.encode({status='timeout'}) end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl)
writeIndex(ARGV[12], ttl, ARGV[13])
return cjson.encode({status='ok', lease=nextLease})
`;

/**
 * The only same-id continuation. Unlike first select, every field is pinned
 * to the exact previous version the caller verified under the PostgreSQL
 * lock: scope and connection from the key/args, session, selection, bundle,
 * connection, control epoch, and expiry from the snapshot. A missing,
 * expired, or concurrently replaced previous lease is refused before any
 * write, so it can never fall through to a fresh SET. The caller's locked
 * transaction then rolls back its session/grant extension.
 *
 * ARGV: 1 connection, 2 next lease, 3 quiesce lifetime, 4..9 scope,
 * 10 scope JSON, 11 max index, 12..17 previous session/selection/bundle/
 * connection/control epoch/expiry.
 */
const renewScript = `
${luaSelectionHelpers}
${presenceCheck}
local nextOk, nextLease = pcall(cjson.decode, ARGV[2])
if not nextOk or type(nextLease) ~= 'table' or nextLease.v ~= 1 or type(nextLease.expiresAt) ~= 'number' then
  return cjson.encode({status='unavailable'})
end
if nextLease.expiresAt <= now then return cjson.encode({status='timeout'}) end
-- Select and resume carry no run bearer, so the exact canonical run lease is
-- rechecked inside the same CAS that writes selection metadata.
if not exactRunBinding(redis.call('GET', KEYS[3]), 4) then return cjson.encode({status='unavailable'}) end
local raw = redis.call('GET', KEYS[1])
-- A missing previous lease is not a first select: this renewal was
-- authorized against an exact snapshot, so it must not create fresh metadata.
if not raw then return cjson.encode({status='timeout'}) end
local lease = decode(raw)
if not lease then return cjson.encode({status='unavailable'}) end
-- The stored value must still be the same scope/binding, not a replacement
-- that landed between the locked read and this CAS.
if lease.ownerId ~= ARGV[4] or lease.deviceId ~= ARGV[5]
  or lease.connectionId ~= ARGV[6] or lease.conversationId ~= ARGV[7]
  or lease.turnId ~= ARGV[8] or lease.runtimeGeneration ~= ARGV[9] then
  return cjson.encode({status='unavailable'})
end
-- An expired previous window is the same legitimate non-success as an outer
-- expired read: write nothing and let the caller report a timeout.
if lease.expiresAt <= now then return cjson.encode({status='timeout'}) end
-- A renewal may only continue an active, exactly idle selection. A possible
-- admitted act belongs to this epoch and would become unprovable under a new
-- one; pause/stop remain available for that case.
if lease.state ~= 'active' then return cjson.encode({status='conflict'}) end
if lease.sessionId ~= ARGV[12] or lease.selectionId ~= ARGV[13]
  or lease.bundleId ~= ARGV[14] or lease.connectionId ~= ARGV[15]
  or lease.controlEpoch ~= ARGV[16]
  or tonumber(ARGV[17]) == nil or lease.expiresAt ~= tonumber(ARGV[17]) then
  return cjson.encode({status='conflict'})
end
-- The candidate may only advance this exact binding, never switch session,
-- selection, bundle, or connection under the name of a renewal.
if nextLease.sessionId ~= lease.sessionId or nextLease.selectionId ~= lease.selectionId
  or nextLease.bundleId ~= lease.bundleId or nextLease.connectionId ~= lease.connectionId then
  return cjson.encode({status='conflict'})
end
if lease.pendingInput ~= cjson.null then return cjson.encode({status='conflict'}) end
-- An equal (or backward) expiry, even with a changed epoch, is a legitimate
-- non-success: leave the live epoch, expiry, grants, and holder untouched.
if nextLease.expiresAt <= lease.expiresAt then return cjson.encode({status='timeout'}) end
local renewedTtl = math.floor(nextLease.expiresAt + tonumber(ARGV[3]) - now)
if renewedTtl <= 0 then return cjson.encode({status='timeout'}) end
-- The live marker was proven idle above; write a known-idle marker instead of
-- the possibly stale outer value.
nextLease.pendingInput = cjson.null
redis.call('SET', KEYS[1], cjson.encode(nextLease), 'PX', renewedTtl)
writeIndex(ARGV[10], renewedTtl, ARGV[11])
return cjson.encode({status='ok', lease=nextLease})
`;

const pauseScript = `
${luaSelectionHelpers}
${presenceCheck}
local raw = redis.call('GET', KEYS[1])
local lease = decode(raw)
if not lease then return cjson.encode({status='unavailable'}) end
if lease.connectionId ~= presence then return cjson.encode({status='unavailable'}) end
if lease.selectionId ~= ARGV[2] then return cjson.encode({status='conflict'}) end
if lease.state == 'paused' or lease.state == 'pausing' then
  return cjson.encode({status='ok', lease=lease})
end
if lease.state ~= 'active' then return cjson.encode({status='unavailable'}) end
if lease.expiresAt <= now then return cjson.encode({status='timeout'}) end
lease.state = 'pausing'
local ttl = math.floor(lease.expiresAt + tonumber(ARGV[3]) - now)
if ttl <= 0 then return cjson.encode({status='timeout'}) end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
return cjson.encode({status='ok', lease=lease})
`;

const confirmPauseScript = `
${luaSelectionHelpers}
${presenceCheck}
local raw = redis.call('GET', KEYS[1])
local lease = decode(raw)
if not lease then return cjson.encode({status='unavailable'}) end
if lease.connectionId ~= presence then return cjson.encode({status='unavailable'}) end
if lease.selectionId ~= ARGV[2] or lease.sessionId ~= ARGV[3] then return cjson.encode({status='conflict'}) end
if lease.state == 'paused' then return cjson.encode({status='ok', lease=lease}) end
if lease.state ~= 'pausing' then return cjson.encode({status='conflict'}) end
lease.state = 'paused'
local ttl = math.floor(lease.expiresAt + tonumber(ARGV[4]) - now)
if ttl <= 0 then ttl = tonumber(ARGV[4]) end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
return cjson.encode({status='ok', lease=lease})
`;

const resumeScript = `
${luaSelectionHelpers}
${presenceCheck}
if ARGV[2] == ARGV[3] then return cjson.encode({status='conflict'}) end
-- Same tokenless exact run binding as select; an in-flight select/resume
-- transaction cannot revive a revoked or rebound run.
if not exactRunBinding(redis.call('GET', KEYS[3]), 5) then return cjson.encode({status='unavailable'}) end
local raw = redis.call('GET', KEYS[1])
local lease = decode(raw)
if not lease then return cjson.encode({status='unavailable'}) end
if lease.connectionId ~= presence then return cjson.encode({status='unavailable'}) end
if lease.state == 'active' and lease.selectionId == ARGV[3] then
  if lease.expiresAt <= now then return cjson.encode({status='timeout'}) end
  return cjson.encode({status='ok', lease=lease})
end
if lease.state ~= 'paused' or lease.selectionId ~= ARGV[2] then
  return cjson.encode({status='conflict'})
end
if lease.expiresAt <= now then return cjson.encode({status='timeout'}) end
lease.selectionId = ARGV[3]
lease.state = 'active'
local ttl = math.floor(lease.expiresAt + tonumber(ARGV[4]) - now)
if ttl <= 0 then return cjson.encode({status='timeout'}) end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
writeIndex(ARGV[11], ttl, ARGV[12])
return cjson.encode({status='ok', lease=lease})
`;

const stopScript = `
${luaSelectionHelpers}
${presenceCheck}
local raw = redis.call('GET', KEYS[1])
local lease = decode(raw)
if not lease then return cjson.encode({status='unavailable'}) end
if lease.connectionId ~= presence then return cjson.encode({status='unavailable'}) end
if lease.selectionId ~= ARGV[2] then return cjson.encode({status='conflict'}) end
if lease.state == 'stopped' then return cjson.encode({status='ok', lease=lease}) end
lease.state = 'stopped'
local ttl = math.floor(lease.expiresAt + tonumber(ARGV[3]) - now)
if ttl <= 0 then ttl = tonumber(ARGV[3]) end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
return cjson.encode({status='ok', lease=lease})
`;

const clearScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, lease = pcall(cjson.decode, raw)
if not ok or type(lease) ~= 'table' or lease.v ~= 1 then return 0 end
-- Exact six-field CAS. A same-id renewal keeps selection and connection but
-- changes session/epoch/expiry; delayed cleanup from the old generation must
-- not delete the newer binding (nor release its reused holder).
if lease.selectionId ~= ARGV[1] or lease.connectionId ~= ARGV[2]
  or lease.sessionId ~= ARGV[3] or lease.controlEpoch ~= ARGV[4]
  or tonumber(ARGV[5]) == nil or lease.expiresAt ~= tonumber(ARGV[5]) then return 0 end
-- Lifecycle cleanup may clear only a selection whose live pending marker is
-- the explicit known-idle null. A possible act is not over just because the
-- connection/run was fenced: an object names unproven input and an absent
-- field (legacy) cannot prove that none was admitted. Both retain the
-- selection and holder for the exact terminal/quiesce or bounded expiry.
if lease.pendingInput ~= cjson.null then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
if type(ARGV[6]) == 'string' and ARGV[6] ~= '' then redis.call('ZREM', KEYS[3], ARGV[6]) end
return 1
`;

/**
 * Atomically records that one act may have reached the native executor.
 *
 * The write requires the exact live selection state, session, control epoch,
 * connection presence, and current occupancy holder, all evaluated in one Lua
 * script using Redis TIME. A revoked/replaced selection or a superseded holder
 * therefore cannot leave a misleading pending marker. The marker records the
 * exact generated transport command UUID so only that command's terminal or
 * provably-unsent outcome can clear it.
 */
const claimInputScript = `
${luaSelectionHelpers}
local presence = redis.call('GET', KEYS[3])
if presence ~= ARGV[1] then return cjson.encode({status='unavailable'}) end
local lease = decode(redis.call('GET', KEYS[1]))
if not lease then return cjson.encode({status='unavailable'}) end
if lease.connectionId ~= presence then return cjson.encode({status='unavailable'}) end
if lease.selectionId ~= ARGV[2] or lease.sessionId ~= ARGV[3] or lease.controlEpoch ~= ARGV[4] then
  return cjson.encode({status='conflict'})
end
if lease.state ~= 'active' then return cjson.encode({status='conflict'}) end
if lease.expiresAt <= now then return cjson.encode({status='timeout'}) end
-- A legacy selection without the field cannot prove whether input was ever
-- admitted; only an explicit null (known idle) or an object is acceptable.
if lease.pendingInput == nil then return cjson.encode({status='unavailable'}) end
local occOk, occupancy = pcall(cjson.decode, redis.call('GET', KEYS[2]) or '')
if not occOk or type(occupancy) ~= 'table' or occupancy.v ~= 1 then
  return cjson.encode({status='unavailable'})
end
if occupancy.holderId ~= ARGV[5] or occupancy.selectionId ~= ARGV[2]
  or occupancy.sessionId ~= ARGV[3] then return cjson.encode({status='conflict'}) end
if type(occupancy.expiresAt) ~= 'number' or occupancy.expiresAt <= now then
  return cjson.encode({status='unavailable'})
end
local scope = occupancy.scope
if type(scope) ~= 'table' or scope.ownerId ~= ARGV[6] or scope.deviceId ~= ARGV[7]
  or scope.connectionId ~= ARGV[8] or scope.conversationId ~= ARGV[9]
  or scope.turnId ~= ARGV[10] or scope.runtimeGeneration ~= ARGV[11] then
  return cjson.encode({status='unavailable'})
end
if lease.pendingInput ~= nil and lease.pendingInput ~= cjson.null then
  return cjson.encode({status='conflict'})
end
lease.pendingInput = {
  holderId=ARGV[5], controlEpoch=ARGV[4], admittedAt=now, commandId=ARGV[13],
}
local ttl = math.floor(lease.expiresAt + tonumber(ARGV[12]) - now)
if ttl <= 0 then return cjson.encode({status='timeout'}) end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
return cjson.encode({status='ok', lease=lease})
`;

const clearInputScript = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, lease = pcall(cjson.decode, raw)
if not ok or type(lease) ~= 'table' or lease.v ~= 1 then return 0 end
-- Exact run/connection/selection/epoch plus the exact generated command UUID.
-- A late result, a rejected second command, or a newer pending marker can
-- never clear another command's admission proof.
if lease.selectionId ~= ARGV[1] or lease.sessionId ~= ARGV[2]
  or lease.controlEpoch ~= ARGV[3] or lease.connectionId ~= ARGV[4] then return 0 end
local pending = lease.pendingInput
if type(pending) ~= 'table' or pending.holderId ~= ARGV[5]
  or pending.commandId ~= ARGV[6] or pending.controlEpoch ~= ARGV[3] then return 0 end
lease.pendingInput = cjson.null
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
redis.call('SET', KEYS[1], cjson.encode(lease), 'PX', ttl)
return 1
`;

// One read-only evaluation for the final positive active acknowledgement. The
// canonical run binding, the current device presence, and the exact live
// active selection are proven from the same Redis snapshot and Redis TIME.
// Separate reads could each pass immediately before a connection replacement,
// letting the old connection receive an ack for a selection that is no longer
// current.
const verifyActiveFinalScript = `
${luaSelectionHelpers}
${presenceCheck}
if not exactRunBinding(redis.call('GET', KEYS[3]), 7) then return 0 end
local lease = decode(redis.call('GET', KEYS[1]))
if not lease then return 0 end
if lease.state ~= 'active' or lease.expiresAt <= now then return 0 end
if lease.connectionId ~= presence or lease.selectionId ~= ARGV[2]
  or lease.sessionId ~= ARGV[3] or lease.controlEpoch ~= ARGV[4]
  or lease.bundleId ~= ARGV[5] or lease.expiresAt ~= tonumber(ARGV[6]) then return 0 end
return 1
`;

const transitionResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("ok"), lease: desktopComputerSelectionSchema }),
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({ status: z.literal("conflict") }),
  z.strictObject({ status: z.literal("timeout") }),
]);

/**
 * Redis-side selection metadata. Every mutation compares the live connection
 * key inside one Lua evaluation using Redis TIME; a stale connection can never
 * write, pause, resume, stop, or clear a newer holder's selection. Select and
 * resume additionally compare the exact canonical run lease in the same
 * evaluation, so a pending transaction cannot restore a revoked or rebound
 * run. The bounded turn/device indexes are written in that same evaluation.
 */
export class DesktopComputerRedisSelection {
  constructor(private readonly redis: Pick<Redis, "eval" | "get">) {}

  async read(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    const raw = await this.redis.get(desktopComputerSelectionKey(scope));
    return parseSelection(raw, scope);
  }

  /** Reads by the key scope only; lifecycle cleanup compares the stored connection itself. */
  async readKeyScope(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    const raw = await this.redis.get(desktopComputerSelectionKey(scope));
    return parseSelectionByKey(raw, scope);
  }

  async select(
    scope: DesktopRunScope,
    lease: DesktopComputerSelection,
    endedSessionIds: readonly string[],
  ): Promise<DesktopComputerSelection> {
    const result = await this.run(selectScript, scope, [
      scope.connectionId, JSON.stringify(lease), String(lease.expiresAt),
      endedSessionIds.join(","), String(desktopComputerQuiesceLifetimeMs),
      ...scopeArguments(scope), JSON.stringify(scope), String(maxIndexedScopes),
    ]);
    return transition(result);
  }

  /**
   * Explicit same-id renewal. `previous` is the exact live version the caller
   * verified under the database lock; the Lua CAS refuses before any write
   * when it is missing, expired, replaced, non-active, or not idle. It never
   * falls through to a first-select SET.
   */
  renew(
    scope: DesktopRunScope,
    lease: DesktopComputerSelection,
    previous: DesktopComputerSelection,
  ): Promise<DesktopComputerSelection> {
    return this.run(renewScript, scope, [
      scope.connectionId, JSON.stringify(lease), String(desktopComputerQuiesceLifetimeMs),
      ...scopeArguments(scope), JSON.stringify(scope), String(maxIndexedScopes),
      idSchema.parse(previous.sessionId), idSchema.parse(previous.selectionId),
      bundleIdSchema.parse(previous.bundleId), idSchema.parse(previous.connectionId),
      idSchema.parse(previous.controlEpoch), String(previous.expiresAt),
    ]).then(transition);
  }

  pause(scope: DesktopRunScope, selectionId: string): Promise<DesktopComputerSelection> {
    return this.run(pauseScript, scope, [
      scope.connectionId, idSchema.parse(selectionId), String(desktopComputerQuiesceLifetimeMs),
    ]).then(transition);
  }

  confirmPause(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<DesktopComputerSelection> {
    return this.run(confirmPauseScript, scope, [
      scope.connectionId, selection.selectionId, selection.sessionId, String(desktopComputerQuiesceLifetimeMs),
    ]).then(transition);
  }

  resume(scope: DesktopRunScope, selectionId: string, newSelectionId: string): Promise<DesktopComputerSelection> {
    return this.run(resumeScript, scope, [
      scope.connectionId, idSchema.parse(selectionId), idSchema.parse(newSelectionId),
      String(desktopComputerQuiesceLifetimeMs),
      ...scopeArguments(scope), JSON.stringify(scope), String(maxIndexedScopes),
    ]).then(transition);
  }

  stop(scope: DesktopRunScope, selectionId: string): Promise<DesktopComputerSelection> {
    return this.run(stopScript, scope, [
      scope.connectionId, idSchema.parse(selectionId), String(desktopComputerQuiesceLifetimeMs),
    ]).then(transition);
  }

  /**
   * Exact six-field compare-delete for lifecycle cleanup. It refuses unless
   * the live pending marker is the explicit known-idle null, so an admitted or
   * unprovable (legacy) act retains the selection and holder.
   */
  async clear(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<boolean> {
    return await this.redis.eval(
      clearScript, 3,
      desktopComputerSelectionKey(scope),
      desktopComputerTurnIndexKey(scope.turnId),
      desktopComputerDeviceIndexKey(scope.deviceId),
      idSchema.parse(selection.selectionId), idSchema.parse(selection.connectionId),
      idSchema.parse(selection.sessionId), idSchema.parse(selection.controlEpoch),
      String(selection.expiresAt), JSON.stringify(scope),
    ) === 1;
  }

  /** Exact-holder pending marker for one generated command; false means no send may be attempted. */
  async claimInput(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
    commandId: string,
  ): Promise<boolean> {
    const result = await this.redis.eval(
      claimInputScript, 3,
      desktopComputerSelectionKey(scope),
      localComputerGuiOccupancyKey(scope.deviceId),
      desktopDeviceConnectionKey(scope.deviceId),
      scope.connectionId, selection.selectionId, selection.sessionId, selection.controlEpoch,
      idSchema.parse(holderId), ...scopeArguments(scope), String(desktopComputerQuiesceLifetimeMs),
      idSchema.parse(commandId),
    );
    if (typeof result !== "string") throw unavailable();
    try {
      return transitionResultSchema.parse(JSON.parse(result)).status === "ok";
    } catch {
      throw unavailable();
    }
  }

  /** Clears the pending marker only for the exact selection/epoch and generated command. */
  async clearInput(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
    commandId: string,
  ): Promise<boolean> {
    return await this.redis.eval(
      clearInputScript, 1, desktopComputerSelectionKey(scope),
      idSchema.parse(selection.selectionId), idSchema.parse(selection.sessionId),
      idSchema.parse(selection.controlEpoch), idSchema.parse(selection.connectionId),
      idSchema.parse(holderId), idSchema.parse(commandId),
    ) === 1;
  }

  /**
   * Final read-only authority check for one positive active acknowledgement.
   * A single Lua evaluation proves the exact canonical run lease, the current
   * device presence, and the exact live active selection (session, selection,
   * control epoch, bundle and persisted expiry) from one Redis snapshot using
   * Redis TIME. Split reads could each succeed around a replacement. This is
   * not a claim of atomicity with PostgreSQL; the caller still holds the
   * conversation lock and performs the last synchronous expiry check.
   */
  async verifyActiveFinal(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
  ): Promise<boolean> {
    return await this.redis.eval(
      verifyActiveFinalScript, 3,
      desktopComputerSelectionKey(scope),
      desktopDeviceConnectionKey(scope.deviceId),
      desktopRunLeaseKey(scope.turnId),
      scope.connectionId, idSchema.parse(selection.selectionId), idSchema.parse(selection.sessionId),
      idSchema.parse(selection.controlEpoch), bundleIdSchema.parse(selection.bundleId),
      String(selection.expiresAt), ...scopeArguments(scope),
    ) === 1;
  }

  /** Durable turn scope lookup for terminal/run-revoked cleanup across replicas. */
  async scopesForTurn(turnId: string): Promise<DesktopRunScope[]> {
    const raw = await this.redis.get(desktopComputerTurnIndexKey(turnId));
    if (!raw) return [];
    const parsed = desktopRunScopeSchema.safeParse(safeJson(raw));
    return parsed.success && parsed.data.turnId === idSchema.parse(turnId) ? [parsed.data] : [];
  }

  /** Durable device scope lookup for exact-connection disconnect cleanup. */
  async scopesForDevice(deviceId: string): Promise<DesktopRunScope[]> {
    const raw = await this.redis.eval(
      "return redis.call('ZRANGE', KEYS[1], 0, -1)", 1, desktopComputerDeviceIndexKey(deviceId),
    );
    if (!Array.isArray(raw)) return [];
    const scopes = new Map<string, DesktopRunScope>();
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const parsed = desktopRunScopeSchema.safeParse(safeJson(value));
      if (parsed.success && parsed.data.deviceId === idSchema.parse(deviceId)) {
        scopes.set(desktopComputerSelectionKey(parsed.data), parsed.data);
      }
    }
    return [...scopes.values()];
  }

  private async run(script: string, scope: DesktopRunScope, args: string[]): Promise<z.infer<typeof transitionResultSchema>> {
    const result = await this.redis.eval(
      script, 5,
      desktopComputerSelectionKey(scope),
      desktopDeviceConnectionKey(scope.deviceId),
      desktopRunLeaseKey(scope.turnId),
      desktopComputerTurnIndexKey(scope.turnId),
      desktopComputerDeviceIndexKey(scope.deviceId),
      ...args,
    );
    if (typeof result !== "string") throw unavailable();
    try {
      return transitionResultSchema.parse(JSON.parse(result));
    } catch {
      throw unavailable();
    }
  }
}

function scopeArguments(scope: DesktopRunScope): string[] {
  return [
    scope.ownerId, scope.deviceId, scope.connectionId, scope.conversationId,
    scope.turnId, scope.runtimeGeneration,
  ];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseSelection(raw: string | null, scope: DesktopRunScope): DesktopComputerSelection | null {
  if (!raw) return null;
  try {
    const parsed = desktopComputerSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success && selectionMatchesScope(parsed.data, scope) ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseSelectionByKey(raw: string | null, scope: DesktopRunScope): DesktopComputerSelection | null {
  if (!raw) return null;
  try {
    const parsed = desktopComputerSelectionSchema.safeParse(JSON.parse(raw));
    return parsed.success && keyScopeMatches(parsed.data, scope) ? parsed.data : null;
  } catch {
    return null;
  }
}

function transition(result: z.infer<typeof transitionResultSchema>): DesktopComputerSelection {
  if (result.status === "ok") return result.lease;
  if (result.status === "conflict") throw targetChanged();
  if (result.status === "timeout") throw timedOut();
  throw unavailable();
}

/**
 * The DB + Redis authority used by one control transition. The production
 * implementation performs the Redis compare-and-set while holding the same
 * conversation/device/account lock that guards sessions and grants, so a
 * conflict rolls the transaction back and a committed transition is ordered
 * before any later control request.
 */
export interface DesktopComputerControlStore {
  resolve(input: DesktopComputerSelectionScope): Promise<{ runtimeGeneration: string } | null>;
  read(scope: DesktopRunScope): Promise<DesktopComputerSelection | null>;
  /** Reads by the canonical key scope; the caller compares the stored connection itself. */
  readKeyScope(scope: DesktopRunScope): Promise<DesktopComputerSelection | null>;
  select(input: { scope: DesktopRunScope; selectionId: string; bundleId: string }): Promise<DesktopComputerSelection>;
  pause(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection>;
  confirmPause(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<DesktopComputerSelection>;
  resume(input: { scope: DesktopRunScope; selectionId: string; newSelectionId: string }): Promise<DesktopComputerSelection>;
  stop(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection>;
  /** Exact six-field compare-delete; only when the live pending marker is known idle. */
  clear(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<boolean>;
  /** Tokenless exact canonical run lease, live and non-revoked. */
  bindingLive(scope: DesktopRunScope): Promise<boolean>;
  /**
   * Final positive active acknowledgement check. It runs under the same
   * conversation/device/account lock as select/resume, re-reads the exact
   * selection/epoch/expiry and requires the materialized running turn plus
   * both live application grants. `finalize` is the tiny synchronous reply
   * continuation; it must not await native work or quiescence.
   */
  finalizeActive(input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    verify: () => Promise<boolean>;
    finalize: () => boolean;
  }): Promise<boolean>;
  /** Records that one act may have been sent under this exact holder/selection/command. */
  claimInput(input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    holderId: string;
    commandId: string;
  }): Promise<boolean>;
  /** Clears the pending marker only for the exact selection/epoch and generated command. */
  clearInput(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
    commandId: string,
  ): Promise<boolean>;
  /** Bounded durable turn/device indexes for cross-replica lifecycle cleanup. */
  scopesForTurn(turnId: string): Promise<DesktopRunScope[]>;
  scopesForDevice(deviceId: string): Promise<DesktopRunScope[]>;
  /**
   * One authoritative generation cleanup. Under the renewal lock, an exact
   * six-field CAS must clear this selection before its holder is released or
   * its session/grants are ended; stale metadata leaves the newer generation
   * untouched.
   */
  discard(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<void>;
}

export class PrismaDesktopComputerControl implements DesktopComputerControlStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly selections: DesktopComputerRedisSelection,
    private readonly leases: Pick<DesktopRunLeases, "hasActiveBinding">,
    private readonly occupancy?: Pick<LocalComputerGuiOccupancy, "read" | "release">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(input: DesktopComputerSelectionScope): Promise<{ runtimeGeneration: string } | null> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: input.conversationId, ownerId: input.ownerId,
        executionTarget: "local", archiveStatus: "active",
      },
      select: { desktopDeviceId: true, runtimeGeneration: true },
    });
    if (!conversation?.desktopDeviceId || conversation.desktopDeviceId !== input.deviceId) return null;
    return { runtimeGeneration: conversation.runtimeGeneration };
  }

  read(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    return this.selections.read(scope);
  }

  readKeyScope(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    return this.selections.readKeyScope(scope);
  }

  clear(scope: DesktopRunScope, selection: DesktopComputerSelection): Promise<boolean> {
    return this.selections.clear(scope, selection);
  }

  bindingLive(scope: DesktopRunScope): Promise<boolean> {
    return this.leases.hasActiveBinding(scope);
  }

  /**
   * Final positive active acknowledgement under the same locked authority that
   * guards public stop and grant revocation. Everything is read again: the
   * materialized running turn, the exact session, both unrevoked/unexpired
   * grants, and the whole final Redis authority. The run lease, device
   * presence, and exact active selection (including bundle, expiry and control
   * epoch) come from one Redis evaluation, so a replacement cannot slip
   * between separate reads and let the old connection receive an ack. Only
   * then does the tiny synchronous reply continuation run, still inside the
   * transaction, so a public stop or grant revoke that commits first is
   * observed before any positive ack. The lock is never held across native
   * work or quiesce. PostgreSQL and Redis are not one global transaction: the
   * atomic Redis read, the post-credential ordering, and the final synchronous
   * expiry check are the latest practical gates before the one reply, not a
   * claim of cross-store atomicity.
   */
  async finalizeActive(input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    verify: () => Promise<boolean>;
    finalize: () => boolean;
  }): Promise<boolean> {
    return withDesktopComputerLock(this.prisma, input.scope, async (tx, locked) => {
      // The locked database authority proves the materialized running turn and
      // both live application grants for the exact prepared session.
      await requireRunningDesktopComputerTurn(tx, locked, input.scope.turnId);
      const session = await readActiveDesktopComputerSession(tx, locked, {
        sessionId: input.selection.sessionId, bundleId: input.selection.bundleId,
        requireGrants: true, now: this.now(),
      });
      if (session.expiresAt.getTime() !== input.selection.expiresAt) return false;
      // The awaited credential/presence gate can take arbitrarily long (the
      // caller may wait on external state), so the Redis authority is read
      // again after it rather than before it.
      if (!await input.verify()) return false;
      // Exact run lease, current presence, and the exact live active selection
      // are one Redis snapshot; a replacement after any earlier read is seen
      // before the positive ack.
      if (!await this.selections.verifyActiveFinal(input.scope, input.selection)) return false;
      // Only synchronous expiry checks remain between here and the one reply.
      const now = this.now();
      if (input.selection.expiresAt <= now.getTime() || session.expiresAt.getTime() <= now.getTime()) return false;
      return input.finalize();
    });
  }

  claimInput(input: {
    scope: DesktopRunScope;
    selection: DesktopComputerSelection;
    holderId: string;
    commandId: string;
  }): Promise<boolean> {
    return this.selections.claimInput(input.scope, input.selection, input.holderId, input.commandId);
  }

  clearInput(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
    commandId: string,
  ): Promise<boolean> {
    return this.selections.clearInput(scope, selection, holderId, commandId);
  }

  scopesForTurn(turnId: string): Promise<DesktopRunScope[]> {
    return this.selections.scopesForTurn(turnId);
  }

  scopesForDevice(deviceId: string): Promise<DesktopRunScope[]> {
    return this.selections.scopesForDevice(deviceId);
  }

  async select(input: { scope: DesktopRunScope; selectionId: string; bundleId: string }): Promise<DesktopComputerSelection> {
    const { scope } = input;
    const requestedSelectionId = idSchema.parse(input.selectionId);
    let written: DesktopComputerSelection | undefined;
    try {
      const stored = await withDesktopComputerLock(this.prisma, scope, async (tx, locked) => {
        // Start the five-minute window only after the locked authority proves
        // the exact run and credential; a lock wait must not consume the grant.
        const now = this.now();
        const expiresAt = desktopComputerSelectionExpiry(now);
        await requireRunningDesktopComputerTurn(tx, locked, scope.turnId);
        // Tokenless exact binding while the database authority is locked; the
        // Lua CAS below repeats it atomically with the Redis write.
        if (!await this.leases.hasActiveBinding(scope)) throw new AppError("AUTH_REQUIRED");
        const existing = await this.selections.read(scope);
        if (existing) {
          const live = existing.expiresAt > now.getTime();
          if (live && (existing.state === "paused" || existing.state === "pausing")) throw targetChanged();
          if (existing.selectionId === requestedSelectionId) {
            // One native selection: a known id may only renew its exact live
            // session. It never becomes fresh authorization, even after the
            // session or a grant was revoked, expired, or stopped.
            if (existing.bundleId !== input.bundleId) throw targetChanged();
            if (!live || existing.state !== "active") throw accessDenied();
            // The exact live session, both application grants, and the same
            // previous expiry are required. A revoked or expired binding
            // throws FORBIDDEN and maps to COMPUTER_ACCESS_DENIED; other
            // failures stay bounded operational errors and leak no detail.
            const session = await readActiveDesktopComputerSession(tx, locked, {
              sessionId: existing.sessionId, bundleId: existing.bundleId,
              requireGrants: true, now,
            });
            if (session.expiresAt.getTime() !== existing.expiresAt) throw accessDenied();
            // The native renewal is only a strictly later bounded expiry. An
            // equal (or backward) window is a legitimate non-success: write
            // nothing, advance no epoch, and leave the grants and holder
            // untouched.
            if (expiresAt.getTime() <= existing.expiresAt) throw timedOut();
            await extendDesktopComputerSelection(tx, locked, {
              sessionId: existing.sessionId, now, expiresAt,
            });
            const lease: DesktopComputerSelection = desktopComputerSelectionSchema.parse({
              ...existing, state: "active", expiresAt: expiresAt.getTime(),
              controlEpoch: randomUUID(),
              // The renewal CAS requires this value; it is overwritten with a
              // known-idle marker only after the live marker is proven idle.
              pendingInput: null,
            });
            // The renewal CAS re-proves the exact previous version under Redis
            // TIME. If it expired, vanished, or was replaced after the locked
            // read, the refusal throws and this transaction rolls back the
            // session/grant extension above without writing fresh metadata.
            const stored = await this.selections.renew(scope, lease, existing);
            written = stored;
            return stored;
          }
          // A different id is a fresh deliberate pick, but only after the
          // previous selection is no longer live: a live active selection is
          // one selection, and a paused one must be resumed instead.
          if (live && existing.state === "active") throw targetChanged();
        }
        const sessionId = randomUUID();
        const grantIds = [randomUUID(), randomUUID()] as const;
        const { endedSessionIds } = await prepareDesktopComputerSelection(tx, locked, {
          sessionId, grantIds, bundleId: input.bundleId, now, expiresAt,
        });
        const lease: DesktopComputerSelection = desktopComputerSelectionSchema.parse({
          v: 1, state: "active", ownerId: scope.ownerId, deviceId: scope.deviceId,
          conversationId: scope.conversationId, turnId: scope.turnId,
          runtimeGeneration: locked.runtimeGeneration, connectionId: scope.connectionId,
          sessionId, selectionId: requestedSelectionId, bundleId: input.bundleId,
          controlEpoch: randomUUID(), expiresAt: expiresAt.getTime(), pendingInput: null,
        });
        const stored = await this.selections.select(scope, lease, endedSessionIds);
        written = stored;
        return stored;
      });
      return await this.revalidate(scope, stored);
    } catch (error) {
      if (written) await this.selections.clear(scope, written).catch(() => undefined);
      throw error;
    }
  }

  async pause(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection> {
    const { scope } = input;
    return withDesktopComputerLock(this.prisma, scope, async (tx, locked) => {
      const existing = await this.selections.read(scope);
      if (!existing || existing.connectionId !== scope.connectionId) throw unavailable();
      if (existing.selectionId !== idSchema.parse(input.selectionId)) throw targetChanged();
      if (existing.state === "paused" || existing.state === "pausing") {
        return await this.selections.pause(scope, existing.selectionId);
      }
      if (existing.state !== "active") throw unavailable();
      const now = this.now();
      if (existing.expiresAt <= now.getTime()) throw timedOut();
      await requireRunningDesktopComputerTurn(tx, locked, scope.turnId);
      const session = await readActiveDesktopComputerSession(tx, locked, {
        sessionId: existing.sessionId, bundleId: existing.bundleId, requireGrants: false, now,
      });
      if (session.expiresAt.getTime() !== existing.expiresAt) throw accessDenied();
      return await this.selections.pause(scope, existing.selectionId);
    });
  }

  confirmPause(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<DesktopComputerSelection> {
    return this.selections.confirmPause(input.scope, input.selection);
  }

  async resume(input: {
    scope: DesktopRunScope;
    selectionId: string;
    newSelectionId: string;
  }): Promise<DesktopComputerSelection> {
    const { scope } = input;
    const previous = idSchema.parse(input.selectionId);
    const next = idSchema.parse(input.newSelectionId);
    let written: DesktopComputerSelection | undefined;
    try {
      const stored = await withDesktopComputerLock(this.prisma, scope, async (tx, locked) => {
        const existing = await this.selections.read(scope);
        if (!existing || existing.connectionId !== scope.connectionId) throw unavailable();
        const now = this.now();
        if (existing.expiresAt <= now.getTime()) throw timedOut();
        await requireRunningDesktopComputerTurn(tx, locked, scope.turnId);
        // Tokenless exact binding while the database authority is locked; the
        // Lua CAS below repeats it atomically with the resume write.
        if (!await this.leases.hasActiveBinding(scope)) throw new AppError("AUTH_REQUIRED");
        // A lost acknowledge may retry the identical explicit resume. Return the
        // already-resumed selection only after re-proving the same live grants.
        if (existing.state === "active" && existing.selectionId === next) {
          const session = await readActiveDesktopComputerSession(tx, locked, {
            sessionId: existing.sessionId, bundleId: existing.bundleId, requireGrants: true, now,
          });
          if (session.expiresAt.getTime() !== existing.expiresAt) throw accessDenied();
          return existing;
        }
        if (existing.selectionId !== previous) throw targetChanged();
        const session = await readActiveDesktopComputerSession(tx, locked, {
          sessionId: existing.sessionId, bundleId: existing.bundleId, requireGrants: true, now,
        });
        if (session.expiresAt.getTime() !== existing.expiresAt) throw accessDenied();
        const stored = await this.selections.resume(scope, existing.selectionId, next);
        written = stored;
        return stored;
      });
      return await this.revalidate(scope, stored);
    } catch (error) {
      // The Redis resume is outside the database transaction; a failed commit
      // must not leave the speculative active metadata behind.
      if (written) await this.selections.clear(scope, written).catch(() => undefined);
      throw error;
    }
  }

  async stop(input: { scope: DesktopRunScope; selectionId: string }): Promise<DesktopComputerSelection> {
    const { scope } = input;
    return withDesktopComputerLock(this.prisma, scope, async (tx, locked) => {
      const existing = await this.selections.read(scope);
      if (!existing || existing.connectionId !== scope.connectionId) throw unavailable();
      if (existing.selectionId !== idSchema.parse(input.selectionId)) throw targetChanged();
      // Safety control: revoke the exact session even when the turn became
      // terminal or an earlier stop committed only its Redis state. The exact
      // session id keeps a newer session untouched; an already-ended session is
      // an idempotent no-op.
      await endDesktopComputerSession(tx, locked, { sessionId: existing.sessionId, now: this.now() });
      return await this.selections.stop(scope, existing.selectionId);
    });
  }

  /**
   * After the locked transaction commits, the run lease may already have been
   * revoked or rebound. The committed selection is still speculative until
   * the positive control ack, so on any non-live/unknown result the exact
   * selection metadata and exactly its speculative session are discarded.
   * No newer or prior unrelated selection is touched.
   */
  private async revalidate(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
  ): Promise<DesktopComputerSelection> {
    let live: boolean;
    try {
      live = await this.leases.hasActiveBinding(scope);
    } catch {
      live = false;
    }
    if (live) return selection;
    await this.discard({ scope, selection }).catch(() => undefined);
    throw new AppError("AUTH_REQUIRED");
  }

  /**
   * One authoritative generation cleanup for turn/connection/revoke and a
   * failed positive acknowledgement.
   *
   * The exact six-field Redis compare-delete and the database session/grant
   * cleanup run under the same conversation lock that an explicit renewal of
   * this session must take. A delayed cleanup started with pre-renewal
   * metadata therefore either runs before the renewal and clears its own
   * generation, or waits for the renewal and then fails the CAS without
   * touching the newer binding, its reused holder, or its session/grants.
   *
   * The clear additionally requires the live pending marker to be the explicit
   * known-idle null: a possible act is not over just because this connection
   * or run was fenced, and neither an absent (legacy) marker nor an object can
   * prove that no input was admitted. In that case the selection metadata and
   * holder are retained for the exact terminal/quiesce proof or bounded expiry
   * instead of being released. If the live value still proves the exact
   * retired generation, its database authorization is ended anyway so an
   * explicit revoke never leaves a usable grant behind; a same-id renewal has
   * a different session/epoch/expiry and is never ended by stale cleanup.
   * If the lock or exact identity cannot be proven, nothing is released:
   * bounded selection expiry and the existing stop/revoke paths remain in
   * charge.
   */
  async discard(input: { scope: DesktopRunScope; selection: DesktopComputerSelection }): Promise<void> {
    const exact = { ...input.scope, connectionId: input.selection.connectionId };
    try {
      await withDesktopComputerLock(this.prisma, exact, async tx => {
        const cleared = await this.selections.clear(exact, input.selection);
        if (cleared) {
          // Holder release is downstream of the exact clear only; the holder
          // compare covers scope, connection, session, selection, and bundle.
          const held = await this.occupancy?.read(exact.deviceId).catch(() => null);
          if (held && matchesHeld(held, exact, input.selection)) {
            await this.occupancy!.release(exact.deviceId, held.holderId).catch(() => false);
          }
          await this.endRetiredSession(tx, exact, input.selection);
          return;
        }
        // The clear is refused because the live value is not the exact idle
        // retired generation. End its database authorization only when the
        // live value is still provably that generation (a retained pending
        // marker is the expected case); a renewed or replaced binding has a
        // different session/epoch/expiry and must survive this stale cleanup.
        const current = await this.selections.read(exact).catch(() => null);
        if (!current ||
            current.selectionId !== input.selection.selectionId ||
            current.sessionId !== input.selection.sessionId ||
            current.controlEpoch !== input.selection.controlEpoch ||
            current.expiresAt !== input.selection.expiresAt) return;
        await this.endRetiredSession(tx, exact, input.selection);
      });
    } catch {
      // Fail closed to the bounded selection expiry and existing revocation.
    }
  }

  private async endRetiredSession(
    tx: Prisma.TransactionClient,
    exact: DesktopRunScope,
    selection: DesktopComputerSelection,
  ): Promise<void> {
    const ended = await endLocalComputerSessions(tx, {
      ownerId: exact.ownerId, conversationId: exact.conversationId,
      deviceId: exact.deviceId, id: selection.sessionId,
    }, this.now());
    if (ended.length) {
      await auditLocalComputerChange(tx, exact.ownerId, "computer_session_stopped", selection.sessionId);
    }
  }
}

/**
 * Final send continuation supplied by the transport. `mayDispatch` runs
 * inside the locked dispatch transaction after the selection/holder/grant/
 * binding rechecks; `finalize` then performs only synchronous pending/socket/
 * expiry checks and at most one send. The lock is not held across the native
 * response, result publication, or quiesce wait.
 */
export type DesktopComputerAdmitBarrier = {
  mayDispatch: () => Promise<boolean>;
  finalize: () => boolean;
};

/** Dependencies supplied by the single API composition, never by the model. */
export type DesktopComputerControlHost = {
  store: DesktopComputerControlStore;
  transport: Pick<DesktopDeviceTransport, "connection" | "send">;
  occupancy: Pick<LocalComputerGuiOccupancy, "acquire" | "match" | "release" | "read">;
  authorize: (input: {
    scope: DesktopRunScope;
    capability: LocalComputerActionCapability;
    bundleId: string;
    runToken: string;
  }) => Promise<LocalComputerActionAuthorization>;
  verifyDispatch: (
    input: {
      scope: DesktopRunScope;
      sessionId: string;
      grantId: string;
      capability: LocalComputerActionCapability;
      bundleId: string;
      expiresAt: Date;
    },
    finalize?: () => boolean | Promise<boolean>,
  ) => Promise<void>;
  claimNativeCall: (turnId: string, nativeCallId: string) => Promise<boolean>;
  now?: () => Date;
};

const controlFailureCodes = [
  "COMPUTER_UNAVAILABLE", "COMPUTER_STALE_OBSERVATION", "COMPUTER_ACCESS_DENIED", "COMPUTER_TIMEOUT",
  "COMPUTER_INVALID", "COMPUTER_ACTION_FAILED", "DEVICE_BUSY", "COMPUTER_TARGET_CHANGED", "RUNNER_OPERATION_UNCERTAIN",
] as const;
const maxTrackedSelections = 256;
const maxSelectionIdleMs = 10 * 60_000;

/**
 * Product M1b controller.
 *
 * The model/tool request never names a selection, window, application, session,
 * holder, or connection. Every read/act is bound to the native selection
 * metadata that the authenticated Mac device socket explicitly created. Pause
 * and stop run the existing control-only quiesce command; success is returned
 * only after the exact native terminal/refs-clear ack (or when no holder was
 * ever admitted). Codex itself is never interrupted or replayed here.
 */
export class DesktopComputerControl {
  private readonly tracked = new Map<string, { scope: DesktopRunScope; expiresAt: number }>();

  constructor(private readonly host: DesktopComputerControlHost) {}

  /**
   * One control transition. For a positive `active` ack the final database
   * session/grant check and the single synchronous reply run inside the same
   * conversation lock that public stop and grant revocation take, so neither
   * can commit between the check and the ack. `deliver` performs that one
   * synchronous socket send; without it the result is returned to the caller.
   */
  async handle(input: {
    ownerId: string;
    deviceId: string;
    connectionId: string;
    verifyCredential: () => Promise<boolean>;
    frame: DesktopComputerControlFrame;
  }, deliver?: (result: DesktopComputerControlResult) => boolean): Promise<DesktopComputerControlResult> {
    const base = { type: "computer.control.result", id: input.frame.id } as const;
    let delivered = false;
    const emit = (result: DesktopComputerControlResult): boolean => {
      if (delivered) return true;
      if (!deliver) return true;
      if (!deliver(result)) return false;
      delivered = true;
      return true;
    };
    const success = (selection: DesktopComputerSelection): DesktopComputerControlResult => {
      // `pausing` is an internal in-between state and is never acknowledged.
      if (selection.state === "pausing") throw unavailable();
      return {
        ...base, ok: true,
        data: {
          state: selection.state,
          session_id: selection.sessionId,
          selection_id: selection.selectionId,
          runtime_generation: selection.runtimeGeneration,
          expires_at: new Date(selection.expiresAt).toISOString(),
        },
      };
    };
    try {
      if (!await input.verifyCredential()) throw accessDenied();
      const resolved = await this.host.store.resolve({
        ownerId: input.ownerId, deviceId: input.deviceId, conversationId: input.frame.body.conversation_id,
      });
      if (!resolved) throw accessDenied();
      const scope = desktopRunScopeSchema.parse({
        ownerId: input.ownerId, deviceId: input.deviceId, connectionId: input.connectionId,
        conversationId: input.frame.body.conversation_id, turnId: input.frame.body.turn_id,
        runtimeGeneration: resolved.runtimeGeneration,
      });
      const body = input.frame.body;
      const selection = body.action === "select"
        ? await this.host.store.select({ scope, selectionId: body.selection_id, bundleId: body.bundle_id })
        : body.action === "pause" ? await this.pause(scope, body.selection_id)
          : body.action === "resume" ? await this.resume(scope, body.selection_id, body.new_selection_id)
            : await this.stop(scope, body.selection_id);
      if (!await input.verifyCredential() || !await this.currentBinding(scope)) throw unavailable();
      if (selection.state !== "active" && selection.state !== "paused" && selection.state !== "stopped") {
        throw unavailable();
      }
      // A cleanup or a concurrent control must not let this ack activate
      // metadata that is no longer current. Stop already revoked the exact
      // session, so its success does not depend on retaining the bundle.
      if (body.action !== "stop") {
        const current = await this.host.store.read(scope);
        if (!current || current.selectionId !== selection.selectionId ||
            current.sessionId !== selection.sessionId || current.controlEpoch !== selection.controlEpoch ||
            current.bundleId !== selection.bundleId || current.state !== selection.state) throw unavailable();
      }
      // Last-instant tokenless binding recheck before the positive active ack.
      // A revoked/rebound run makes the just-committed selection speculative;
      // discard exactly it rather than letting the Mac activate it.
      if (body.action === "select" || body.action === "resume") {
        let live = false;
        try {
          live = await this.host.store.bindingLive(scope);
        } catch {
          live = false;
        }
        if (!live) {
          await this.host.store.discard({ scope, selection }).catch(() => undefined);
          throw unavailable();
        }
        // Final locked DB session/grant/turn check with the synchronous ack
        // inside the same conversation lock. A public stop or grant revoke
        // that committed after the select/resume transaction is observed
        // here and suppresses the positive active ack. No native work or
        // quiesce wait happens while the lock is held.
        const active = success(selection);
        let finalized = false;
        try {
          finalized = await this.host.store.finalizeActive({
            scope, selection,
            verify: async () => await input.verifyCredential() && await this.currentBinding(scope) !== null,
            finalize: () => emit(active),
          });
        } catch {
          // A transaction failure after the one synchronous ack already went
          // out is an uncertain commit, not a reason to send a contradictory
          // second reply.
          if (delivered) return active;
          throw unavailable();
        }
        if (!finalized) {
          // A public stop/revoke that won the lock suppresses the ack but
          // leaves only the speculative Redis selection; it fails closed on
          // authorize and is removed by expiry/stop/turn/connection cleanup.
          // Ending the session here would wrongly terminate it on a grant
          // revoke that did not stop the session.
          throw unavailable();
        }
        this.track(scope, selection);
        return active;
      }
      // Preserve the pre-existing presence check before a non-active reply as
      // well; a replaced link is never acknowledged.
      if (!await this.currentBinding(scope)) throw unavailable();
      if (selection.state === "stopped") this.tracked.delete(desktopComputerSelectionKey(scope));
      else this.track(scope, selection);
      const result = success(selection);
      if (deliver) emit(result);
      return result;
    } catch (error) {
      const result: DesktopComputerControlResult = {
        ...base, ok: false, error_code: controlFailureCode(error),
      };
      if (deliver) emit(result);
      return result;
    }
  }

  /** Product execution lane for an existing `computer.execute` tool request. */
  async execute(input: {
    scope: DesktopRunScope;
    request: ComputerExecuteToolRequest;
    signal: AbortSignal;
  }): Promise<ComputerExecuteResult> {
    let mutationMayHaveRun = false;
    try {
      const scope = desktopRunScopeSchema.parse(input.scope);
      const { body } = input.request;
      const selection = await this.activeSelection(scope);
      if (!selection) return computerExecuteFailure("COMPUTER_UNAVAILABLE");
      if (body.kind === "act" && selection.state !== "active") return computerExecuteFailure("COMPUTER_UNAVAILABLE");
      if (body.kind === "observe" && selection.state !== "active") return computerExecuteFailure("COMPUTER_UNAVAILABLE");
      if (body.kind === "status" && selection.state === "stopped") return computerExecuteFailure("COMPUTER_UNAVAILABLE");
      const capability: LocalComputerActionCapability = body.kind === "act" ? "computer.act" : "computer.observe";
      const authorization = await this.host.authorize({
        scope, capability, bundleId: selection.bundleId, runToken: input.request.run_token,
      });
      if (!sameDesktopRunScope(desktopRunScopeSchema.parse(authorization.scope), scope) ||
          authorization.sessionId !== selection.sessionId || authorization.bundleId !== selection.bundleId) {
        return computerExecuteFailure("COMPUTER_ACCESS_DENIED");
      }
      const selectionId = idSchema.parse(selection.selectionId);
      const admission = {
        scope, sessionId: selection.sessionId, grantId: authorization.grantId,
        capability, bundleId: selection.bundleId, expiresAt: authorization.expiresAt.toISOString(),
        controlEpoch: selection.controlEpoch,
      };
      input.signal.throwIfAborted();
      const toolExpiresAt = Date.parse(input.request.expires_at);
      if (!Number.isFinite(toolExpiresAt)) return computerExecuteFailure("COMPUTER_INVALID");
      const binding = await this.currentBinding(scope);
      if (!binding) return computerExecuteFailure("COMPUTER_UNAVAILABLE");

      if (body.kind === "status") {
        const expiresAt = Math.min(toolExpiresAt, authorization.expiresAt.getTime(), selection.expiresAt);
        if (expiresAt <= this.now().getTime()) return computerExecuteFailure("COMPUTER_TIMEOUT");
        const result = await sendComputerExecute(this.host.transport, binding, scope, {
          sessionId: selection.sessionId, selectionId, holderId: null, request: { kind: "status" },
          expiresAt, signal: input.signal, admission,
        });
        return expectComputerExecuteKind(result, "status");
      }

      if (body.kind === "observe") {
        // Product lane only: the explicit authorized observe holds the lease
        // through this grant's expiry, so a later act approved after minutes
        // of native deliberation still matches the exact same holder.
        const acquired = await this.host.occupancy.acquire({
          authorization, selectionId, throughAuthorizationExpiry: true,
        });
        if (acquired.status !== "acquired") return acquireComputerExecuteFailure(acquired);
        // An acquire may be a new holder or the exact one a repeated/concurrent
        // observe is already using. A stale selection, an expired window, or
        // any typed failure (including COMPUTER_UNAVAILABLE, which can be the
        // device's answer after it adopted the holder) does not prove that the
        // holder was never delivered or is this call's alone. Retain it; only
        // the exact pause/stop/turn/connection/revoke lifecycle release or the
        // bounded authorization expiry removes it. Never create a second
        // flight table or retry the observe here.
        const current = await this.activeSelection(scope);
        if (!current || current.selectionId !== selectionId || current.sessionId !== selection.sessionId ||
            current.connectionId !== scope.connectionId || current.controlEpoch !== selection.controlEpoch) {
          return computerExecuteFailure("COMPUTER_TARGET_CHANGED");
        }
        const expiresAt = Math.min(
          toolExpiresAt, authorization.expiresAt.getTime(), acquired.expiresAt, current.expiresAt,
        );
        if (expiresAt <= this.now().getTime()) return computerExecuteFailure("COMPUTER_TIMEOUT");
        mutationMayHaveRun = true;
        const result = await sendComputerExecute(this.host.transport, binding, scope, {
          sessionId: selection.sessionId, selectionId, holderId: acquired.holderId,
          request: { kind: "observe" }, expiresAt, signal: input.signal, admission,
        });
        return expectComputerExecuteKind(result, "observe");
      }

      const held = await this.host.occupancy.read(scope.deviceId);
      if (!held || !matchesHeld(held, scope, selection)) {
        return computerExecuteFailure("COMPUTER_STALE_OBSERVATION");
      }
      // The act's own grant bounds this command's deadline, but an older valid
      // grant must not truncate the longer lease acquired by the observe.
      const matched = await this.host.occupancy.match({
        authorization, selectionId, holderId: held.holderId, preserveStoredExpiry: true,
      });
      if (matched.status === "target_changed") return computerExecuteFailure("COMPUTER_TARGET_CHANGED");
      if (matched.status === "not_held") {
        return computerExecuteFailure(matched.reason === "connection" || matched.reason === "malformed"
          ? "COMPUTER_UNAVAILABLE" : "COMPUTER_STALE_OBSERVATION");
      }
      if (!await this.host.claimNativeCall(scope.turnId, body.native_call_id)) {
        return computerExecuteFailure("RUNNER_OPERATION_UNCERTAIN");
      }
      const current = await this.activeSelection(scope);
      if (!current || current.selectionId !== selectionId || current.sessionId !== selection.sessionId ||
          current.connectionId !== scope.connectionId || current.controlEpoch !== selection.controlEpoch) {
        return computerExecuteFailure("COMPUTER_TARGET_CHANGED");
      }
      const expiresAt = Math.min(
        toolExpiresAt, authorization.expiresAt.getTime(), matched.expiresAt, current.expiresAt,
      );
      if (expiresAt <= this.now().getTime()) return computerExecuteFailure("COMPUTER_TIMEOUT");
      mutationMayHaveRun = true;
      // The observe lease itself now covers the absolute grant, so no
      // per-act heartbeat is needed: a delayed native approval still finds
      // the exact holder until the authorization expires.
      const commandId = randomUUID();
      const result = await sendComputerExecute(this.host.transport, binding, scope, {
        commandId, sessionId: selection.sessionId, selectionId, holderId: held.holderId,
        request: body, expiresAt, signal: input.signal, admission,
      });
      // A typed native act result or a provably terminal pre-execution
      // rejection clears only this command's marker. An uncertain transport,
      // timeout, or cancel keeps it for pause/stop quiesce.
      if (result.kind === "act" ||
          (result.kind === "failure" && result.error !== "RUNNER_OPERATION_UNCERTAIN")) {
        await this.host.store.clearInput(scope, selection, held.holderId, commandId).catch(() => false);
      }
      return expectComputerExecuteKind(result, "act");
    } catch (error) {
      if (mutationMayHaveRun && error instanceof DesktopCommandUncertainError) {
        return computerExecuteFailure("RUNNER_OPERATION_UNCERTAIN");
      }
      if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "AUTH_REQUIRED" ||
          error.code === "AUTH_SESSION_EXPIRED")) {
        return computerExecuteFailure("COMPUTER_ACCESS_DENIED");
      }
      return computerExecuteFailure(mutationMayHaveRun ? "RUNNER_OPERATION_UNCERTAIN" : "COMPUTER_UNAVAILABLE");
    }
  }

  /**
   * Dispatch-time admission for one already queued command.
   *
   * The coarse checks reject early, then the final selection, holder, expiry,
   * canonical run binding, mayDispatch, pending-input claim, and the transport's
   * synchronous send continuation all run inside the same PostgreSQL
   * authorization transaction that a public stop/revoke must wait for. The
   * lock is released as soon as the single socket send is invoked; it is never
   * held while waiting for the native response, a result publication, or
   * quiescence.
   */
  async admit(input: {
    scope: DesktopRunScope;
    request: ComputerExecuteInput | { kind: "quiesce" };
    /** Exact generated transport command UUID; never model input. */
    commandId: string;
    sessionId: string;
    selectionId: string;
    holderId: string | null;
    admission: DesktopComputerDispatchAdmission;
  }, barrier?: DesktopComputerAdmitBarrier): Promise<boolean> {
    try {
      const scope = desktopRunScopeSchema.parse(input.scope);
      if (!sameDesktopRunScope(input.admission.scope, scope)) return false;
      const capability: LocalComputerActionCapability | undefined = input.request.kind === "act" ? "computer.act"
        : input.request.kind === "quiesce" ? undefined : "computer.observe";
      if (!capability || input.admission.capability !== capability) return false;
      const selectionId = idSchema.parse(input.selectionId);
      const holderId = input.holderId === null ? null : idSchema.parse(input.holderId);
      const commandId = idSchema.parse(input.commandId);
      const selection = await this.activeSelection(scope);
      if (!selection) return false;
      if (input.request.kind === "act" && selection.state !== "active") return false;
      if (input.request.kind === "observe" && selection.state !== "active") return false;
      if (input.request.kind === "status" && selection.state !== "active" &&
          selection.state !== "pausing" && selection.state !== "paused") return false;
      if (selection.sessionId !== input.sessionId || selection.selectionId !== selectionId ||
          selection.bundleId !== input.admission.bundleId ||
          input.admission.controlEpoch !== selection.controlEpoch) return false;
      if (input.admission.expiresAt.getTime() <= this.now().getTime()) return false;
      if (input.request.kind !== "status") {
        if (holderId === null) return false;
        const held = await this.host.occupancy.read(scope.deviceId);
        if (!held || held.holderId !== holderId || !matchesHeld(held, scope, selection)) return false;
      }
      let admitted = false;
      await this.host.verifyDispatch({
        scope, sessionId: input.admission.sessionId, grantId: input.admission.grantId,
        capability, bundleId: input.admission.bundleId, expiresAt: input.admission.expiresAt,
      }, async () => {
        // Every decision below is made while the conversation lock is held.
        if (!await this.host.store.bindingLive(scope)) return false;
        const current = await this.activeSelection(scope);
        if (!current) return false;
        const stateAllowed = input.request.kind === "status"
          ? current.state === "active" || current.state === "pausing" || current.state === "paused"
          : current.state === "active";
        if (!stateAllowed || current.sessionId !== input.sessionId ||
            current.selectionId !== selectionId ||
            current.bundleId !== input.admission.bundleId ||
            current.controlEpoch !== input.admission.controlEpoch ||
            input.admission.expiresAt.getTime() <= this.now().getTime() ||
            current.expiresAt <= this.now().getTime()) return false;
        if (input.request.kind !== "status") {
          if (holderId === null) return false;
          const held = await this.host.occupancy.read(scope.deviceId);
          if (!held || held.holderId !== holderId || !matchesHeld(held, scope, current)) return false;
        }
        if (!barrier) {
          admitted = true;
          return true;
        }
        if (!await barrier.mayDispatch()) return false;
        // Durable proof that this exact generated command may reach the native
        // executor, written only after every other check and immediately
        // before the one send.
        if (input.request.kind === "act" && holderId !== null &&
            !await this.host.store.claimInput({ scope, selection: current, holderId, commandId })) return false;
        if (!barrier.finalize()) {
          // The send never happened, so roll back only this command's marker.
          // The compare includes selection/epoch/connection and the command
          // UUID; another command's proof is never touched.
          if (input.request.kind === "act" && holderId !== null) {
            await this.host.store.clearInput(scope, current, holderId, commandId).catch(() => false);
          }
          return false;
        }
        admitted = true;
        return true;
      });
      return admitted;
    } catch {
      return false;
    }
  }

  /** Ends selection metadata and any matching holder for an exact connection. */
  async releaseConnection(deviceId: string, connectionId: string): Promise<void> {
    const indexed = await this.host.store.scopesForDevice(deviceId).catch(() => []);
    const scopes = new Map<string, DesktopRunScope>();
    for (const scope of indexed) {
      if (scope.connectionId === connectionId) scopes.set(desktopComputerSelectionKey(scope), scope);
    }
    for (const { scope } of this.tracked.values()) {
      if (scope.deviceId === deviceId && scope.connectionId === connectionId) {
        scopes.set(desktopComputerSelectionKey(scope), scope);
      }
    }
    for (const scope of scopes.values()) await this.revokeScope(scope, { requireConnection: true });
  }

  /**
   * Run revocation notice. The bounded Redis turn index is authoritative, so
   * cleanup works on any replica even though only the socket owner has the
   * process-local tracked entry.
   */
  async revokeTurn(turnId: string): Promise<void> {
    const id = idSchema.parse(turnId);
    const scopes = new Map<string, DesktopRunScope>();
    for (const scope of await this.host.store.scopesForTurn(id).catch(() => [])) {
      scopes.set(desktopComputerSelectionKey(scope), scope);
    }
    for (const { scope } of this.tracked.values()) {
      if (scope.turnId === id) scopes.set(desktopComputerSelectionKey(scope), scope);
    }
    for (const scope of scopes.values()) await this.revokeScope(scope);
  }

  /**
   * Clears exactly the stored selection and ends exactly its session through
   * the store's one authoritative discard. Turn terminal/revoke cleanup may
   * clear a selection whose socket was already replaced; disconnect cleanup
   * requires the exact connection so an old link can never clear a newer
   * selection. Only the exact compare-delete leads to holder release or
   * session discard; stale generation metadata never reaches either.
   */
  async revokeScope(
    scope: DesktopRunScope,
    options: { requireConnection?: boolean } = {},
  ): Promise<void> {
    const key = desktopComputerSelectionKey(scope);
    this.tracked.delete(key);
    const selection = await this.host.store.readKeyScope(scope).catch(() => null);
    if (!selection) return;
    if (options.requireConnection && selection.connectionId !== scope.connectionId) return;
    const exact = { ...scope, connectionId: selection.connectionId };
    await this.host.store.discard({ scope: exact, selection }).catch(() => undefined);
  }

  private async pause(scope: DesktopRunScope, selectionId: string): Promise<DesktopComputerSelection> {
    const paused = await this.host.store.pause({ scope, selectionId });
    const holder = await this.matchingHolder(scope, paused);
    const pending = paused.pendingInput;
    if (holder && pending && holder.holderId !== pending.holderId) throw targetChanged();
    // A missing occupancy key after an admitted act is not proof that no input
    // exists: the durable pending marker names the exact holder to quiesce.
    const holderId = holder?.holderId ?? pending?.holderId;
    if (!holderId) {
      return paused.state === "paused" ? paused : await this.host.store.confirmPause({ scope, selection: paused });
    }
    const ack = await this.quiesce(scope, paused, holderId);
    if (!ack.ok) throw new DesktopComputerSelectionError(ack.code);
    // The exact quiesce proof clears only the pending UUID captured above.
    if (pending) await this.host.store.clearInput(scope, paused, pending.holderId, pending.commandId)
      .catch(() => false);
    const confirmed = paused.state === "paused"
      ? paused : await this.host.store.confirmPause({ scope, selection: paused });
    await this.host.occupancy.release(scope.deviceId, holderId).catch(() => false);
    return confirmed;
  }

  private async resume(
    scope: DesktopRunScope, selectionId: string, newSelectionId: string,
  ): Promise<DesktopComputerSelection> {
    return this.host.store.resume({ scope, selectionId, newSelectionId });
  }

  private async stop(scope: DesktopRunScope, selectionId: string): Promise<DesktopComputerSelection> {
    const stopped = await this.host.store.stop({ scope, selectionId });
    this.tracked.delete(desktopComputerSelectionKey(scope));
    const holder = await this.matchingHolder(scope, stopped);
    const pending = stopped.pendingInput;
    if (holder && pending && holder.holderId !== pending.holderId) throw targetChanged();
    const holderId = holder?.holderId ?? pending?.holderId;
    if (!holderId) return stopped;
    const ack = await this.quiesce(scope, stopped, holderId);
    if (!ack.ok) throw new DesktopComputerSelectionError(ack.code);
    // The exact quiesce proof clears only the pending UUID captured above.
    if (pending) await this.host.store.clearInput(scope, stopped, pending.holderId, pending.commandId)
      .catch(() => false);
    await this.host.occupancy.release(scope.deviceId, holderId).catch(() => false);
    return stopped;
  }

  /**
   * Sends exactly one control-only quiesce command and waits for the matching
   * native terminal/refs-clear ack. No Codex interrupt and no retry. The
   * holder id may come from an expired occupancy holder or from the durable
   * pending marker; the native side only accepts the exact adopted holder.
   */
  private async quiesce(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
    holderId: string,
  ): Promise<{ ok: true } | { ok: false; code: DesktopComputerControlFailureCode }> {
    const binding = await this.currentBinding(scope);
    if (!binding) return { ok: false, code: "COMPUTER_UNAVAILABLE" };
    const result = await sendComputerExecute(this.host.transport, binding, scope, {
      sessionId: selection.sessionId, selectionId: selection.selectionId, holderId,
      request: { kind: "quiesce" }, expiresAt: this.now().getTime() + desktopComputerQuiesceLifetimeMs,
      signal: AbortSignal.timeout(desktopComputerQuiesceLifetimeMs),
    }).catch(() => computerExecuteFailure("COMPUTER_UNAVAILABLE"));
    if (result.kind === "quiesce") return { ok: true };
    if (result.kind === "failure" && result.error === "RUNNER_OPERATION_UNCERTAIN") {
      return { ok: false, code: "RUNNER_OPERATION_UNCERTAIN" };
    }
    const code = result.kind === "failure" ? result.error : undefined;
    return {
      ok: false,
      code: code && (controlFailureCodes as readonly string[]).includes(code)
        ? code as DesktopComputerControlFailureCode : "COMPUTER_UNAVAILABLE",
    };
  }

  private async matchingHolder(
    scope: DesktopRunScope,
    selection: DesktopComputerSelection,
  ): Promise<LocalComputerGuiHeld | null> {
    const held = await this.host.occupancy.read(scope.deviceId);
    if (!held) return null;
    if (!matchesHeld(held, scope, selection)) throw targetChanged();
    return held;
  }

  private async activeSelection(scope: DesktopRunScope): Promise<DesktopComputerSelection | null> {
    const selection = await this.host.store.read(scope);
    if (!selection || selection.connectionId !== scope.connectionId ||
        selection.expiresAt <= this.now().getTime()) return null;
    return selection;
  }

  private async currentBinding(scope: DesktopRunScope): Promise<DesktopExecutionBinding | null> {
    const binding = await this.host.transport.connection(scope.deviceId);
    return binding?.connectionId === scope.connectionId ? binding : null;
  }

  private track(scope: DesktopRunScope, selection: DesktopComputerSelection): void {
    const now = this.now().getTime();
    for (const [key, entry] of this.tracked) {
      if (entry.expiresAt + desktopComputerQuiesceLifetimeMs <= now) this.tracked.delete(key);
    }
    const key = desktopComputerSelectionKey(scope);
    while (this.tracked.size >= maxTrackedSelections && !this.tracked.has(key)) {
      const oldest = this.tracked.keys().next().value;
      if (oldest === undefined) break;
      this.tracked.delete(oldest);
    }
    this.tracked.set(key, { scope, expiresAt: Math.min(selection.expiresAt, now + maxSelectionIdleMs) });
  }

  private now(): Date {
    return this.host.now?.() ?? new Date();
  }
}

function controlFailureCode(error: unknown): DesktopComputerControlFailureCode {
  if (error instanceof DesktopComputerSelectionError) return error.code;
  if (error instanceof AppError) {
    if (error.code === "FORBIDDEN" || error.code === "AUTH_REQUIRED" ||
        error.code === "AUTH_SESSION_EXPIRED" || error.code === "ACCESS_DENIED") {
      return "COMPUTER_ACCESS_DENIED";
    }
    if (error.code === "CONFLICT") return "COMPUTER_TARGET_CHANGED";
  }
  return "COMPUTER_UNAVAILABLE";
}
