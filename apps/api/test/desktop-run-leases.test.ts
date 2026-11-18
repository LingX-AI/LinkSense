import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { RunnerStartInput } from "../src/adapters/runner.js";
import { DesktopRunLeases, type DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
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
