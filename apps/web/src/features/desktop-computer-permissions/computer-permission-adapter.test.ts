import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({ mac: true }))

const runtime = vi.hoisted(() => ({ onWindowActive: vi.fn() }))

const native = vi.hoisted(() => ({
  check: vi.fn(),
  checkWith: vi.fn(),
  guide: vi.fn(),
  guideWith: vi.fn(),
  openSettings: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.mac,
}))

vi.mock("mygo-runtime", () => ({
  onWindowActive: runtime.onWindowActive,
}))

vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    checkComputerPermission: Object.assign(native.check, {
      with: native.checkWith,
    }),
    guideComputerPermission: Object.assign(native.guide, {
      with: native.guideWith,
    }),
    openComputerPermissionSettings: native.openSettings,
  },
}))

import {
  checkComputerPermission,
  guideComputerPermission,
  openComputerPermissionSettings,
  subscribeDesktopWindowActive,
} from "./computer-permission-adapter"

beforeEach(() => {
  host.mac = true
  native.check.mockReset()
  native.guide.mockReset()
  native.openSettings.mockReset()
  runtime.onWindowActive.mockReset()
  native.checkWith.mockReset().mockImplementation(() => native.check)
  native.guideWith.mockReset().mockImplementation(() => native.guide)
})

describe("computer permission IPC", () => {
  it("does not reach the native host outside macOS", async () => {
    host.mac = false
    await expect(
      checkComputerPermission("accessibility", new AbortController().signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "unknown",
      reason: "unsupported",
    })
    await expect(
      guideComputerPermission("screenRecording", new AbortController().signal)
    ).resolves.toEqual({
      kind: "screenRecording",
      status: "unknown",
      reason: "unsupported",
    })
    await expect(
      openComputerPermissionSettings("accessibility")
    ).resolves.toBe(false)
    expect(native.checkWith).not.toHaveBeenCalled()
    expect(native.guideWith).not.toHaveBeenCalled()
    expect(native.openSettings).not.toHaveBeenCalled()
  })

  it("passes the abort signal to the generated check and guide bindings", async () => {
    const controller = new AbortController()
    native.check.mockResolvedValue({
      kind: "accessibility",
      status: "granted",
      reason: "checked",
    })
    native.guide.mockResolvedValue({
      kind: "screenRecording",
      status: "granted",
      reason: "granted",
    })

    await expect(
      checkComputerPermission("accessibility", controller.signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "granted",
      reason: "checked",
    })
    await expect(
      guideComputerPermission("screenRecording", controller.signal)
    ).resolves.toEqual({
      kind: "screenRecording",
      status: "granted",
      reason: "granted",
    })
    expect(native.checkWith).toHaveBeenCalledWith({ signal: controller.signal })
    expect(native.guideWith).toHaveBeenCalledWith({ signal: controller.signal })
    expect(native.check).toHaveBeenCalledWith("accessibility")
    expect(native.guide).toHaveBeenCalledWith("screenRecording")
  })

  it.each([
    ["an unexpected field", { kind: "accessibility", status: "granted", reason: "checked", path: "/private/app" }],
    ["another kind", { kind: "screenRecording", status: "granted", reason: "checked" }],
    ["an unknown status", { kind: "accessibility", status: "allowed", reason: "checked" }],
    ["a missing reason", { kind: "accessibility", status: "notGranted" }],
    ["a Guide grant reason", { kind: "accessibility", status: "granted", reason: "granted" }],
    ["a Guide close reason", { kind: "accessibility", status: "notGranted", reason: "closed" }],
    ["a Guide cancel reason", { kind: "accessibility", status: "notGranted", reason: "canceled" }],
    ["a Guide timeout reason", { kind: "accessibility", status: "unknown", reason: "timedOut" }],
    ["a Guide unknown reason", { kind: "accessibility", status: "unknown", reason: "unknown" }],
    ["a non-unknown packaging reason", { kind: "accessibility", status: "notGranted", reason: "notPackaged" }],
    ["an unavailable reason with a granted status", { kind: "accessibility", status: "granted", reason: "unsupported" }],
  ])("fails closed on %s from Check", async (_name, value) => {
    native.check.mockResolvedValue(value)
    await expect(
      checkComputerPermission("accessibility", new AbortController().signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "unknown",
      reason: "failed",
    })
  })

  it.each([
    ["a grant with the check reason", { kind: "screenRecording", status: "granted", reason: "checked" }],
    ["the check reason", { kind: "screenRecording", status: "notGranted", reason: "checked" }],
    ["a missing reason", { kind: "screenRecording", status: "notGranted" }],
    ["a mismatched kind", { kind: "accessibility", status: "notGranted", reason: "closed" }],
    ["a non-granted status claiming a grant", { kind: "screenRecording", status: "notGranted", reason: "granted" }],
    ["a granted status with a close reason", { kind: "screenRecording", status: "granted", reason: "closed" }],
    ["an unknown status with a close reason", { kind: "screenRecording", status: "unknown", reason: "closed" }],
    ["a non-unknown status with a failure reason", { kind: "screenRecording", status: "notGranted", reason: "failed" }],
    ["a non-unknown status with a packaging reason", { kind: "screenRecording", status: "notGranted", reason: "notPackaged" }],
    ["a non-unknown status with an unsupported reason", { kind: "screenRecording", status: "notDetermined", reason: "unsupported" }],
  ])("fails closed on %s from Guide", async (_name, value) => {
    native.guide.mockResolvedValue(value)
    await expect(
      guideComputerPermission("screenRecording", new AbortController().signal)
    ).resolves.toEqual({
      kind: "screenRecording",
      status: "unknown",
      reason: "failed",
    })
  })

  it.each([
    { status: "granted", reason: "checked" },
    { status: "notGranted", reason: "checked" },
    { status: "notDetermined", reason: "checked" },
    { status: "unknown", reason: "checked" },
    { status: "unknown", reason: "notPackaged" },
    { status: "unknown", reason: "unsupported" },
    { status: "unknown", reason: "failed" },
    { status: "unknown", reason: "invalidKind" },
  ] as const)("accepts the exact Check pair %#", async (pair) => {
    const value = { kind: "accessibility", ...pair }
    native.check.mockResolvedValue(value)
    await expect(
      checkComputerPermission("accessibility", new AbortController().signal)
    ).resolves.toEqual(value)
  })

  it.each([
    { status: "granted", reason: "granted" },
    { status: "notGranted", reason: "closed" },
    { status: "notDetermined", reason: "closed" },
    { status: "unknown", reason: "unknown" },
    { status: "notGranted", reason: "canceled" },
    { status: "granted", reason: "canceled" },
    { status: "notGranted", reason: "timedOut" },
    { status: "granted", reason: "timedOut" },
    { status: "unknown", reason: "failed" },
    { status: "unknown", reason: "unsupported" },
    { status: "unknown", reason: "notPackaged" },
    { status: "unknown", reason: "invalidKind" },
  ] as const)("accepts the exact Guide pair %#", async (pair) => {
    const value = { kind: "screenRecording", ...pair }
    native.guide.mockResolvedValue(value)
    await expect(
      guideComputerPermission("screenRecording", new AbortController().signal)
    ).resolves.toEqual(value)
  })

  it("fails closed for an older host without the generated methods", async () => {
    native.check.mockRejectedValue(
      new Error("method Desktop.CheckComputerPermission is not bound")
    )
    await expect(
      checkComputerPermission("accessibility", new AbortController().signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "unknown",
      reason: "unsupported",
    })
  })

  it("keeps other transport failures distinct from a grant", async () => {
    native.guide.mockRejectedValue(new Error("the page was left"))
    await expect(
      guideComputerPermission("accessibility", new AbortController().signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "unknown",
      reason: "failed",
    })
  })

  it("reports a cancellation when the signal was aborted", async () => {
    const controller = new AbortController()
    native.guide.mockImplementation(async () => {
      controller.abort()
      throw new Error("mygo: the call was aborted")
    })
    await expect(
      guideComputerPermission("accessibility", controller.signal)
    ).resolves.toEqual({
      kind: "accessibility",
      status: "unknown",
      reason: "canceled",
    })
  })

  it("subscribes to native window activity only on a macOS host", () => {
    const listener = vi.fn()
    const unsubscribe = vi.fn()
    runtime.onWindowActive.mockReturnValue(unsubscribe)

    const cleanup = subscribeDesktopWindowActive(listener)
    expect(runtime.onWindowActive).toHaveBeenCalledWith(listener)
    cleanup()
    expect(unsubscribe).toHaveBeenCalledOnce()

    host.mac = false
    runtime.onWindowActive.mockClear()
    const noop = subscribeDesktopWindowActive(listener)
    expect(runtime.onWindowActive).not.toHaveBeenCalled()
    expect(() => noop()).not.toThrow()
  })

  it("fails safe when the runtime has no window activity subscription", () => {
    runtime.onWindowActive.mockImplementation(() => {
      throw new Error("mygo: runtime not found")
    })
    const cleanup = subscribeDesktopWindowActive(() => undefined)
    expect(() => cleanup()).not.toThrow()
  })

  it("opens settings only through the dedicated binding", async () => {
    native.openSettings.mockResolvedValue(undefined)
    await expect(
      openComputerPermissionSettings("screenRecording")
    ).resolves.toBe(true)
    expect(native.openSettings).toHaveBeenCalledWith("screenRecording")

    native.openSettings.mockRejectedValue(new Error("settings failed"))
    await expect(
      openComputerPermissionSettings("accessibility")
    ).resolves.toBe(false)
  })
})
