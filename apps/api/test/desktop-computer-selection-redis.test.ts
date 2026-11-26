import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  desktopComputerQuiesceLifetimeMs,
} from "@linksense/shared";
import {
  DesktopComputerRedisSelection,
  DesktopComputerSelectionError,
  desktopComputerSelectionKey,
  type DesktopComputerSelection,
} from "../src/modules/desktop-devices/computer-control.js";
import { RedisDesktopDeviceCoordinator, desktopDeviceConnectionKey } from "../src/modules/desktop-devices/coordinator.js";
import { desktopRunLeaseKey, DesktopRunLeases, type DesktopRunScope } from "../src/modules/desktop-credentials/run-leases.js";
import { localComputerGuiOccupancyKey, LocalComputerGuiOccupancy } from "../src/modules/local-computer/occupancy.js";
import { createRedisFixture } from "./fixtures/redis.js";

let redis: Awaited<ReturnType<typeof createRedisFixture>>;
let store: DesktopComputerRedisSelection;
let coordinator: RedisDesktopDeviceCoordinator;

beforeAll(async () => {
  redis = await createRedisFixture();
  store = new DesktopComputerRedisSelection(redis.client);
  coordinator = new RedisDesktopDeviceCoordinator(redis.client);
});
beforeEach(async () => { await redis.client.flushdb(); });
afterAll(async () => { await redis.close(); });

function scope(overrides: Partial<DesktopRunScope> = {}): DesktopRunScope {
  return {
    ownerId: randomUUID(), deviceId: randomUUID(), connectionId: randomUUID(),
    conversationId: randomUUID(), turnId: randomUUID(), runtimeGeneration: randomUUID(),
    ...overrides,
  };
}

function lease(
  value: DesktopRunScope,
  input: Partial<Pick<DesktopComputerSelection, "selectionId" | "bundleId" | "sessionId" | "expiresAt" | "state">> = {},
): DesktopComputerSelection {
  return {
    v: 1, state: "active",
    ownerId: value.ownerId, deviceId: value.deviceId, conversationId: value.conversationId,
    turnId: value.turnId, runtimeGeneration: value.runtimeGeneration, connectionId: value.connectionId,
    sessionId: input.sessionId ?? randomUUID(), selectionId: input.selectionId ?? randomUUID(),
    bundleId: input.bundleId ?? "com.example.Fixture",
    controlEpoch: randomUUID(),
    expiresAt: input.expiresAt ?? Date.now() + 5 * 60_000,
    pendingInput: null,
    ...(input.state ? { state: input.state } : {}),
  };
}

async function online(value: DesktopRunScope, connectionId = value.connectionId) {
  await coordinator.connect(value.deviceId, connectionId);
  const scoped = { ...value, connectionId };
  await bindRun(scoped);
  return scoped;
}

async function bindRun(value: DesktopRunScope) {
  await redis.client.set(desktopRunLeaseKey(value.turnId), JSON.stringify({
    scope: value, expiresAt: Date.now() + 10 * 60_000,
    runHash: "a".repeat(64), models: {},
  }), "PX", 10 * 60_000);
}

async function revokeRun(value: DesktopRunScope) {
  await redis.client.set(desktopRunLeaseKey(value.turnId), "revoked", "PX", 10 * 60_000);
}

async function putHolder(
  value: DesktopRunScope,
  input: { selectionId: string; sessionId: string; holderId?: string; expiresAt?: number },
) {
  const holderId = input.holderId ?? randomUUID();
  await redis.client.set(localComputerGuiOccupancyKey(value.deviceId), JSON.stringify({
    v: 1, holderId, expiresAt: input.expiresAt ?? Date.now() + 45_000,
    scope: value, sessionId: input.sessionId, bundleId: "com.example.Fixture", selectionId: input.selectionId,
  }), "PX", 60_000);
  return holderId;
}

