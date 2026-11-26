import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  mac: true,
  deviceStatus: vi.fn(),
  ensureDevice: vi.fn(),
  setLocalToolsEnabled: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => native.mac,
}))

vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    deviceStatus: native.deviceStatus,
    ensureDevice: native.ensureDevice,
    setLocalToolsEnabled: native.setLocalToolsEnabled,
  },
}))

import {
  ensureDesktopDeviceForAuthRestore,
  parseDesktopDeviceStatus,
  readDesktopDeviceStatus,
  setDesktopLocalToolsEnabled,
} from "./desktop-device-adapter"

const ownerId = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"

beforeEach(() => {
  native.mac = true
  native.deviceStatus.mockReset()
  native.ensureDevice.mockReset()
  native.setLocalToolsEnabled.mockReset()
})

describe("desktop device native status", () => {
  it("reads the optional execution readiness from the native status", () => {
    expect(
      parseDesktopDeviceStatus({
        state: "online",
        deviceId: ownerId,
        executionReady: true,
      })
    ).toEqual({
      state: "online",
      deviceId: ownerId,
      executionReady: true,
      computerReady: false,
      conversationReferenceReadReady: false,
    })
  })

  it("keeps the local-tools opt-out and error code explicit", () => {
    expect(
      parseDesktopDeviceStatus({
        state: "offline",
        localToolsDisabled: true,
        errorCode: "DESKTOP_LOCAL_TOOLS_DISABLED",
      })
    ).toMatchObject({
      state: "offline",
      localToolsDisabled: true,
      errorCode: "DESKTOP_LOCAL_TOOLS_DISABLED",
    })
  })

  it("reads the native status through one bridge call", async () => {
    native.deviceStatus.mockResolvedValue({
      state: "connecting",
      deviceId: ownerId,
      executionReady: true,
      computerReady: false,
      conversationReferenceReadReady: false,
    })
    await expect(readDesktopDeviceStatus()).resolves.toMatchObject({
      state: "connecting",
      deviceId: ownerId,
      executionReady: true,
    })
    expect(native.deviceStatus).toHaveBeenCalledOnce()
  })

  it("does not call the native host outside macOS", async () => {
    native.mac = false
    await expect(readDesktopDeviceStatus()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    expect(native.deviceStatus).not.toHaveBeenCalled()
    expect(native.ensureDevice).not.toHaveBeenCalled()
  })
})

describe("desktop device native enrollment", () => {
  it("ensures only the verified owner on macOS", async () => {
    native.ensureDevice.mockResolvedValue({
      state: "online",
      deviceId: ownerId,
      executionReady: true,
    })
    await expect(
      ensureDesktopDeviceForAuthRestore(ownerId)
    ).resolves.toMatchObject({ state: "online", executionReady: true })
    expect(native.ensureDevice).toHaveBeenCalledExactlyOnceWith(ownerId, false)

    native.mac = false
    await expect(ensureDesktopDeviceForAuthRestore(ownerId)).resolves.toBeNull()
    expect(native.ensureDevice).toHaveBeenCalledOnce()
  })

  it("does not enroll for a non-UUID owner", async () => {
    await expect(
      ensureDesktopDeviceForAuthRestore("user-1")
    ).resolves.toBeNull()
    expect(native.ensureDevice).not.toHaveBeenCalled()
  })

  it("applies the explicit local-tools toggle", async () => {
    native.setLocalToolsEnabled.mockResolvedValue({
      state: "offline",
      localToolsDisabled: true,
    })
    await expect(setDesktopLocalToolsEnabled(false)).resolves.toMatchObject({
      state: "offline",
      localToolsDisabled: true,
    })
    expect(native.setLocalToolsEnabled).toHaveBeenCalledExactlyOnceWith(false)
  })
})
