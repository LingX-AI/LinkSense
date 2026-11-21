import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
import { RedisDesktopDeviceCoordinator } from "../src/modules/desktop-devices/coordinator.js";
import type { LocalComputerActionAuthorization } from "../src/modules/local-computer/authorization.js";
import {
  LocalComputerGuiOccupancy,
  localComputerGuiOccupancyKey,
  localComputerGuiOccupancyTtlMs,
} from "../src/modules/local-computer/occupancy.js";
import { createRedisFixture } from "./fixtures/redis.js";

let redis: Awaited<ReturnType<typeof createRedisFixture>>;
let coordinator: RedisDesktopDeviceCoordinator;
let occupancy: LocalComputerGuiOccupancy;

beforeAll(async () => {
  redis = await createRedisFixture();
  coordinator = new RedisDesktopDeviceCoordinator(redis.client);
  occupancy = new LocalComputerGuiOccupancy(redis.client);
});
afterAll(async () => { await redis?.close(); });

function scope(overrides: Partial<DesktopRunScope> = {}): DesktopRunScope {
  return {
    ownerId: randomUUID(),
    deviceId: randomUUID(),
    connectionId: randomUUID(),
    conversationId: randomUUID(),
    turnId: randomUUID(),
    runtimeGeneration: randomUUID(),
    ...overrides,
  };
}

function authorization(
  binding: DesktopRunScope,
  overrides: Partial<LocalComputerActionAuthorization> = {},
): LocalComputerActionAuthorization {
  return {
    scope: binding,
    sessionId: randomUUID(),
    grantId: randomUUID(),
    capability: "computer.observe",
    bundleId: "com.example.Fixture",
    expiresAt: new Date(Date.now() + 300_000),
    ...overrides,
  };
}

async function connect(binding: DesktopRunScope): Promise<void> {
  await coordinator.connect(binding.deviceId, binding.connectionId);
}

function acquired(result: Awaited<ReturnType<LocalComputerGuiOccupancy["acquire"]>>) {
  if (result.status !== "acquired") throw new Error(`Expected acquisition, received ${result.status}`);
  return result;
}

