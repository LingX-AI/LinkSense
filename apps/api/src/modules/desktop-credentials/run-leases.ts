import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  desktopModelPurposeSchema,
  desktopModelTokenSchema,
  desktopRunCredentialsSchema,
  desktopRunTokenSchema,
  reasoningEffortSchema,
  runnerNativeIdSchema,
  type DesktopModelPurpose,
  type DesktopRunCredentials,
  type ReasoningEffort,
} from "@linksense/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

import type { RunnerModelProviderRuntime, RunnerStartInput } from "../../adapters/runner.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { desktopNoticeChannel, type DesktopNotice } from "../desktop-devices/notices.js";

const leaseTtlMs = 10 * 60 * 1000;
const runIdSchema = z.uuid().transform(value => value.toLowerCase());
export const desktopRunScopeSchema = z.strictObject({
  ownerId: runIdSchema,
  deviceId: runIdSchema,
  connectionId: runIdSchema,
  conversationId: runIdSchema,
  turnId: runIdSchema,
  runtimeGeneration: runIdSchema,
});
const credentialHash = z.string().regex(/^[a-f0-9]{64}$/u);
const storedLeaseSchema = z.strictObject({
  scope: desktopRunScopeSchema,
  expiresAt: z.number().int().positive(),
  runHash: credentialHash,
  models: z.partialRecord(desktopModelPurposeSchema, z.strictObject({
    model: desktopRunCredentialsSchema.shape.primary.shape.model,
    revision: desktopRunCredentialsSchema.shape.primary.shape.revision,
    protocolMode: desktopRunCredentialsSchema.shape.primary.shape.protocol_mode,
    tokenHash: credentialHash,
    reasoningEffort: reasoningEffortSchema.optional(),
  })),
});

export type DesktopRunScope = z.infer<typeof desktopRunScopeSchema>;
type StoredLease = z.infer<typeof storedLeaseSchema>;
type ModelGrant = NonNullable<StoredLease["models"][DesktopModelPurpose]>;
type StartModels = Pick<RunnerStartInput,
  "ownerId" | "conversationId" | "projectionTurnId" | "expectedRuntimeGeneration" |
  "model" | "modelProvider" | "modelTransitionSource"
>;
export type DesktopRunAuthorizationPhase = "issue" | "use" | "transition" | "settle" | "artifact";
type RunAuthorization = (scope: DesktopRunScope, phase: DesktopRunAuthorizationPhase) => Promise<boolean>;

export class DesktopRunLeases {
  constructor(
    private readonly redis: Pick<Redis, "get" | "set" | "eval">,
    private readonly isActive: RunAuthorization,
    private readonly now: () => number = Date.now,
  ) {}

  async issue(
    binding: Pick<DesktopRunScope, "deviceId" | "connectionId">,
    input: StartModels,
  ): Promise<DesktopRunCredentials> {
    const scope = desktopRunScopeSchema.parse({
      ownerId: input.ownerId,
      deviceId: binding.deviceId,
      connectionId: binding.connectionId,
      conversationId: input.conversationId,
      turnId: input.projectionTurnId,
      runtimeGeneration: input.expectedRuntimeGeneration,
    });
    if (!await this.isActive(scope, "issue")) throw new AppError("FORBIDDEN");
    const expiresAt = this.now() + leaseTtlMs;
    const memory = input.modelProvider.memoryExtraction;
    const source = input.modelTransitionSource;
    const credentials = desktopRunCredentialsSchema.parse({
      turn_id: scope.turnId,
      expires_at: new Date(expiresAt).toISOString(),
      run_token: `lsdr_${randomToken(32)}`,
      primary: { purpose: "primary", ...projectProvider(input.model, input.modelProvider) },
      ...(memory && {
        memory_extraction: {
          purpose: "memory_extraction",
          model: memory.model,
          revision: input.modelProvider.revision,
          protocol_mode: memory.protocolMode,
          reasoning_effort: memory.reasoningEffort,
          token: `lsdm_${randomToken(32)}`,
        },
      }),
      ...(source && {
        transition_source: {
          purpose: "transition_source",
          ...projectProvider(source.model, source.provider),
        },
      }),
    });
    const lease: StoredLease = {
      scope,
      expiresAt,
      runHash: sha256(credentials.run_token),
      models: {
        primary: storeModel(credentials.primary),
        ...(credentials.memory_extraction && { memory_extraction: storeModel(credentials.memory_extraction) }),
        ...(credentials.transition_source && { transition_source: storeModel(credentials.transition_source) }),
      },
    };
    const saved = await this.redis.set(key(scope.turnId), JSON.stringify(lease), "PX", leaseTtlMs, "NX");
    if (saved !== "OK") throw new AppError("RUNNER_UNAVAILABLE");
    return credentials;
  }

