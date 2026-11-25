import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  mac: true,
  deviceStatus: vi.fn(),
  pairDevice: vi.fn(),
  resumeDevice: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => native.mac,
}))

vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    deviceStatus: native.deviceStatus,
    pairDevice: native.pairDevice,
    resumeDevice: native.resumeDevice,
  },
}))

import {
  pairDesktopDevice,
  parseDesktopDeviceStatus,
  readDesktopDeviceStatus,
  resumeDesktopDeviceForAuthRestore,
} from "./desktop-device-adapter"

const ownerId = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"
const code = "a".repeat(32)

beforeEach(() => {
  native.mac = true
  native.deviceStatus.mockReset()
  native.pairDevice.mockReset()
  native.resumeDevice.mockReset()
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

  it("treats an older host's missing executionReady as false", () => {
    expect(parseDesktopDeviceStatus({ state: "online" })).toEqual({
      state: "online",
      deviceId: undefined,
      executionReady: false,
      computerReady: false,
      conversationReferenceReadReady: false,
    })
  })

  it("reads the negotiated computer-use flag and fails closed when absent", () => {
    expect(
      parseDesktopDeviceStatus({
        state: "online",
        deviceId: ownerId,
        executionReady: true,
        computerReady: true,
      })
    ).toEqual({
      state: "online",
      deviceId: ownerId,
      executionReady: true,
      computerReady: true,
      conversationReferenceReadReady: false,
    })
    expect(
      parseDesktopDeviceStatus({
        state: "online",
        deviceId: ownerId,
        executionReady: true,
      }).computerReady
    ).toBe(false)
  })

  it("reads the negotiated conversation-reference flag and fails closed when absent", () => {
    expect(
      parseDesktopDeviceStatus({
        state: "online",
        deviceId: ownerId,
        executionReady: true,
        conversationReferenceReadReady: true,
      }).conversationReferenceReadReady
    ).toBe(true)
    expect(
      parseDesktopDeviceStatus({
        state: "online",
        deviceId: ownerId,
        executionReady: true,
      }).conversationReferenceReadReady
    ).toBe(false)
  })

  it("reads DeviceStatus without changing the generated binding", async () => {
    native.deviceStatus.mockResolvedValue({
      state: "connecting",
      deviceId: ownerId,
      executionReady: true,
    })
    await expect(readDesktopDeviceStatus()).resolves.toEqual({
      state: "connecting",
      deviceId: ownerId,
      executionReady: true,
      computerReady: false,
      conversationReferenceReadReady: false,
    })
    expect(native.deviceStatus).toHaveBeenCalledOnce()
  })

  it("does not call the native host outside macOS", async () => {
    native.mac = false
    await expect(readDesktopDeviceStatus()).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    await expect(pairDesktopDevice(code, "Work Mac")).rejects.toThrow(
      "DESKTOP_HOST_UNAVAILABLE"
    )
    expect(native.deviceStatus).not.toHaveBeenCalled()
    expect(native.pairDevice).not.toHaveBeenCalled()
  })
})

describe("desktop device native pairing and resume", () => {
  it("passes the single-use code and trimmed name exactly once", async () => {
    native.pairDevice.mockResolvedValue({ state: "connecting" })
    await expect(pairDesktopDevice(code, "  Work Mac  ")).resolves.toEqual({
      state: "connecting",
      deviceId: undefined,
      executionReady: false,
      computerReady: false,
      conversationReferenceReadReady: false,
    })
    expect(native.pairDevice).toHaveBeenCalledExactlyOnceWith(code, "Work Mac")
  })

  it("rejects an invalid pairing code before calling native", async () => {
    await expect(pairDesktopDevice("not-a-code", "Work Mac")).rejects.toThrow()
    expect(native.pairDevice).not.toHaveBeenCalled()
  })

  it("resumes only the verified owner on macOS", async () => {
    native.resumeDevice.mockResolvedValue({
      state: "online",
      deviceId: ownerId,
      executionReady: true,
    })
    await expect(
      resumeDesktopDeviceForAuthRestore(ownerId)
    ).resolves.toMatchObject({ state: "online", executionReady: true })
    expect(native.resumeDevice).toHaveBeenCalledExactlyOnceWith(ownerId)

    native.mac = false
    await expect(resumeDesktopDeviceForAuthRestore(ownerId)).resolves.toBeNull()
    expect(native.resumeDevice).toHaveBeenCalledOnce()
  })

  it("does not resume for a non-UUID owner", async () => {
    await expect(
      resumeDesktopDeviceForAuthRestore("user-1")
    ).resolves.toBeNull()
    expect(native.resumeDevice).not.toHaveBeenCalled()
  })
})
