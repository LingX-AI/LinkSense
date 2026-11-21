import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const native = vi.hoisted(() => ({
  mac: true,
  read: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => native.mac,
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  readDesktopDeviceStatus: native.read,
}))

import { useDesktopDeviceStatus } from "./use-desktop-device-status"

const ownerA = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"
const ownerB = "c5b7a0d4-2f6e-4f8a-9a3c-7d1e2b4c6a90"

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  native.mac = true
  native.read.mockReset()
})

describe("useDesktopDeviceStatus", () => {
  it("stays disabled without an account", () => {
    const { result } = renderHook(() => useDesktopDeviceStatus(), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe("idle")
    expect(native.read).not.toHaveBeenCalled()
  })

  it("stays disabled outside a macOS host", () => {
    native.mac = false
    const { result } = renderHook(() => useDesktopDeviceStatus(ownerA), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe("idle")
    expect(native.read).not.toHaveBeenCalled()
  })

  it("reads the native status for the mounted account", async () => {
    native.read.mockResolvedValue({
      state: "online",
      deviceId: ownerA,
      executionReady: true,
    })
    const { result } = renderHook(() => useDesktopDeviceStatus(ownerA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(result.current.data).toMatchObject({
      state: "online",
      deviceId: ownerA,
      executionReady: true,
    })
    expect(native.read).toHaveBeenCalledOnce()
  })

  it("does not reuse one account's status for another account", async () => {
    native.read
      .mockResolvedValueOnce({ state: "online", deviceId: ownerA })
      .mockResolvedValueOnce({ state: "unpaired" })
    const { result, rerender } = renderHook(
      ({ owner }: { owner: string }) => useDesktopDeviceStatus(owner),
      { wrapper: createWrapper(), initialProps: { owner: ownerA } }
    )
    await waitFor(() =>
      expect(result.current.data).toMatchObject({ state: "online" })
    )

    rerender({ owner: ownerB })
    await waitFor(() =>
      expect(result.current.data).toMatchObject({ state: "unpaired" })
    )
    expect(result.current.data?.deviceId).toBeUndefined()
    expect(native.read).toHaveBeenCalledTimes(2)
  })
})