  async discardUndelivered(turnId: string, runToken: string): Promise<void> {
    const leaseKey = key(runIdSchema.parse(turnId));
    const raw = await this.redis.get(leaseKey);
    const lease = parseLease(raw);
    if (!raw || !lease || !tokenMatches(runToken, lease.runHash)) return;
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('DEL', KEYS[1])",
      1, leaseKey, raw,
    );
  }

  async authorizeModel(input: {
    turnId: string;
    purpose: DesktopModelPurpose;
    token: string;
    model?: string;
  }): Promise<{
    scope: DesktopRunScope;
    model: string;
    revision: number;
    protocolMode: ModelGrant["protocolMode"];
    expiresAt: number;
    reasoningEffort?: ReasoningEffort;
  }> {
    const parsed = desktopModelTokenSchema.safeParse(input.token);
    if (!parsed.success || !desktopModelPurposeSchema.safeParse(input.purpose).success) throw new AppError("AUTH_REQUIRED");
    const lease = await this.authorize(input.turnId, candidate => {
      const grant = candidate.models[input.purpose];
      return grant !== undefined && (input.model === undefined || grant.model === input.model) &&
        tokenMatches(parsed.data, grant.tokenHash);
    }, input.purpose === "transition_source" ? "transition" : "use");
    const grant = lease.models[input.purpose];
    if (!grant) throw new AppError("AUTH_REQUIRED");
    return {
      scope: lease.scope, model: grant.model, revision: grant.revision,
      protocolMode: grant.protocolMode, expiresAt: lease.expiresAt,
      ...(grant.reasoningEffort === undefined ? {} : { reasoningEffort: grant.reasoningEffort }),
    };
  }

  /** Verifies the binding; the device gateway must still authorize the specific operation. */
  async verifyRunBinding(scope: DesktopRunScope, token: string, phase: "use" | "settle" = "settle"): Promise<void> {
    scope = desktopRunScopeSchema.parse(scope);
    if (!desktopRunTokenSchema.safeParse(token).success) throw new AppError("AUTH_REQUIRED");
    await this.authorize(scope.turnId, lease =>
      matchesScope(lease.scope, scope) && tokenMatches(token, lease.runHash),
      phase,
    );
  }

  /** Authenticates a short-lived result read outside the device socket. */
  async authorizeToolResult(turnId: string, token: string): Promise<DesktopRunScope> {
    if (!desktopRunTokenSchema.safeParse(token).success) throw new AppError("AUTH_REQUIRED");
    return (await this.authorize(turnId, lease => tokenMatches(token, lease.runHash))).scope;
  }

  async isActiveToolScope(scope: DesktopRunScope): Promise<boolean> {
    const expected = desktopRunScopeSchema.parse(scope);
    try {
      await this.authorize(expected.turnId, lease => matchesScope(expected, lease.scope));
      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === "AUTH_REQUIRED") return false;
      throw error;
    }
  }

  /** Use only while the corresponding database authority is locked. */
  async fenceRunBinding(scope: DesktopRunScope, token: string): Promise<void> {
    const lease = parseLease(await this.redis.get(key(scope.turnId)));
    if (!lease || lease.expiresAt <= this.now() || !matchesScope(lease.scope, scope) || !tokenMatches(token, lease.runHash)) {
      throw new AppError("AUTH_REQUIRED");
    }
  }

  /**
   * Tokenless exact binding read for callers that are already under the
   * conversation database lock (native select/resume carries no run bearer).
   *
   * The canonical Redis run lease is the durable authority for the exact
   * owner/device/connection/conversation/generation/turn; a missing,
   * malformed, expired, or `revoked` value is not a binding. The caller still
   * proves the locked database credential and materialized turn separately.
   */
  async hasActiveBinding(scope: DesktopRunScope): Promise<boolean> {
    const expected = desktopRunScopeSchema.parse(scope);
    const lease = parseLease(await this.redis.get(key(expected.turnId)));
    return lease !== null && lease.expiresAt > this.now() && matchesScope(expected, lease.scope);
  }

  async claimToolRequest(turnId: string, requestId: string): Promise<boolean> {
    const turn = runIdSchema.parse(turnId);
    const request = runIdSchema.parse(requestId);
    return await this.redis.set(`linksense:desktop-tool:${turn}:${request}`, "1", "PX", leaseTtlMs, "NX") === "OK";
  }

  /**
   * Claims one opaque native action ID per authorized turn. Unlike a tool
   * request UUID, the same native call ID cannot be dispatched again under a
   * new transport request. The bounded digest keeps the key length fixed.
   */
  async claimComputerNativeCall(turnId: string, nativeCallId: string): Promise<boolean> {
    const turn = runIdSchema.parse(turnId);
    const nativeCall = runnerNativeIdSchema.parse(nativeCallId);
    return await this.redis.set(
      `linksense:desktop-native-call:${turn}:${sha256(nativeCall)}`, "1", "PX", leaseTtlMs, "NX",
    ) === "OK";
  }

  async pauseArtifactPublication(turnId: string): Promise<() => Promise<void>> {
    const pauseKey = artifactPauseKey(turnId);
    const ticket = randomUUID();
    await this.redis.eval(`
      redis.call('HSET', KEYS[1], ARGV[1], '1')
      return redis.call('PEXPIRE', KEYS[1], ARGV[2])
    `, 1, pauseKey, ticket, String(leaseTtlMs));
    return async () => { await this.redis.eval("return redis.call('HDEL', KEYS[1], ARGV[1])", 1, pauseKey, ticket); };
  }

  async isArtifactPublicationPaused(turnId: string): Promise<boolean> {
    return await this.redis.eval("return redis.call('EXISTS', KEYS[1])", 1, artifactPauseKey(turnId)) === 1;
  }

  async renew(scope: DesktopRunScope): Promise<number> {
    scope = desktopRunScopeSchema.parse(scope);
    const leaseKey = key(scope.turnId);
    const raw = await this.redis.get(leaseKey);
    const lease = parseLease(raw);
    if (!lease || !raw || !matchesScope(lease.scope, scope) || lease.expiresAt <= this.now() ||
        !await this.isActive(scope, "use")) {
      throw new AppError("AUTH_REQUIRED");
    }
    const now = this.now();
    if (lease.expiresAt <= now) throw new AppError("AUTH_REQUIRED");
    const expiresAt = Math.max(now + leaseTtlMs, lease.expiresAt);
    // Only the socket owner renews, without overwriting a concurrent revocation.
    const renewed = await this.redis.eval(
      "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]); return 1",
      1, leaseKey, raw, JSON.stringify({ ...lease, expiresAt }), String(expiresAt - now),
    );
    if (renewed !== 1) throw new AppError("AUTH_REQUIRED");
    return expiresAt;
  }

  async revoke(turnId: string): Promise<void> {
    // The marker must also win if issuance has checked the DB but not yet written.
    const id = runIdSchema.parse(turnId);
    await this.redis.eval(
      "redis.call('SET', KEYS[1], 'revoked', 'PX', ARGV[1]); return redis.call('PUBLISH', ARGV[2], ARGV[3])",
      1, key(id), String(leaseTtlMs), desktopNoticeChannel,
      JSON.stringify({ type: "run_revoked", turnId: id } satisfies DesktopNotice),
    );
  }

  private async authorize(
    rawId: string,
    matches: (lease: StoredLease) => boolean,
    phase: Exclude<DesktopRunAuthorizationPhase, "issue"> = "use",
  ): Promise<StoredLease> {
    const parsed = runIdSchema.safeParse(rawId);
    if (!parsed.success) throw new AppError("AUTH_REQUIRED");
    const turnId = parsed.data;
    const leaseKey = key(turnId);
    const raw = await this.redis.get(leaseKey);
    const lease = parseLease(raw);
    if (!lease || lease.scope.turnId !== turnId || lease.expiresAt <= this.now() || !matches(lease)) {
      throw new AppError("AUTH_REQUIRED");
    }
    // Recheck after the DB/connection lookup so revocation cannot race a stale read.
    if (!await this.isActive(lease.scope, phase)) throw new AppError("AUTH_REQUIRED");
    const current = parseLease(await this.redis.get(leaseKey));
    if (!current || !matchesScope(lease.scope, current.scope) || !matches(current) || current.expiresAt <= this.now()) {
      throw new AppError("AUTH_REQUIRED");
    }
    return current;
  }
}

