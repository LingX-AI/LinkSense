import { timingSafeEqual } from "node:crypto";
import {
  desktopModelPurposeSchema,
  desktopModelTokenSchema,
  desktopRunCredentialsSchema,
  desktopRunTokenSchema,
  type DesktopModelPurpose,
  type DesktopRunCredentials,
} from "@linksense/shared";
import type { Redis } from "ioredis";
import { z } from "zod";

import type { RunnerModelProviderRuntime, RunnerStartInput } from "../../adapters/runner.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";

const leaseTtlMs = 10 * 60 * 1000;
const runIdSchema = z.uuid().transform(value => value.toLowerCase());
const scopeSchema = z.strictObject({
  ownerId: runIdSchema,
  deviceId: runIdSchema,
  connectionId: runIdSchema,
  conversationId: runIdSchema,
  turnId: runIdSchema,
  runtimeGeneration: runIdSchema,
});
const credentialHash = z.string().regex(/^[a-f0-9]{64}$/u);
const storedLeaseSchema = z.strictObject({
  scope: scopeSchema,
  expiresAt: z.number().int().positive(),
  runHash: credentialHash,
  models: z.partialRecord(desktopModelPurposeSchema, z.strictObject({
    model: desktopRunCredentialsSchema.shape.primary.shape.model,
    revision: desktopRunCredentialsSchema.shape.primary.shape.revision,
    protocolMode: desktopRunCredentialsSchema.shape.primary.shape.protocol_mode,
    tokenHash: credentialHash,
  })),
});

export type DesktopRunScope = z.infer<typeof scopeSchema>;
type StoredLease = z.infer<typeof storedLeaseSchema>;
type ModelGrant = NonNullable<StoredLease["models"][DesktopModelPurpose]>;
type StartModels = Pick<RunnerStartInput,
  "ownerId" | "conversationId" | "projectionTurnId" | "expectedRuntimeGeneration" |
  "model" | "modelProvider" | "modelTransitionSource"
>;
export type DesktopRunAuthorizationPhase = "issue" | "use";
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
    const scope = scopeSchema.parse({
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

  async authorizeModel(input: {
    turnId: string;
    purpose: DesktopModelPurpose;
    token: string;
    model: string;
  }): Promise<{ scope: DesktopRunScope; revision: number; protocolMode: ModelGrant["protocolMode"]; expiresAt: number }> {
    const parsed = desktopModelTokenSchema.safeParse(input.token);
    if (!parsed.success || !desktopModelPurposeSchema.safeParse(input.purpose).success) throw new AppError("AUTH_REQUIRED");
    const lease = await this.authorize(input.turnId, candidate => {
      const grant = candidate.models[input.purpose];
      return grant !== undefined && grant.model === input.model && tokenMatches(parsed.data, grant.tokenHash);
    });
    const grant = lease.models[input.purpose];
    if (!grant) throw new AppError("AUTH_REQUIRED");
    return { scope: lease.scope, revision: grant.revision, protocolMode: grant.protocolMode, expiresAt: lease.expiresAt };
  }

  /** Verifies the binding; the device gateway must still authorize the specific operation. */
  async verifyRunBinding(scope: DesktopRunScope, token: string): Promise<void> {
    scope = scopeSchema.parse(scope);
    if (!desktopRunTokenSchema.safeParse(token).success) throw new AppError("AUTH_REQUIRED");
    await this.authorize(scope.turnId, lease =>
      matchesScope(lease.scope, scope) && tokenMatches(token, lease.runHash),
    );
  }

  async renew(scope: DesktopRunScope): Promise<number> {
    scope = scopeSchema.parse(scope);
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
    await this.redis.set(key(runIdSchema.parse(turnId)), "revoked", "PX", leaseTtlMs);
  }

  private async authorize(rawId: string, matches: (lease: StoredLease) => boolean): Promise<StoredLease> {
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
    if (!await this.isActive(lease.scope, "use")) throw new AppError("AUTH_REQUIRED");
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
  };
}

function storeModel(input: Pick<DesktopRunCredentials["primary"], "model" | "revision" | "protocol_mode" | "token">): ModelGrant {
  return { model: input.model, revision: input.revision, protocolMode: input.protocol_mode, tokenHash: sha256(input.token) };
}

function tokenMatches(token: string, hash: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(token), "hex"), Buffer.from(hash, "hex"));
}
