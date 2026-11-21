import { describe, expect, it } from "vitest"

import {
  desktopDeviceSettingsHref,
  desktopExecutionAvailabilityMessageKey,
  desktopExecutionDeviceAvailability,
  desktopExecutionDeviceQueryAvailability,
  desktopExecutionFreshDeviceCheck,
  desktopExecutionLocalDeviceId,
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
})