function key(turnId: string): string {
  return `linksense:desktop-run:${turnId}`;
}

/** Canonical run-lease key; shared with the selection Lua CAS so it cannot drift. */
export function desktopRunLeaseKey(turnId: string): string {
  return key(runIdSchema.parse(turnId));
}

function artifactPauseKey(turnId: string): string {
  return `${key(runIdSchema.parse(turnId))}:artifact-stop`;
}

function matchesScope(a: DesktopRunScope, b: DesktopRunScope): boolean {
  return a.turnId === b.turnId && a.ownerId === b.ownerId &&
    a.deviceId === b.deviceId && a.connectionId === b.connectionId &&
    a.conversationId === b.conversationId && a.runtimeGeneration === b.runtimeGeneration;
}

function parseLease(raw: string | null): StoredLease | null {
  if (raw === null || raw === "revoked") return null;
  try {
    const result = storedLeaseSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function projectProvider(model: string, provider: RunnerModelProviderRuntime): Omit<DesktopRunCredentials["primary"], "purpose"> {
  return {
    model,
    revision: provider.revision,
    protocol_mode: provider.protocolMode,
    token: `lsdm_${randomToken(32)}`,
    ...(provider.modelContextWindow === undefined ? {} : { context_window: provider.modelContextWindow }),
    ...(provider.modelAutoCompactTokenLimit === undefined ? {} : { auto_compact_token_limit: provider.modelAutoCompactTokenLimit }),
    ...(provider.supportsImageInput === undefined ? {} : { supports_image_input: provider.supportsImageInput }),
  };
}

function storeModel(input: Pick<DesktopRunCredentials["primary"], "model" | "revision" | "protocol_mode" | "token"> & {
  reasoning_effort?: ReasoningEffort;
}): ModelGrant {
  return {
    model: input.model, revision: input.revision, protocolMode: input.protocol_mode, tokenHash: sha256(input.token),
    ...(input.reasoning_effort === undefined ? {} : { reasoningEffort: input.reasoning_effort }),
  };
}

function tokenMatches(token: string, hash: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(token), "hex"), Buffer.from(hash, "hex"));
}
