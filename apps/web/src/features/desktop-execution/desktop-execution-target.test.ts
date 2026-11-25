import { describe, expect, it } from "vitest"

import {
  desktopContinuationDestination,
  desktopDeviceSettingsHref,
  desktopExecutionAvailabilityMessageKey,
  desktopExecutionContinuationDeviceCheck,
  desktopExecutionDeviceAvailability,
  desktopExecutionDeviceQueryAvailability,
  desktopExecutionFreshDeviceCheck,
  desktopExecutionGatedDeviceAvailability,
  desktopExecutionLocalDeviceId,
  desktopExecutionTargetPolicy,
  shouldOfferDesktopContinuation,
  shouldOfferDesktopExecutionTarget,
} from "./desktop-execution-target"

describe("desktop execution availability", () => {
  it("treats an absent status as still checking", () => {
    expect(desktopExecutionDeviceAvailability(undefined)).toEqual({
      kind: "checking",
    })
  })

  it("requires a connected device with a live native execution link", () => {
    expect(
      desktopExecutionDeviceAvailability({
        state: "online",
        deviceId: "device-1",
        executionReady: true,
      })
    ).toEqual({ kind: "ready", deviceId: "device-1" })
    expect(
      desktopExecutionDeviceAvailability({
        state: "online",
        deviceId: "device-1",
        executionReady: false,
      })
    ).toEqual({ kind: "unavailable", reason: "not_ready" })
    expect(
      desktopExecutionDeviceAvailability({
        state: "online",
        deviceId: "device-1",
      })
    ).toEqual({ kind: "unavailable", reason: "not_ready" })
    expect(
      desktopExecutionDeviceAvailability({
        state: "online",
        executionReady: true,
      })
    ).toEqual({ kind: "unavailable", reason: "not_ready" })
  })

  it.each([
    ["connecting", "connecting"],
    ["offline", "offline"],
    ["unpaired", "unpaired"],
    ["revoked", "revoked"],
  ] as const)("reports a %s device as unavailable", (state, reason) => {
    expect(desktopExecutionDeviceAvailability({ state })).toEqual({
      kind: "unavailable",
      reason,
    })
  })

  it("returns a device id only for a ready local target", () => {
    expect(
      desktopExecutionLocalDeviceId("local", {
        kind: "ready",
        deviceId: "device-1",
      })
    ).toBe("device-1")
    expect(
      desktopExecutionLocalDeviceId("cloud", {
        kind: "ready",
        deviceId: "device-1",
      })
    ).toBeUndefined()
    expect(
      desktopExecutionLocalDeviceId("local", {
        kind: "unavailable",
        reason: "offline",
      })
    ).toBeUndefined()
  })

  it("fails closed on a query error, including stale retained data", () => {
    const staleReady = {
      state: "online" as const,
      deviceId: "device-1",
      executionReady: true,
    }
    expect(
      desktopExecutionDeviceQueryAvailability({
        data: staleReady,
        isError: true,
      })
    ).toEqual({ kind: "unavailable", reason: "status_unavailable" })
    expect(
      desktopExecutionDeviceQueryAvailability({
        data: undefined,
        isError: true,
      })
    ).toEqual({ kind: "unavailable", reason: "status_unavailable" })
    expect(
      desktopExecutionDeviceQueryAvailability({
        data: undefined,
        isError: false,
      })
    ).toEqual({ kind: "checking" })
    expect(
      desktopExecutionDeviceQueryAvailability({
        data: staleReady,
        isError: false,
      })
    ).toEqual({ kind: "ready", deviceId: "device-1" })
  })

  it("validates a fresh read against the selected device", () => {
    expect(
      desktopExecutionFreshDeviceCheck("device-1", {
        state: "online",
        deviceId: "device-1",
        executionReady: true,
      })
    ).toBe("ready")
    expect(
      desktopExecutionFreshDeviceCheck("device-1", {
        state: "online",
        deviceId: "device-2",
        executionReady: true,
      })
    ).toBe("changed")
    expect(
      desktopExecutionFreshDeviceCheck("device-1", {
        state: "online",
        deviceId: "device-1",
        executionReady: false,
      })
    ).toBe("unavailable")
    expect(
      desktopExecutionFreshDeviceCheck("device-1", {
        state: "offline",
        deviceId: "device-1",
        executionReady: true,
      })
    ).toBe("unavailable")
  })

  it("offers the picker only for a fresh task in the main Mac window", () => {
    const base = {
      isNew: true,
      showComposer: true,
      hasUser: true,
      isMacDesktopHost: true,
      embedded: false,
      development: false,
      isApplicationConversation: false,
    }
    expect(shouldOfferDesktopExecutionTarget(base)).toBe(true)
    for (const override of [
      { isNew: false },
      { showComposer: false },
      { hasUser: false },
      { isMacDesktopHost: false },
      { embedded: true },
      { development: true },
      { isApplicationConversation: true },
    ]) {
      expect(shouldOfferDesktopExecutionTarget({ ...base, ...override })).toBe(
        false
      )
    }
  })

  it("maps every unavailable reason to localized copy", () => {
    expect(
      desktopExecutionAvailabilityMessageKey({ kind: "ready", deviceId: "d" })
    ).toBeNull()
    expect(desktopExecutionAvailabilityMessageKey({ kind: "checking" })).toBe(
      "desktopExecution.deviceChecking"
    )
    expect(
      desktopExecutionAvailabilityMessageKey({
        kind: "unavailable",
        reason: "offline",
      })
    ).toBe("desktopExecution.deviceOffline")
    expect(
      desktopExecutionAvailabilityMessageKey({
        kind: "unavailable",
        reason: "revoked",
      })
    ).toBe("desktopExecution.deviceRevoked")
    expect(
      desktopExecutionAvailabilityMessageKey({
        kind: "unavailable",
        reason: "status_unavailable",
      })
    ).toBe("desktopExecution.deviceStatusUnavailable")
  })

  it("anchors device management in the settings section owned by the device UI", () => {
    expect(desktopDeviceSettingsHref).toBe(
      "/settings/general#desktop-devices-heading"
    )
  })

  it("derives the opposite target for a continuation", () => {
    expect(desktopContinuationDestination("local")).toBe("cloud")
    expect(desktopContinuationDestination("cloud")).toBe("local")
  })

  it("requires execution, a reference-capable Mac, and the same device", () => {
    const ready = {
      state: "online" as const,
      deviceId: "device-1",
      executionReady: true,
      conversationReferenceReadReady: true,
    }
    expect(desktopExecutionContinuationDeviceCheck("device-1", ready)).toEqual({
      kind: "ready",
      deviceId: "device-1",
    })
    expect(desktopExecutionContinuationDeviceCheck(undefined, ready)).toEqual({
      kind: "ready",
      deviceId: "device-1",
    })
    expect(desktopExecutionContinuationDeviceCheck("device-2", ready)).toEqual({
      kind: "changed",
    })
    expect(
      desktopExecutionContinuationDeviceCheck("device-1", {
        ...ready,
        executionReady: false,
      })
    ).toEqual({ kind: "unavailable" })
    expect(
      desktopExecutionContinuationDeviceCheck("device-1", {
        ...ready,
        conversationReferenceReadReady: false,
      })
    ).toEqual({ kind: "reference_unavailable" })
    expect(
      desktopExecutionContinuationDeviceCheck("device-1", {
        ...ready,
        deviceId: undefined,
      })
    ).toEqual({ kind: "unavailable" })
    expect(
      desktopExecutionContinuationDeviceCheck("device-1", {
        ...ready,
        state: "offline",
      })
    ).toEqual({ kind: "unavailable" })
  })

  it("offers a continuation only on a normal main Mac task", () => {
    const base = {
      isNew: false,
      showConversationActions: true,
      hasUser: true,
      isMacDesktopHost: true,
      embedded: false,
      development: false,
      readOnly: false,
      archived: false,
      application: false,
    }
    expect(shouldOfferDesktopContinuation(base)).toBe(true)
    for (const override of [
      { isNew: true },
      { showConversationActions: false },
      { hasUser: false },
      { isMacDesktopHost: false },
      { embedded: true },
      { development: true },
      { readOnly: true },
      { archived: true },
      { application: true },
    ]) {
      expect(shouldOfferDesktopContinuation({ ...base, ...override })).toBe(
        false
      )
    }
  })

  describe("desktop execution rollout policy", () => {
    it("keeps legacy availability when the bootstrap has no policy", () => {
      expect(desktopExecutionTargetPolicy(undefined)).toEqual({
        localComputer: true,
        cloudTarget: true,
      })
      expect(desktopExecutionTargetPolicy({})).toEqual({
        localComputer: true,
        cloudTarget: true,
      })
      expect(desktopExecutionTargetPolicy({ desktop: {} })).toEqual({
        localComputer: true,
        cloudTarget: true,
      })
    })

    it("applies each explicitly provided rollout flag independently", () => {
      expect(
        desktopExecutionTargetPolicy({ desktop: { local_computer: false } })
      ).toEqual({ localComputer: false, cloudTarget: true })
      expect(
        desktopExecutionTargetPolicy({ desktop: { cloud_target: false } })
      ).toEqual({ localComputer: true, cloudTarget: false })
      expect(
        desktopExecutionTargetPolicy({
          desktop: { local_computer: true, cloud_target: true },
        })
      ).toEqual({ localComputer: true, cloudTarget: true })
      expect(
        desktopExecutionTargetPolicy({
          desktop: { local_computer: false, cloud_target: false },
        })
      ).toEqual({ localComputer: false, cloudTarget: false })
    })

    it("closes local for a ready device when the rollout flag is off", () => {
      const ready = { kind: "ready" as const, deviceId: "device-1" }
      expect(desktopExecutionGatedDeviceAvailability(ready, false)).toEqual({
        kind: "unavailable",
        reason: "local_computer_disabled",
      })
      expect(desktopExecutionGatedDeviceAvailability(ready, true)).toEqual(
        ready
      )
    })

    it("keeps the existing device reasons when the rollout flag is on", () => {
      expect(
        desktopExecutionGatedDeviceAvailability(
          { kind: "unavailable", reason: "offline" },
          true
        )
      ).toEqual({ kind: "unavailable", reason: "offline" })
      expect(
        desktopExecutionGatedDeviceAvailability(
          { kind: "unavailable", reason: "offline" },
          false
        )
      ).toEqual({ kind: "unavailable", reason: "local_computer_disabled" })
      expect(
        desktopExecutionAvailabilityMessageKey({
          kind: "unavailable",
          reason: "local_computer_disabled",
        })
      ).toBe("desktopExecution.localComputerUnavailable")
    })
  })
})
