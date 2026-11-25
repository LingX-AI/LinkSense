import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RunnerStartInput } from "../src/adapters/runner.js";
import { conversationLockKey } from "../src/adapters/redis.js";
import {
  DesktopRunLeases,
  snapshotRecoveredDesktopRunLease,
  type DesktopRunScope,
} from "../src/modules/desktop-credentials/run-leases.js";
import { RedisDesktopDeviceCoordinator } from "../src/modules/desktop-devices/coordinator.js";
import { createRedisFixture } from "./fixtures/redis.js";

let redis: Awaited<ReturnType<typeof createRedisFixture>>;
beforeAll(async () => { redis = await createRedisFixture(); });
afterAll(async () => { await redis?.close(); });

function fixture() {
  const scope: DesktopRunScope = {
    ownerId: randomUUID(),
    deviceId: randomUUID(),
    connectionId: randomUUID(),
    conversationId: randomUUID(),
    turnId: randomUUID(),
    runtimeGeneration: randomUUID(),
  };
  const input = {
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
    projectionTurnId: scope.turnId,
    expectedRuntimeGeneration: scope.runtimeGeneration,
    model: "fixture-chat",
    modelProvider: {
      revision: 9, baseUrl: "https://fixture-provider.example.test/v1",
      apiKey: "fixture-primary-key", protocolMode: "native_responses",
      modelContextWindow: 32768,
      memoryExtraction: {
        model: "fixture-chat", reasoningEffort: "low", apiKey: "fixture-memory-key",
        protocolMode: "chat_completions_bridge", baseUrl: "https://memory-provider.example.test",
        pricing: {
          input_price_per_million: "0", cached_input_price_per_million: "0", output_price_per_million: "0",
        },
      },
    },
    modelTransitionSource: {
      model: "fixture-old-chat",
      provider: {
        revision: 8, apiKey: "fixture-transition-key", protocolMode: "responses_tool_compat",
        baseUrl: "https://transition-provider.example.test",
      },
    },
    environment: { LINKSENSE_RUNNER_SHARED_SECRET: "fixture-internal-secret" },
  } satisfies Pick<RunnerStartInput,
    "ownerId" | "conversationId" | "projectionTurnId" | "expectedRuntimeGeneration" |
    "model" | "modelProvider" | "modelTransitionSource" | "environment"
  >;
  return { input, scope };
}

