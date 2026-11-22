import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({ mac: true }))

const native = vi.hoisted(() => ({
  control: vi.fn(),
  controlWith: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.mac,
}))

vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    computerControl: Object.assign(native.control, {
      with: native.controlWith,
    }),
  },
}))

import {
  requestComputerControl,
  type ComputerControlScope,
} from "./computer-control-adapter"

const scope: ComputerControlScope = {
  conversationId: "20000000-0000-4000-8000-000000000001",
  turnId: "30000000-0000-4000-8000-000000000002",
  deviceId: "40000000-0000-4000-8000-000000000003",
}

function signal(): AbortSignal {
  return new AbortController().signal
}

beforeEach(() => {
  host.mac = true
  native.control.mockReset()
  native.controlWith.mockReset().mockImplementation(() => native.control)
})

describe("computer control native adapter", () => {
  it("never reaches the bridge outside a macOS host", async () => {
    host.mac = false
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "unsupported" })
    expect(native.controlWith).not.toHaveBeenCalled()
  })

  it("validates the conversation and turn before the bridge call", async () => {
    await expect(
      requestComputerControl(
        { ...scope, conversationId: "conversation-1" },
        "select",
        signal()
      )
    ).resolves.toEqual({ kind: "failure", code: "invalid_scope" })
    await expect(
      requestComputerControl(
        { ...scope, turnId: "pending-1" },
        "select",
        signal()
      )
    ).resolves.toEqual({ kind: "failure", code: "invalid_scope" })
    expect(native.controlWith).not.toHaveBeenCalled()
  })

  it("passes the exact generated contract and abort signal", async () => {
    const controller = new AbortController()
    native.control.mockResolvedValue({
      state: "active",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    await expect(
      requestComputerControl(scope, "select", controller.signal)
    ).resolves.toEqual({
      kind: "state",
      state: "active",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    expect(native.controlWith).toHaveBeenCalledExactlyOnceWith({
      signal: controller.signal,
    })
    expect(native.control).toHaveBeenCalledExactlyOnceWith(
      scope.conversationId,
      scope.turnId,
      "select"
    )
  })

  it("sends the explicit renew action for the current grant", async () => {
    const controller = new AbortController()
    native.control.mockResolvedValue({
      state: "active",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    await expect(
      requestComputerControl(scope, "renew", controller.signal)
    ).resolves.toEqual({
      kind: "state",
      state: "active",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    expect(native.controlWith).toHaveBeenCalledExactlyOnceWith({
      signal: controller.signal,
    })
    expect(native.control).toHaveBeenCalledExactlyOnceWith(
      scope.conversationId,
      scope.turnId,
      "renew"
    )
  })

  it("accepts the bounded native states with an ISO expiry", async () => {
    for (const state of ["unavailable", "idle", "stopped"] as const) {
      native.control.mockResolvedValueOnce({ state })
      await expect(
        requestComputerControl(scope, "status", signal())
      ).resolves.toEqual({ kind: "state", state })
    }
    native.control.mockResolvedValueOnce({
      state: "active",
      expiresAt: "2026-11-21T13:05:00+01:00",
    })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toMatchObject({
      kind: "state",
      state: "active",
      expiresAt: "2026-11-21T13:05:00+01:00",
    })
  })

  it("rejects an active or paused success without an expiry", async () => {
    for (const state of ["active", "paused"] as const) {
      native.control.mockResolvedValueOnce({ state })
      await expect(
        requestComputerControl(scope, "status", signal())
      ).resolves.toEqual({ kind: "failure", code: "invalid_response" })
    }
  })

  it("accepts retiring only for a status read without an expiry", async () => {
    native.control.mockResolvedValueOnce({ state: "retiring" })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "state", state: "retiring" })

    native.control.mockResolvedValueOnce({
      state: "retiring",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "invalid_response" })

    // Retirement is never a positive acknowledgement for an action. Only the
    // read-only status path may observe it.
    for (const action of [
      "select",
      "pause",
      "resume",
      "renew",
      "stop",
    ] as const) {
      native.control.mockResolvedValueOnce({ state: "retiring" })
      await expect(
        requestComputerControl(scope, action, signal())
      ).resolves.toEqual({ kind: "failure", code: "invalid_response" })
    }
  })

  it("fails closed for an unexpected result shape", async () => {
    native.control.mockResolvedValue({
      state: "active",
      window: "Safari",
      expiresAt: "2026-11-21T12:05:00.000Z",
    })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "invalid_response" })

    native.control.mockResolvedValue({ state: "granted" })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "invalid_response" })

    native.control.mockResolvedValue({ state: "active", expiresAt: "soon" })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "invalid_response" })

    // The bridge resolves only the native status value; an error envelope is
    // not a real transport shape and must not be read as one.
    native.control.mockResolvedValue({ error: "COMPUTER_BUSY" })
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "invalid_response" })
  })

  it.each([
    ["COMPUTER_UNAVAILABLE", "unavailable"],
    ["COMPUTER_INVALID", "stale_scope"],
    ["COMPUTER_BUSY", "busy"],
    ["COMPUTER_CANCELED", "canceled"],
    ["COMPUTER_TIMEOUT", "timeout"],
    ["FORBIDDEN", "forbidden"],
    ["DEVICE_BUSY", "busy"],
    ["COMPUTER_TARGET_CHANGED", "target_changed"],
    ["DESKTOP_UPDATE_REQUIRED", "unsupported"],
  ] as const)("maps the native error %s to %s", async (message, code) => {
    native.control.mockRejectedValue(new Error(message))
    await expect(
      requestComputerControl(scope, "pause", signal())
    ).resolves.toEqual({ kind: "failure", code })
  })

  it("does not map legacy or unknown error text", async () => {
    for (const message of [
      "COMPUTER_CONTROL_BUSY",
      "COMPUTER_CONTROL_DENIED",
      "wrapped COMPUTER_BUSY",
      "the page was left",
    ]) {
      native.control.mockRejectedValueOnce(new Error(message))
      await expect(
        requestComputerControl(scope, "pause", signal())
      ).resolves.toEqual({ kind: "failure", code: "failed" })
    }
  })

  it("reports an older host without the bound method as unsupported", async () => {
    native.control.mockRejectedValue(
      new Error("method Desktop.ComputerControl is not bound")
    )
    await expect(
      requestComputerControl(scope, "status", signal())
    ).resolves.toEqual({ kind: "failure", code: "unsupported" })
  })

  it("reports an aborted call as canceled, not as a state", async () => {
    const controller = new AbortController()
    native.control.mockImplementation(async () => {
      controller.abort()
      throw new Error("mygo: the call was aborted")
    })
    await expect(
      requestComputerControl(scope, "select", controller.signal)
    ).resolves.toEqual({ kind: "failure", code: "canceled" })
  })

  it("does not reach the bridge for an action that was already canceled", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      requestComputerControl(scope, "stop", controller.signal)
    ).resolves.toEqual({ kind: "failure", code: "canceled" })
    expect(native.controlWith).not.toHaveBeenCalled()
    expect(native.control).not.toHaveBeenCalled()
  })

  it("drops a late active reply that resolves after its cancel", async () => {
    const controller = new AbortController()
    native.control.mockImplementation(async () => {
      controller.abort()
      return { state: "active", expiresAt: "2026-11-21T12:05:00.000Z" }
    })
    await expect(
      requestComputerControl(scope, "resume", controller.signal)
    ).resolves.toEqual({ kind: "failure", code: "canceled" })
  })
})