describe("local computer GUI occupancy", () => {
  it("reuses one server-chosen holder for the identical acquire and rejects a second run", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const access = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: access, selectionId }));
    const ttl = await redis.client.pttl(localComputerGuiOccupancyKey(binding.deviceId));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(localComputerGuiOccupancyTtlMs);

    expect(acquired(await occupancy.acquire({ authorization: access, selectionId }))).toEqual({
      status: "acquired", holderId: first.holderId, expiresAt: first.expiresAt, reused: true,
    });
    const competing = scope({ deviceId: binding.deviceId, connectionId: binding.connectionId });
    expect(await occupancy.acquire({ authorization: authorization(competing), selectionId }))
      .toEqual({ status: "device_busy" });

    const otherDevice = scope();
    await connect(otherDevice);
    expect(acquired(await occupancy.acquire({
      authorization: authorization(otherDevice), selectionId,
    })).reused).toBe(false);

    const stored: unknown = JSON.parse(await redis.client.get(localComputerGuiOccupancyKey(binding.deviceId)) ?? "null");
    expect(stored).toMatchObject({
      v: 1, holderId: first.holderId, scope: binding, sessionId: access.sessionId,
      bundleId: access.bundleId, selectionId,
    });
    expect(Object.keys(stored as object).sort()).toEqual(
      ["bundleId", "expiresAt", "holderId", "scope", "selectionId", "sessionId", "v"],
    );
  });

  it("rejects an old holder after connection replacement even when the current connection is presented", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const access = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: access, selectionId }));
    const replacementConnection = randomUUID();
    await coordinator.connect(binding.deviceId, replacementConnection);

    // The presence is current and the old holder id is genuine, but the stored scope still belongs to
    // the superseded connection. Match and refresh must not accept it.
    const forged = { ...access, scope: { ...binding, connectionId: replacementConnection } };
    expect(await occupancy.match({ authorization: forged, selectionId, holderId: first.holderId }))
      .toEqual({ status: "not_held", reason: "scope" });
    expect(await occupancy.refresh({ authorization: forged, selectionId, holderId: first.holderId }))
      .toEqual({ status: "not_held", reason: "scope" });

    const replacement = { ...binding, connectionId: replacementConnection, turnId: randomUUID() };
    const replacementAccess = authorization(replacement);
    const second = acquired(await occupancy.acquire({ authorization: replacementAccess, selectionId }));
    expect(second.holderId).not.toBe(first.holderId);
    expect(await occupancy.match({
      authorization: replacementAccess, selectionId, holderId: second.holderId,
    })).toMatchObject({ status: "held" });
  });

  it("caps match, refresh, and acquire reuse at the presented authorization expiry", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const key = localComputerGuiOccupancyKey(binding.deviceId);
    const longAccess = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: longAccess, selectionId }));

    const matchGrantEnd = Date.now() + 1_200;
    const matched = await occupancy.match({
      authorization: { ...longAccess, expiresAt: new Date(matchGrantEnd) },
      selectionId, holderId: first.holderId,
    });
    if (matched.status !== "held") throw new Error(`Expected held, received ${matched.status}`);
    expect(matched.expiresAt).toBeGreaterThan(Date.now());
    expect(matched.expiresAt).toBeLessThanOrEqual(matchGrantEnd);
    expect(await redis.client.pttl(key)).toBeLessThanOrEqual(1_200);

    const refreshGrantEnd = Date.now() + 700;
    const refreshed = await occupancy.refresh({
      authorization: { ...longAccess, expiresAt: new Date(refreshGrantEnd) },
      selectionId, holderId: first.holderId,
    });
    if (refreshed.status !== "refreshed") throw new Error(`Expected refreshed, received ${refreshed.status}`);
    expect(refreshed.expiresAt).toBeLessThanOrEqual(refreshGrantEnd);
    const refreshTtl = await redis.client.pttl(key);
    expect(refreshTtl).toBeGreaterThan(0);
    expect(refreshTtl).toBeLessThanOrEqual(700);

    // A later, longer grant cannot resurrect the old 45s expiry through match or acquire reuse.
    expect(await occupancy.match({
      authorization: longAccess, selectionId, holderId: first.holderId,
    })).toEqual({ status: "held", expiresAt: refreshed.expiresAt });
    expect(acquired(await occupancy.acquire({ authorization: longAccess, selectionId }))).toEqual({
      status: "acquired", holderId: first.holderId, expiresAt: refreshed.expiresAt, reused: true,
    });

    await delay(800);
    expect(await redis.client.exists(key)).toBe(0);
    // Only a fresh explicit observe acquires again.
    const replacement = acquired(await occupancy.acquire({ authorization: longAccess, selectionId }));
    expect(replacement.holderId).not.toBe(first.holderId);
  });

  it("never renews an already expired holder and leaves a valid holder untouched by expired authorization", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const key = localComputerGuiOccupancyKey(binding.deviceId);
    const access = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: access, selectionId }));

    const stored = JSON.parse(await redis.client.get(key) ?? "null");
    stored.expiresAt = Date.now() - 1_000;
    await redis.client.set(key, JSON.stringify(stored), "PX", 60_000);
    expect(await occupancy.refresh({ authorization: access, selectionId, holderId: first.holderId }))
      .toEqual({ status: "not_held", reason: "expired" });
    expect(await redis.client.exists(key)).toBe(0);

    const second = acquired(await occupancy.acquire({ authorization: access, selectionId }));
    expect(second.holderId).not.toBe(first.holderId);
    expect(await occupancy.acquire({
      authorization: { ...access, expiresAt: new Date(Date.now() - 1_000) }, selectionId,
    })).toEqual({ status: "not_held", reason: "expired" });
    expect(await redis.client.exists(key)).toBe(1);
    // A delayed expired permit is rejected, but it must not erase a holder still valid under a
    // newer authorization.
    expect(await occupancy.match({
      authorization: { ...access, expiresAt: new Date(Date.now() - 1_000) },
      selectionId, holderId: second.holderId,
    })).toEqual({ status: "not_held", reason: "expired" });
    expect(await redis.client.exists(key)).toBe(1);
    expect(await occupancy.match({
      authorization: access, selectionId, holderId: second.holderId,
    })).toMatchObject({ status: "held" });
  });

  it("does not let a delayed expired permit erase a holder refreshed by a live permit", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const key = localComputerGuiOccupancyKey(binding.deviceId);
    const access = authorization(binding);
    const oldPermit = { ...access, expiresAt: new Date(Date.now() + 800) };
    const livePermit = { ...access, expiresAt: new Date(Date.now() + 300_000) };
    const holder = acquired(await occupancy.acquire({ authorization: oldPermit, selectionId }));
    const refreshed = await occupancy.refresh({
      authorization: livePermit, selectionId, holderId: holder.holderId,
    });
    if (refreshed.status !== "refreshed") throw new Error(`Expected refreshed, received ${refreshed.status}`);

    await delay(900);
    expect(await occupancy.match({
      authorization: oldPermit, selectionId, holderId: holder.holderId,
    })).toEqual({ status: "not_held", reason: "expired" });
    expect(await occupancy.refresh({
      authorization: oldPermit, selectionId, holderId: holder.holderId,
    })).toEqual({ status: "not_held", reason: "expired" });
    expect(await redis.client.exists(key)).toBe(1);
    expect(await redis.client.pttl(key)).toBeGreaterThan(1_000);
    expect(await occupancy.match({
      authorization: livePermit, selectionId, holderId: holder.holderId,
    })).toEqual({ status: "held", expiresAt: refreshed.expiresAt });

    const secondTask = scope({ deviceId: binding.deviceId, connectionId: binding.connectionId });
    expect(await occupancy.acquire({ authorization: authorization(secondTask), selectionId }))
      .toEqual({ status: "device_busy" });
  });

  it("uses Redis time so a request delayed past grant expiry cannot write a lease", async () => {
    const binding = scope();
    await connect(binding);
    const access = authorization(binding, { expiresAt: new Date(Date.now() + 300) });
    const key = localComputerGuiOccupancyKey(binding.deviceId);
    await redis.client.call("CLIENT", "PAUSE", "700", "ALL");
    const started = Date.now();
    expect(await occupancy.acquire({ authorization: access, selectionId: randomUUID() }))
      .toEqual({ status: "not_held", reason: "expired" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(await redis.client.exists(key)).toBe(0);
  });

  it("denies malformed state and defers release/reacquire to the existing TTL", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const access = authorization(binding);
    const key = localComputerGuiOccupancyKey(binding.deviceId);
    await redis.client.set(key, "{not-json", "PX", 60_000);

    expect(await occupancy.match({ authorization: access, selectionId, holderId: randomUUID() }))
      .toEqual({ status: "not_held", reason: "malformed" });
    expect(await occupancy.refresh({ authorization: access, selectionId, holderId: randomUUID() }))
      .toEqual({ status: "not_held", reason: "malformed" });
    expect(await occupancy.release(binding.deviceId, randomUUID())).toBe(false);
    expect(await redis.client.exists(key)).toBe(1);
    expect(await occupancy.acquire({ authorization: access, selectionId }))
      .toEqual({ status: "device_busy" });

    // Structurally partial JSON is malformed too: no scope can be trusted for dispatch or takeover,
    // and even the exact stored holder id must not release it before the TTL.
    const malformedHolder = randomUUID();
    await redis.client.set(key, JSON.stringify({
      v: 1, holderId: malformedHolder, expiresAt: Date.now() + 60_000, scope: {},
    }), "PX", 60_000);
    expect(await occupancy.match({ authorization: access, selectionId, holderId: malformedHolder }))
      .toEqual({ status: "not_held", reason: "malformed" });
    expect(await occupancy.acquire({ authorization: access, selectionId }))
      .toEqual({ status: "device_busy" });
    expect(await occupancy.release(binding.deviceId, malformedHolder)).toBe(false);
    expect(await redis.client.exists(key)).toBe(1);

    await redis.client.pexpire(key, 1);
    await delay(20);
    expect(acquired(await occupancy.acquire({ authorization: access, selectionId })).reused).toBe(false);
  });

  it("refuses generation, device, session, bundle, holder, and capability mismatches", async () => {
    const binding = scope();
    await connect(binding);
    const otherDevice = scope();
    await connect(otherDevice);
    const selectionId = randomUUID();
    const access = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: access, selectionId }));

    const refresh = (
      candidate: LocalComputerActionAuthorization,
      selected = selectionId,
      holderId = first.holderId,
    ) => occupancy.refresh({ authorization: candidate, selectionId: selected, holderId });

    expect(await refresh({ ...access, scope: { ...binding, runtimeGeneration: randomUUID() } }))
      .toEqual({ status: "not_held", reason: "scope" });
    expect(await refresh({ ...access, scope: { ...binding, turnId: randomUUID() } }))
      .toEqual({ status: "not_held", reason: "scope" });
    expect(await refresh({ ...access, scope: otherDevice }))
      .toEqual({ status: "not_held", reason: "missing" });
    expect(await refresh({ ...access, sessionId: randomUUID() }))
      .toEqual({ status: "not_held", reason: "session" });
    expect(await refresh({ ...access, bundleId: "com.example.Other" }))
      .toEqual({ status: "not_held", reason: "bundle" });
    expect(await refresh(access, selectionId, randomUUID()))
      .toEqual({ status: "not_held", reason: "holder" });
    expect(await occupancy.match({
      authorization: access, selectionId, holderId: first.holderId,
    })).toMatchObject({ status: "held" });
    await expect(occupancy.acquire({
      authorization: { ...access, capability: "computer.act" }, selectionId,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets exactly one racing run win and gives identical racing acquires one holder", async () => {
    const device = scope();
    await connect(device);
    const selectionId = randomUUID();
    const replica = new LocalComputerGuiOccupancy(redis.client);
    const candidates = Array.from({ length: 8 }, () =>
      scope({ deviceId: device.deviceId, connectionId: device.connectionId }));
    const racing = await Promise.all(candidates.map((candidate, index) =>
      (index % 2 ? occupancy : replica).acquire({
        authorization: authorization(candidate), selectionId,
      })));
    const winners = racing.flatMap(result => result.status === "acquired" ? [result] : []);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.reused).toBe(false);
    expect(racing.filter(result => result.status === "device_busy")).toHaveLength(7);

    const identicalDevice = scope();
    await connect(identicalDevice);
    const identicalAccess = authorization(identicalDevice);
    const identical = await Promise.all(Array.from({ length: 8 }, (_value, index) =>
      (index % 2 ? replica : occupancy).acquire({
        authorization: identicalAccess, selectionId,
      })));
    const holders = identical.flatMap(result => result.status === "acquired" ? [result] : []);
    expect(holders).toHaveLength(8);
    expect(new Set(holders.map(result => result.holderId)).size).toBe(1);
    expect(holders.filter(result => !result.reused)).toHaveLength(1);
  });

  it("compares and releases by holder so a stale stop cannot remove a newer holder", async () => {
    const binding = scope();
    await connect(binding);
    const selectionId = randomUUID();
    const access = authorization(binding);
    const first = acquired(await occupancy.acquire({ authorization: access, selectionId }));

    expect(await occupancy.release(binding.deviceId, randomUUID())).toBe(false);
    expect(await occupancy.match({
      authorization: access, selectionId, holderId: first.holderId,
    })).toMatchObject({ status: "held" });
    expect(await occupancy.release(binding.deviceId, first.holderId)).toBe(true);
    expect(await occupancy.release(binding.deviceId, first.holderId)).toBe(false);
    expect(await occupancy.refresh({
      authorization: access, selectionId, holderId: first.holderId,
    })).toEqual({ status: "not_held", reason: "missing" });
    expect(await occupancy.match({
      authorization: access, selectionId, holderId: first.holderId,
    })).toEqual({ status: "not_held", reason: "missing" });
  });
});