describe("desktop run leases", () => {
  it("keeps artifact publication paused across replicas until both pending Stops release", async () => {
    const { input, scope } = fixture();
    const first = new DesktopRunLeases(redis.client, async () => true);
    const second = new DesktopRunLeases(redis.client, async () => true);
    const credentials = await first.issue(scope, input);
    const releaseFirst = await first.pauseArtifactPublication(scope.turnId.toUpperCase());
    const releaseSecond = await second.pauseArtifactPublication(scope.turnId);
    await releaseFirst();
    expect(await first.isArtifactPublicationPaused(scope.turnId)).toBe(true);
    await expect(first.verifyRunBinding(scope, credentials.run_token, "use")).resolves.toBeUndefined();
    await releaseSecond();
    expect(await second.isArtifactPublicationPaused(scope.turnId)).toBe(false);
  });

  it("accepts an exact settlement after model access is closed, until the run is revoked", async () => {
    const { input, scope } = fixture();
    const live = vi.fn(async (_scope: DesktopRunScope, phase: string) => phase === "issue" || phase === "settle");
    const leases = new DesktopRunLeases(redis.client, live);
    const credentials = await leases.issue(scope, input);

    await expect(leases.authorizeModel({ turnId: scope.turnId, ...credentials.primary }))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.verifyRunBinding(scope, credentials.run_token)).resolves.toBeUndefined();
    await expect(leases.verifyRunBinding({ ...scope, runtimeGeneration: randomUUID() }, credentials.run_token))
      .rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await leases.revoke(scope.turnId);
    await expect(leases.verifyRunBinding(scope, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("allows each credential to call only its own model and purpose without shipping or storing provider secrets", async () => {
    const { input, scope } = fixture();
    const live = vi.fn(async () => true);
    const issuer = new DesktopRunLeases(redis.client, live);
    const verify = new DesktopRunLeases(redis.client, live);
    const credentials = await issuer.issue(scope, input);
    expect(live).toHaveBeenCalledWith(scope, "issue");
    const stored = await redis.client.get(`linksense:desktop-run:${scope.turnId}`);
    expect(stored).not.toBeNull();
    const present = [credentials.primary, credentials.memory_extraction, credentials.transition_source];
    expect(present).toEqual([expect.any(Object), expect.any(Object), expect.any(Object)]);
    expect(new Set(present.map(model => model?.token)).size).toBe(3);
    for (const model of present) {
      if (!model) throw new Error("Missing fixture model grant");
      expect(stored).not.toContain(model.token);
      await expect(verify.authorizeModel({ turnId: scope.turnId, ...model })).resolves.toMatchObject({
        scope, revision: model.revision, protocolMode: model.protocol_mode,
      });
    }
    expect(stored).not.toContain(credentials.run_token);
    for (const secret of ["fixture-primary-key", "fixture-memory-key", "fixture-transition-key", "fixture-internal-secret", "example.test"]) {
      expect(stored).not.toContain(secret);
      expect(JSON.stringify(credentials)).not.toContain(secret);
    }
    const request = { turnId: scope.turnId, ...credentials.primary };
    await expect(verify.authorizeModel({ ...request, purpose: "memory_extraction" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(verify.authorizeModel({ ...request, model: "fixture-old-chat" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(verify.authorizeModel({ ...request, turnId: randomUUID() })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(verify.authorizeModel({ ...request, token: credentials.run_token })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(verify.verifyRunBinding(scope, credentials.run_token)).resolves.toBeUndefined();
    await expect(verify.verifyRunBinding({ ...scope, connectionId: randomUUID() }, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(verify.verifyRunBinding({ ...scope, conversationId: randomUUID() }, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("serializes duplicate issues across replicas and keeps a revoked turn sealed until expiration", async () => {
    const { input, scope } = fixture();
    const first = new DesktopRunLeases(redis.client, async () => true);
    const second = new DesktopRunLeases(redis.client, async () => true);
    const results = await Promise.allSettled([first.issue(scope, input), second.issue(scope, input)]);
    const issued = results.filter(result => result.status === "fulfilled");
    expect(issued).toHaveLength(1);
    const credentials = issued[0]?.value;
    if (!credentials) throw new Error("Expected one lease");
    await second.revoke(scope.turnId.toUpperCase());
    await expect(first.authorizeModel({ turnId: scope.turnId, ...credentials.primary })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(first.verifyRunBinding(scope, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(first.issue(scope, input)).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    expect(await redis.client.pttl(`linksense:desktop-run:${scope.turnId}`)).toBeGreaterThan(0);
  });

  it("denies new and existing credentials after the live binding is lost, and fences expiry independently of Redis", async () => {
    const { input, scope } = fixture();
    let now = 1_000;
    const live = vi.fn(async () => true);
    const leases = new DesktopRunLeases(redis.client, live, () => now);
    const credentials = await leases.issue(scope, input);
    const request = { turnId: scope.turnId, ...credentials.primary };
    live.mockResolvedValue(false);
    await expect(leases.authorizeModel(request)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.issue(scope, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    live.mockResolvedValue(true);
    now = Date.parse(credentials.expires_at);
    await expect(leases.authorizeModel(request)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.verifyRunBinding(scope, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects authorization when the lease is revoked during the live binding lookup", async () => {
    const { input, scope } = fixture();
    const live = vi.fn(async () => true);
    const leases = new DesktopRunLeases(redis.client, live);
    const credentials = await leases.issue(scope, input);
    live.mockImplementationOnce(async () => {
      await leases.revoke(scope.turnId);
      return true;
    });
    await expect(leases.authorizeModel({ turnId: scope.turnId, ...credentials.primary })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("seals the turn when cancellation wins before the issuer writes any credential", async () => {
    const { input, scope } = fixture();
    const cancel = new DesktopRunLeases(redis.client, async () => true);
    const issue = new DesktopRunLeases(redis.client, async () => {
      await cancel.revoke(scope.turnId);
      return true;
    });
    await expect(issue.issue(scope, input)).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    expect(await redis.client.pttl(`linksense:desktop-run:${scope.turnId}`)).toBeGreaterThan(0);
  });

  it("extends a live run past its initial expiry without allowing an expired or revoked run to resume", async () => {
    const { input, scope } = fixture();
    let now = 1_000;
    const live = vi.fn(async () => true);
    const leases = new DesktopRunLeases(redis.client, live, () => now);
    const credentials = await leases.issue(scope, input);
    const initialExpiry = Date.parse(credentials.expires_at);
    now = initialExpiry - 1;
    const expiresAt = await leases.renew(scope);
    expect(expiresAt).toBeGreaterThan(initialExpiry);
    now = initialExpiry + 1;
    await expect(leases.authorizeModel({ turnId: scope.turnId, ...credentials.primary })).resolves.toMatchObject({ expiresAt });
    live.mockImplementationOnce(async () => {
      await leases.revoke(scope.turnId);
      return true;
    });
    await expect(leases.renew(scope)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.renew(scope)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });

  it("rejects a replaced connection without renewing or accepting its predecessor's lease", async () => {
    const { input, scope } = fixture();
    const coordinator = new RedisDesktopDeviceCoordinator(redis.client);
    const leases = new DesktopRunLeases(redis.client, current =>
      coordinator.isCurrentConnection(current.deviceId, current.connectionId),
    );
    await coordinator.connect(scope.deviceId, scope.connectionId);
    const credentials = await leases.issue(scope, input);
    const replacement = randomUUID();
    await coordinator.connect(scope.deviceId, replacement);
    await coordinator.disconnect(scope.deviceId, scope.connectionId);
    expect(await coordinator.isCurrentConnection(scope.deviceId, replacement)).toBe(true);
    await expect(leases.verifyRunBinding(scope, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.verifyRunBinding({ ...scope, connectionId: replacement }, credentials.run_token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(leases.authorizeModel({ turnId: scope.turnId, ...credentials.primary })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  });
});

describe("recovered desktop run lease retirement", () => {
  const stable = (scope: DesktopRunScope) => ({
    ownerId: scope.ownerId,
    deviceId: scope.deviceId,
    conversationId: scope.conversationId,
    turnId: scope.turnId,
    runtimeGeneration: scope.runtimeGeneration,
  });
  const leaseKey = (scope: DesktopRunScope) => `linksense:desktop-run:${scope.turnId}`;
  const lockCurrent = async (scope: DesktopRunScope, token: string) => {
    await redis.client.set(conversationLockKey(scope.conversationId), token, "PX", 120_000);
  };

  it("retires an exact old-connection grant only while the recovery lock is current", async () => {
    const { input, scope } = fixture();
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const token = randomUUID();
    await leases.issue(scope, input);
    await lockCurrent(scope, token);
    const retire = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    expect(retire).not.toBeNull();

    await expect(retire!()).resolves.toBe(true);
    expect(await redis.client.exists(leaseKey(scope))).toBe(0);
  });

  const lockMoves = [
    { name: "a reacquired lock", move: async (scope: DesktopRunScope) => { await lockCurrent(scope, randomUUID()); } },
    { name: "a released lock", move: async (scope: DesktopRunScope) => { await redis.client.del(conversationLockKey(scope.conversationId)); } },
  ];
  it.each(lockMoves)("keeps the grant when $name belongs to another recovery", async ({ move }) => {
    const { input, scope } = fixture();
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const token = randomUUID();
    await leases.issue(scope, input);
    await lockCurrent(scope, token);
    const retire = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await move(scope);

    expect(retire).not.toBeNull();
    await expect(retire!()).resolves.toBe(false);
    expect(await redis.client.exists(leaseKey(scope))).toBe(1);
  });

  it("keeps a newer grant with the same stable scope and a new connection issued after the snapshot", async () => {
    const { input, scope } = fixture();
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const token = randomUUID();
    await leases.issue(scope, input);
    await lockCurrent(scope, token);
    const retire = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);

    await redis.client.del(leaseKey(scope));
    const replacement = randomUUID();
    await leases.issue({ ...scope, connectionId: replacement }, input);
    const current = await redis.client.get(leaseKey(scope));
    expect(retire).not.toBeNull();
    await expect(retire!()).resolves.toBe(false);
    expect(await redis.client.get(leaseKey(scope))).toBe(current);
  });

  const replacements = [
    { name: "revoked", replace: async (scope: DesktopRunScope) => { await new DesktopRunLeases(redis.client, async () => true).revoke(scope.turnId); } },
    { name: "malformed", replace: async (scope: DesktopRunScope) => { await redis.client.set(leaseKey(scope), "{not-json"); } },
    { name: "foreign", replace: async (scope: DesktopRunScope) => {
      await redis.client.del(leaseKey(scope));
      await new DesktopRunLeases(redis.client, async () => true).issue({ ...scope, deviceId: randomUUID() }, fixtureInput(scope));
    } },
    { name: "generation-mismatched", replace: async (scope: DesktopRunScope) => {
      await redis.client.del(leaseKey(scope));
      const generation = randomUUID();
      await new DesktopRunLeases(redis.client, async () => true).issue(scope, fixtureInput(scope, generation));
    } },
  ];
  it.each(replacements)("succeeds without changing $name lease bytes", async ({ replace }) => {
    const { input, scope } = fixture();
    await new DesktopRunLeases(redis.client, async () => true).issue(scope, input);
    const token = randomUUID();
    await lockCurrent(scope, token);
    await replace(scope);
    const before = await redis.client.get(leaseKey(scope));
    const retire = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);

    await expect(retire()).resolves.toBe(true);
    expect(await redis.client.get(leaseKey(scope))).toBe(before);
  });

  it("keeps an unchanged non-deletable snapshot when the recovery lock was lost", async () => {
    const { scope } = fixture();
    const token = randomUUID();
    await lockCurrent(scope, token);
    await redis.client.set(leaseKey(scope), "revoked");
    const retire = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await redis.client.del(conversationLockKey(scope.conversationId));

    await expect(retire()).resolves.toBe(false);
    expect(await redis.client.get(leaseKey(scope))).toBe("revoked");
  });

  it("fails closed for an absent snapshot when the recovery lock was lost", async () => {
    const { scope } = fixture();
    const token = randomUUID();
    await lockCurrent(scope, token);
    const absent = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await redis.client.del(conversationLockKey(scope.conversationId));

    await expect(absent()).resolves.toBe(false);
    expect(await redis.client.exists(leaseKey(scope))).toBe(0);
  });

  it("settles an absent snapshot only while the lease remains absent", async () => {
    const { scope } = fixture();
    const token = randomUUID();
    await lockCurrent(scope, token);
    const absent = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);

    await expect(absent()).resolves.toBe(true);
    expect(await redis.client.exists(leaseKey(scope))).toBe(0);
  });

  it("fails closed when a lease appears after an absent snapshot", async () => {
    const { input, scope } = fixture();
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const token = randomUUID();
    await lockCurrent(scope, token);
    const absent = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await leases.issue(scope, input);
    const current = await redis.client.get(leaseKey(scope));

    await expect(absent()).resolves.toBe(false);
    expect(await redis.client.get(leaseKey(scope))).toBe(current);
  });

  it("does not mistake an empty stored value for an absent snapshot", async () => {
    const { scope } = fixture();
    const token = randomUUID();
    await lockCurrent(scope, token);
    const absent = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await redis.client.set(leaseKey(scope), "");

    await expect(absent()).resolves.toBe(false);
    expect(await redis.client.get(leaseKey(scope))).toBe("");

    const empty = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await expect(empty()).resolves.toBe(true);
    expect(await redis.client.get(leaseKey(scope))).toBe("");
  });

  it("treats a lease that expired after the snapshot as already retired", async () => {
    const { input, scope } = fixture();
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const token = randomUUID();
    await lockCurrent(scope, token);
    await leases.issue(scope, input);
    const present = await snapshotRecoveredDesktopRunLease(redis.client, stable(scope), token);
    await redis.client.pexpire(leaseKey(scope), 1);
    await new Promise(resolve => setTimeout(resolve, 10));

    await expect(present()).resolves.toBe(true);
    expect(await redis.client.exists(leaseKey(scope))).toBe(0);
  });
});

function fixtureInput(scope: DesktopRunScope, runtimeGeneration = scope.runtimeGeneration) {
  return {
    ownerId: scope.ownerId,
    conversationId: scope.conversationId,
    projectionTurnId: scope.turnId,
    expectedRuntimeGeneration: runtimeGeneration,
    model: "fixture-chat",
    modelProvider: {
      revision: 9, baseUrl: "https://fixture-provider.example.test/v1",
      apiKey: "fixture-primary-key", protocolMode: "native_responses" as const,
    },
  };
}