async function expectSelectionError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(DesktopComputerSelectionError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("M1b product selection Redis CAS", () => {
  it("stores one selection and refuses an equal-expiry same-session replay without rewriting it", async () => {
    const value = await online(scope());
    const next = lease(value);
    const selected = await store.select(value, next, []);
    expect(selected).toMatchObject({ ...next, expiresAt: next.expiresAt });
    expect(await store.read(value)).toMatchObject({ selectionId: next.selectionId, sessionId: next.sessionId });
    const ttl = await redis.client.pttl(desktopComputerSelectionKey(value));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(next.expiresAt - Date.now() + desktopComputerQuiesceLifetimeMs + 1_000);
    // An identical replay is not a strictly later renewal. It is a legitimate
    // non-success that leaves the live selection untouched.
    await expectSelectionError(store.renew(value, next, selected), "COMPUTER_TIMEOUT");
    expect(await store.read(value)).toEqual(selected);
    expect(await redis.client.pttl(desktopComputerSelectionKey(value))).toBeGreaterThan(0);
  });

  it("refuses an equal or backward same-session renewal without changing the epoch or holder", async () => {
    const occupancy = new LocalComputerGuiOccupancy(redis.client);
    const value = await online(scope());
    const first = lease(value);
    const selected = await store.select(value, first, []);
    const holder = await putHolder(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
    });

    // A changed epoch alone cannot turn an equal expiry into a renewal.
    await expectSelectionError(store.renew(value, lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId, expiresAt: selected.expiresAt,
    }), selected), "COMPUTER_TIMEOUT");
    expect(await store.read(value)).toEqual(selected);
    expect((await occupancy.read(value.deviceId))?.holderId).toBe(holder);

    // A backward expiry is also a non-success that writes nothing.
    await expectSelectionError(store.renew(value, lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
      expiresAt: selected.expiresAt - 60_000,
    }), selected), "COMPUTER_TIMEOUT");
    expect(await store.read(value)).toEqual(selected);
    expect((await occupancy.read(value.deviceId))?.holderId).toBe(holder);

    // Only a strictly later expiry renews, keeping the session and holder and
    // advancing the epoch.
    const renewed = await store.renew(value, lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
      expiresAt: selected.expiresAt + 60_000,
    }), selected);
    expect(renewed.sessionId).toBe(selected.sessionId);
    expect(renewed.selectionId).toBe(selected.selectionId);
    expect(renewed.expiresAt).toBe(selected.expiresAt + 60_000);
    expect(renewed.controlEpoch).not.toBe(selected.controlEpoch);
    expect((await occupancy.read(value.deviceId))?.holderId).toBe(holder);
  });

  it("renews the same live session by extending expiry and advancing the control epoch", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const renewal = lease(value, {
      selectionId: first.selectionId, sessionId: first.sessionId,
      expiresAt: first.expiresAt + 60_000,
    });
    const renewed = await store.renew(value, renewal, first);
    expect(renewed.sessionId).toBe(first.sessionId);
    expect(renewed.selectionId).toBe(first.selectionId);
    expect(renewed.expiresAt).toBe(renewal.expiresAt);
    expect(renewed.controlEpoch).toBe(renewal.controlEpoch);
    expect(renewed.controlEpoch).not.toBe(first.controlEpoch);
    expect(await store.read(value)).toMatchObject({
      controlEpoch: renewal.controlEpoch, expiresAt: renewal.expiresAt,
    });
  });

  it("refuses a renewal when the previous lease expired, vanished, or was replaced before the CAS", async () => {
    const value = await online(scope());
    const first = lease(value);
    const selected = await store.select(value, first, []);
    const candidate = lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
      expiresAt: selected.expiresAt + 60_000,
    });

    // The locked caller verified the live snapshot, but Redis TIME crossed its
    // expiry before the CAS. A renewal must not recreate fresh metadata.
    const expiredSnapshot: DesktopComputerSelection = { ...selected, expiresAt: Date.now() - 1_000 };
    await redis.client.set(
      desktopComputerSelectionKey(value), JSON.stringify(expiredSnapshot), "PX", 30_000,
    );
    await expectSelectionError(store.renew(value, candidate, selected), "COMPUTER_TIMEOUT");
    expect(await redis.client.get(desktopComputerSelectionKey(value)))
      .toBe(JSON.stringify(expiredSnapshot));

    // A vanished key is not a first select either.
    await redis.client.del(desktopComputerSelectionKey(value));
    await expectSelectionError(store.renew(value, candidate, selected), "COMPUTER_TIMEOUT");
    expect(await store.read(value)).toBeNull();

    // A concurrent replacement under the same key scope is refused, not
    // overwritten, even when the candidate window would strictly advance.
    const live = await store.select(value, lease(value), []);
    const next = lease(value, {
      selectionId: live.selectionId, sessionId: live.sessionId,
      expiresAt: live.expiresAt + 60_000,
    });
    const replacement: DesktopComputerSelection = { ...live, controlEpoch: randomUUID() };
    await redis.client.set(
      desktopComputerSelectionKey(value), JSON.stringify(replacement), "PX", 60_000,
    );
    await expectSelectionError(store.renew(value, next, live), "COMPUTER_TARGET_CHANGED");
    expect(await redis.client.get(desktopComputerSelectionKey(value)))
      .toBe(JSON.stringify(replacement));
  });

  it("refuses a renewal whose live previous version differs in any exact field", async () => {
    const value = await online(scope());
    const selected = await store.select(value, lease(value), []);
    const candidate = lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
      expiresAt: selected.expiresAt + 60_000,
    });
    const cases: Array<{ replacement: DesktopComputerSelection; code: string }> = [
      { replacement: { ...selected, controlEpoch: randomUUID() }, code: "COMPUTER_TARGET_CHANGED" },
      { replacement: { ...selected, sessionId: randomUUID() }, code: "COMPUTER_TARGET_CHANGED" },
      { replacement: { ...selected, selectionId: randomUUID() }, code: "COMPUTER_TARGET_CHANGED" },
      { replacement: { ...selected, bundleId: "com.example.Other" }, code: "COMPUTER_TARGET_CHANGED" },
      { replacement: { ...selected, state: "paused" }, code: "COMPUTER_TARGET_CHANGED" },
      { replacement: { ...selected, state: "stopped" }, code: "COMPUTER_TARGET_CHANGED" },
      {
        replacement: {
          ...selected,
          pendingInput: {
            holderId: randomUUID(), controlEpoch: selected.controlEpoch,
            admittedAt: Date.now(), commandId: randomUUID(),
          },
        },
        code: "COMPUTER_TARGET_CHANGED",
      },
      { replacement: { ...selected, ownerId: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
      { replacement: { ...selected, deviceId: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
      { replacement: { ...selected, connectionId: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
      { replacement: { ...selected, conversationId: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
      { replacement: { ...selected, turnId: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
      { replacement: { ...selected, runtimeGeneration: randomUUID() }, code: "COMPUTER_UNAVAILABLE" },
    ];
    for (const { replacement, code } of cases) {
      await redis.client.set(
        desktopComputerSelectionKey(value), JSON.stringify(replacement), "PX", 60_000,
      );
      await expectSelectionError(store.renew(value, candidate, selected), code);
      expect(await redis.client.get(desktopComputerSelectionKey(value)))
        .toBe(JSON.stringify(replacement));
    }
  });

  it("keeps same-id same-session continuation out of the first-select lane", async () => {
    const value = await online(scope());
    const first = lease(value);
    const selected = await store.select(value, first, []);
    const candidate = lease(value, {
      selectionId: selected.selectionId, sessionId: selected.sessionId,
      expiresAt: selected.expiresAt + 60_000,
    });

    // A plain select is not an implicit renewal, even with the exact previous
    // session id supplied as an ended replacement.
    await expectSelectionError(store.select(value, candidate, []), "COMPUTER_TARGET_CHANGED");
    await expectSelectionError(
      store.select(value, candidate, [selected.sessionId]), "COMPUTER_TARGET_CHANGED",
    );
    expect(await store.read(value)).toEqual(selected);

    // The fallthrough after an expired previous lease is not a renewal either:
    // only the explicit exact-previous-version CAS may advance the live window.
    const expiredSnapshot: DesktopComputerSelection = { ...selected, expiresAt: Date.now() - 1_000 };
    await redis.client.set(
      desktopComputerSelectionKey(value), JSON.stringify(expiredSnapshot), "PX", 30_000,
    );
    await expectSelectionError(store.select(value, candidate, []), "COMPUTER_TARGET_CHANGED");
    expect(await redis.client.get(desktopComputerSelectionKey(value)))
      .toBe(JSON.stringify(expiredSnapshot));

    // A genuinely fresh picker id still uses the first-select lane after the
    // previous metadata expired.
    const fresh = lease(value);
    expect(await store.select(value, fresh, [])).toMatchObject({ selectionId: fresh.selectionId });
  });

  it("refuses to renew a live selection while input is pending and writes an idle renewal", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const holder = await putHolder(value, { selectionId: first.selectionId, sessionId: first.sessionId });
    const commandId = randomUUID();
    expect(await store.claimInput(value, first, holder, commandId)).toBe(true);

    const renewal = lease(value, {
      selectionId: first.selectionId, sessionId: first.sessionId,
      expiresAt: first.expiresAt + 60_000,
    });
    // The live metadata inside the CAS still carries the admitted act, even
    // when a caller's outer read no longer shows it.
    await expectSelectionError(store.renew(value, renewal, first), "COMPUTER_TARGET_CHANGED");
    expect(await store.read(value)).toMatchObject({
      sessionId: first.sessionId, controlEpoch: first.controlEpoch,
      pendingInput: { holderId: holder, commandId },
    });

    // The exact terminal result clears only this command's proof. The
    // deliberate idle renewal is then accepted with a known-idle marker.
    expect(await store.clearInput(value, first, holder, commandId)).toBe(true);
    const renewed = await store.renew(value, renewal, first);
    expect(renewed.controlEpoch).toBe(renewal.controlEpoch);
    expect(renewed.pendingInput).toBeNull();
    expect((await store.read(value))?.pendingInput).toBeNull();

    // An outer snapshot that still carries the pre-renewal marker cannot
    // resurrect it into the renewed epoch.
    const stale = lease(value, {
      selectionId: renewed.selectionId, sessionId: renewed.sessionId,
      expiresAt: renewed.expiresAt + 60_000,
    });
    stale.pendingInput = {
      holderId: holder, controlEpoch: first.controlEpoch, admittedAt: Date.now(), commandId,
    };
    const second = await store.renew(value, stale, renewed);
    expect(second.pendingInput).toBeNull();
    expect((await store.read(value))?.pendingInput).toBeNull();
  });

  it("replaces an ended session for the same active selection but refuses a different one", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const renewed = lease(value, { selectionId: first.selectionId });
    expect(await store.select(value, renewed, [first.sessionId]))
      .toMatchObject({ sessionId: renewed.sessionId, selectionId: first.selectionId });

    const other = lease(value, { selectionId: randomUUID() });
    await expectSelectionError(store.select(value, other, [renewed.sessionId]), "COMPUTER_TARGET_CHANGED");
    await expectSelectionError(store.select(value, lease(value, {
      selectionId: renewed.selectionId, bundleId: "com.example.Other", sessionId: renewed.sessionId,
    }), [renewed.sessionId]), "COMPUTER_TARGET_CHANGED");
    // The renewed selection is untouched.
    expect(await store.read(value)).toMatchObject({ sessionId: renewed.sessionId });
  });

  it("refuses a new select while paused, replaces after stop and after expiry, and never writes from a stale connection", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    await store.pause(value, first.selectionId);
    await expectSelectionError(store.select(value, lease(value, { selectionId: first.selectionId }), []), "COMPUTER_TARGET_CHANGED");

    const stopped = await store.stop(value, first.selectionId);
    expect(stopped.state).toBe("stopped");
    const afterStop = lease(value, { selectionId: randomUUID() });
    expect(await store.select(value, afterStop, [])).toMatchObject({ selectionId: afterStop.selectionId });

    const expiredScope = await online(scope());
    const expired = lease(expiredScope, { expiresAt: Date.now() - 1_000 });
    await redis.client.set(desktopComputerSelectionKey(expiredScope), JSON.stringify(expired), "PX", 30_000);
    const replacement = lease(expiredScope);
    expect(await store.select(expiredScope, replacement, [])).toMatchObject({ selectionId: replacement.selectionId });

    // A replaced live connection cannot write its old selection; a deliberate
    // select on the new connection replaces it under the same run key.
    const superseded = await online(scope());
    const old = lease(superseded);
    await store.select(superseded, old, []);
    const newConnectionId = randomUUID();
    await coordinator.connect(superseded.deviceId, newConnectionId);
    const replacementScope = { ...superseded, connectionId: newConnectionId };
    await bindRun(replacementScope);
    await expectSelectionError(store.select(superseded, lease(superseded), []), "COMPUTER_UNAVAILABLE");
    await expectSelectionError(store.pause(superseded, old.selectionId), "COMPUTER_UNAVAILABLE");
    const newer = lease(replacementScope);
    expect(await store.select(replacementScope, newer, [])).toMatchObject({ selectionId: newer.selectionId });
  });

  it("fails closed on malformed stored metadata without replacing it", async () => {
    const value = await online(scope());
    await redis.client.set(desktopComputerSelectionKey(value), "{not-json", "PX", 30_000);
    await expectSelectionError(store.select(value, lease(value), []), "COMPUTER_UNAVAILABLE");
    expect(await redis.client.get(desktopComputerSelectionKey(value))).toBe("{not-json");
    expect(await store.read(value)).toBeNull();
  });

  it("requires the exact native pause ack state and an explicit fresh resume selection", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const pausing = await store.pause(value, first.selectionId);
    expect(pausing.state).toBe("pausing");
    expect((await store.pause(value, first.selectionId)).state).toBe("pausing");
    const paused = await store.confirmPause(value, first);
    expect(paused.state).toBe("paused");
    expect((await store.confirmPause(value, first)).state).toBe("paused");

    await expectSelectionError(store.resume(value, first.selectionId, first.selectionId), "COMPUTER_TARGET_CHANGED");
    const nextSelection = randomUUID();
    const resumed = await store.resume(value, first.selectionId, nextSelection);
    expect(resumed).toMatchObject({ state: "active", selectionId: nextSelection, sessionId: first.sessionId });
    // A true paused->active commit rotates the server control epoch; a lost-ack
    // retry of the already-active successor writes nothing and keeps it.
    expect(resumed.controlEpoch).not.toBe(first.controlEpoch);
    expect(await store.resume(value, first.selectionId, nextSelection)).toMatchObject({
      selectionId: nextSelection, controlEpoch: resumed.controlEpoch,
    });

    // A paused selection cannot be resumed after expiry, and pause of an
    // expired selection never claims success.
    const expired = await online(scope());
    const expiredLease = lease(expired, { expiresAt: Date.now() - 1_000 });
    await redis.client.set(desktopComputerSelectionKey(expired), JSON.stringify(expiredLease), "PX", 30_000);
    await expectSelectionError(store.pause(expired, expiredLease.selectionId), "COMPUTER_TIMEOUT");
    await redis.client.set(
      desktopComputerSelectionKey(expired),
      JSON.stringify({ ...expiredLease, state: "paused" }), "PX", 30_000,
    );
    await expectSelectionError(store.resume(expired, expiredLease.selectionId, randomUUID()), "COMPUTER_TIMEOUT");
  });

  it("stops an expired holder for the native terminal proof and compare-clears only its own selection", async () => {
    const value = await online(scope());
    const expired = lease(value, { expiresAt: Date.now() - 1_000 });
    await redis.client.set(desktopComputerSelectionKey(value), JSON.stringify(expired), "PX", 30_000);
    const stopped = await store.stop(value, expired.selectionId);
    expect(stopped.state).toBe("stopped");
    expect((await redis.client.pttl(desktopComputerSelectionKey(value)))).toBeGreaterThan(0);
    await expectSelectionError(store.stop(value, randomUUID()), "COMPUTER_TARGET_CHANGED");

    const first = lease(value);
    expect(await store.clear(value, first)).toBe(false);
    expect((await store.read(value))?.selectionId).toBe(expired.selectionId);
    const current = await store.read(value);
    if (!current) throw new Error("selection missing");
    // The exact CAS also compares the live session, control epoch, and expiry:
    // stale generation metadata with the same selection/connection never
    // clears the newer six-field binding.
    expect(await store.clear(value, { ...current, sessionId: randomUUID() })).toBe(false);
    expect(await store.clear(value, { ...current, controlEpoch: randomUUID() })).toBe(false);
    expect(await store.clear(value, { ...current, expiresAt: current.expiresAt + 1 })).toBe(false);
    expect(await store.clear(value, { ...current, connectionId: randomUUID() })).toBe(false);
    expect(await store.read(value)).toMatchObject({
      sessionId: current.sessionId, controlEpoch: current.controlEpoch, expiresAt: current.expiresAt,
    });
    expect(await store.clear(value, current)).toBe(true);
    expect(await store.read(value)).toBeNull();
  });

  it("does not let pre-renewal metadata clear the renewed same-id selection", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const renewal = lease(value, {
      selectionId: first.selectionId, sessionId: first.sessionId,
      expiresAt: first.expiresAt + 60_000,
    });
    const renewed = await store.renew(value, renewal, first);
    // The same selection id and connection are not enough: the old session,
    // epoch, and expiry must also match the live metadata.
    expect(await store.clear(value, first)).toBe(false);
    expect(await store.read(value)).toMatchObject({
      controlEpoch: renewed.controlEpoch, expiresAt: renewed.expiresAt,
    });
    expect(await store.clear(value, renewed)).toBe(true);
    expect(await store.read(value)).toBeNull();
  });

  it("keeps the selection key stable across a connection change and compares the live connection", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    expect(desktopComputerSelectionKey(value)).toBe(desktopComputerSelectionKey({
      ownerId: value.ownerId, deviceId: value.deviceId, conversationId: value.conversationId,
      turnId: value.turnId, runtimeGeneration: value.runtimeGeneration,
    }));
    expect(await redis.client.get(desktopDeviceConnectionKey(value.deviceId))).toBe(value.connectionId);
  });

  it("requires the exact live run lease for select and resume", async () => {
    const missing = scope();
    await coordinator.connect(missing.deviceId, missing.connectionId);
    await expectSelectionError(store.select(missing, lease(missing), []), "COMPUTER_UNAVAILABLE");
    expect(await store.read(missing)).toBeNull();

    const value = await online(scope());
    await revokeRun(value);
    await expectSelectionError(store.select(value, lease(value), []), "COMPUTER_UNAVAILABLE");
    expect(await store.read(value)).toBeNull();

    await bindRun(value);
    const first = lease(value);
    await store.select(value, first, []);
    await store.pause(value, first.selectionId);
    await store.confirmPause(value, first);
    await revokeRun(value);
    await expectSelectionError(
      store.resume(value, first.selectionId, randomUUID()), "COMPUTER_UNAVAILABLE",
    );
  });

  it("rechecks the exact run binding inside the CAS after a first check passed", async () => {
    const leases = new DesktopRunLeases(redis.client, async () => true);
    const value = await online(scope());
    expect(await leases.hasActiveBinding(value)).toBe(true);
    // The first check passed, then the run was revoked before the CAS.
    await revokeRun(value);
    await expectSelectionError(store.select(value, lease(value), []), "COMPUTER_UNAVAILABLE");
    expect(await store.read(value)).toBeNull();

    // The same race with a rebound run scope at the same canonical turn key.
    await bindRun(value);
    expect(await leases.hasActiveBinding(value)).toBe(true);
    await bindRun({ ...value, connectionId: randomUUID() });
    await expectSelectionError(store.select(value, lease(value), []), "COMPUTER_UNAVAILABLE");
    expect(await store.read(value)).toBeNull();

    // A resume CAS rechecks it too.
    await bindRun(value);
    const first = lease(value);
    await store.select(value, first, []);
    await store.pause(value, first.selectionId);
    await store.confirmPause(value, first);
    await revokeRun(value);
    await expectSelectionError(
      store.resume(value, first.selectionId, randomUUID()), "COMPUTER_UNAVAILABLE",
    );
  });

  it("fails closed on legacy selection metadata with no pending-input state", async () => {
    const value = await online(scope());
    const legacy = JSON.parse(JSON.stringify(lease(value))) as Record<string, unknown>;
    delete legacy.pendingInput;
    await redis.client.set(desktopComputerSelectionKey(value), JSON.stringify(legacy), "PX", 30_000);
    expect(await store.read(value)).toBeNull();
    // An absent marker cannot prove that no input was admitted, so lifecycle
    // cleanup must not clear this metadata even with an exact six-field match.
    const legacySelection: DesktopComputerSelection = {
      ...lease(value),
      selectionId: String(legacy.selectionId),
      sessionId: String(legacy.sessionId),
      controlEpoch: String(legacy.controlEpoch),
      expiresAt: Number(legacy.expiresAt),
      pendingInput: null,
    };
    expect(await store.clear(value, legacySelection)).toBe(false);
    expect(await redis.client.exists(desktopComputerSelectionKey(value))).toBe(1);
    await expectSelectionError(store.pause(value, String(legacy.selectionId)), "COMPUTER_UNAVAILABLE");
    await expectSelectionError(store.stop(value, String(legacy.selectionId)), "COMPUTER_UNAVAILABLE");
    // The claim path also refuses rather than upgrading unprovable metadata.
    const holder = await putHolder(value, {
      selectionId: String(legacy.selectionId), sessionId: String(legacy.sessionId),
    });
    expect(await store.claimInput(value, lease(value, {
      selectionId: String(legacy.selectionId), sessionId: String(legacy.sessionId),
    }), holder, randomUUID())).toBe(false);
  });

  it("binds the pending act marker to the exact generated command and clears only that command", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const holder = await putHolder(value, { selectionId: first.selectionId, sessionId: first.sessionId });
    const commandA = randomUUID();
    const commandB = randomUUID();
    expect(await store.claimInput(value, first, holder, commandA)).toBe(true);
    expect((await store.read(value))?.pendingInput).toMatchObject({
      holderId: holder, commandId: commandA,
    });
    // One admitted native action at a time.
    expect(await store.claimInput(value, first, holder, randomUUID())).toBe(false);
    // A different holder or command UUID can never clear this proof.
    expect(await store.clearInput(value, first, randomUUID(), commandA)).toBe(false);
    expect(await store.clearInput(value, first, holder, randomUUID())).toBe(false);
    expect(await store.clearInput(value, first, holder, commandA)).toBe(true);
    expect((await store.read(value))?.pendingInput).toBeNull();

    // A late result for an older command must not clear a newer pending one.
    expect(await store.claimInput(value, first, holder, commandB)).toBe(true);
    expect(await store.clearInput(value, first, holder, commandA)).toBe(false);
    expect((await store.read(value))?.pendingInput).toMatchObject({ commandId: commandB });
    expect(await store.clearInput(value, first, holder, commandB)).toBe(true);

    const staleHolder = await putHolder(value, { selectionId: randomUUID(), sessionId: first.sessionId });
    expect(await store.claimInput(value, first, staleHolder, randomUUID())).toBe(false);
    expect((await store.read(value))?.pendingInput).toBeNull();
  });

  it("refuses lifecycle clear while the exact live selection owns an unproven act", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const holder = await putHolder(value, { selectionId: first.selectionId, sessionId: first.sessionId });
    const commandId = randomUUID();
    expect(await store.claimInput(value, first, holder, commandId)).toBe(true);

    // A cleanup started from an idle snapshot must re-check the live marker:
    // the possible act is not over merely because the run/connection was
    // fenced, so the selection and holder stay for the exact proof.
    const idleSnapshot: DesktopComputerSelection = { ...first, pendingInput: null };
    expect(await store.clear(value, idleSnapshot)).toBe(false);
    expect((await store.read(value))?.pendingInput).toMatchObject({ holderId: holder, commandId });

    // Only the exact terminal command clears the marker; a wrong UUID cannot.
    expect(await store.clearInput(value, first, holder, randomUUID())).toBe(false);
    expect((await store.read(value))?.pendingInput).toMatchObject({ commandId });
    expect(await store.clearInput(value, first, holder, commandId)).toBe(true);

    // Once the live marker is known idle the exact lifecycle clear proceeds.
    expect((await store.read(value))?.pendingInput).toBeNull();
    expect(await store.clear(value, idleSnapshot)).toBe(true);
    expect(await store.read(value)).toBeNull();
  });

  it("proves run, presence, and the exact active selection in one final snapshot", async () => {
    const value = await online(scope());
    const first = lease(value);
    const selected = await store.select(value, first, []);
    expect(await store.verifyActiveFinal(value, selected)).toBe(true);
    expect(await store.verifyActiveFinal(value, { ...selected, bundleId: "com.example.Other" })).toBe(false);
    expect(await store.verifyActiveFinal(value, { ...selected, controlEpoch: randomUUID() })).toBe(false);
    expect(await store.verifyActiveFinal(value, { ...selected, expiresAt: selected.expiresAt + 1 })).toBe(false);

    // A paused/stopped generation is never a positive active acknowledgement.
    await store.pause(value, selected.selectionId);
    expect(await store.verifyActiveFinal(value, selected)).toBe(false);
    await store.confirmPause(value, selected);
    await store.resume(value, selected.selectionId, randomUUID());
    const resumed = await store.read(value);
    if (!resumed) throw new Error("selection missing");
    expect(await store.verifyActiveFinal(value, resumed)).toBe(true);

    // A run revoke, a presence replacement, or a run rebound to the new
    // connection is observed even though the stored selection is unchanged.
    await revokeRun(value);
    expect(await store.verifyActiveFinal(value, resumed)).toBe(false);
    await bindRun(value);
    const replacementConnection = randomUUID();
    await coordinator.connect(value.deviceId, replacementConnection);
    expect(await store.verifyActiveFinal(value, resumed)).toBe(false);
    await bindRun({ ...value, connectionId: replacementConnection });
    expect(await store.verifyActiveFinal(value, resumed)).toBe(false);

    // The exact new generation on the replacement connection passes.
    const replacementScope = { ...value, connectionId: replacementConnection };
    const replacement = lease(replacementScope);
    const replacementSelected = await store.select(replacementScope, replacement, []);
    expect(await store.verifyActiveFinal(replacementScope, replacementSelected)).toBe(true);
  });

  it("keeps a different turn on the same live connection out while an act is pending", async () => {
    const occupancy = new LocalComputerGuiOccupancy(redis.client);
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    const holder = await putHolder(value, { selectionId: first.selectionId, sessionId: first.sessionId });
    const commandId = randomUUID();
    expect(await store.claimInput(value, first, holder, commandId)).toBe(true);

    const other = { ...value, turnId: randomUUID() };
    await bindRun(other);
    const otherLease = lease(other);
    await store.select(other, otherLease, []);
    expect(await occupancy.acquire({
      authorization: {
        scope: other, sessionId: otherLease.sessionId, grantId: randomUUID(),
        capability: "computer.observe", bundleId: otherLease.bundleId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
      selectionId: otherLease.selectionId,
    })).toEqual({ status: "device_busy" });
    // The pending holder belongs to the first turn and survives the attempt.
    expect((await occupancy.read(value.deviceId))?.holderId).toBe(holder);
    expect((await store.read(value))?.pendingInput).toMatchObject({ commandId });
  });

  it("writes bounded turn/device indexes and removes only the exact selection", async () => {
    const value = await online(scope());
    const first = lease(value);
    await store.select(value, first, []);
    expect(await store.scopesForTurn(value.turnId)).toEqual([value]);
    expect(await store.scopesForDevice(value.deviceId)).toEqual([value]);

    const secondScope = await online({
      ...scope(), deviceId: value.deviceId, connectionId: value.connectionId,
    });
    const second = lease(secondScope);
    await store.select(secondScope, second, []);
    expect((await store.scopesForDevice(value.deviceId)).map(item => item.turnId).sort())
      .toEqual([value.turnId, secondScope.turnId].sort());

    expect(await store.clear(value, first)).toBe(true);
    expect(await store.scopesForTurn(value.turnId)).toEqual([]);
    expect((await store.scopesForDevice(value.deviceId)).map(item => item.turnId))
      .toEqual([secondScope.turnId]);
    expect(await store.read(secondScope)).toMatchObject({ selectionId: second.selectionId });
  });
});
