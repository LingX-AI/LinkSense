import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useConnectionAuthorization } from "./use-connection-authorization"

const mocks = vi.hoisted(() => ({
  desktop: false,
  authorize: vi.fn(),
  openExternal: vi.fn(),
}))
vi.mock("./api", () => ({ connectionsApi: { authorize: mocks.authorize } }))
vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isDesktopHost: () => mocks.desktop,
  openDesktopExternal: mocks.openExternal,
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}

afterEach(() => {
  mocks.desktop = false
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("connection authorization host integration", () => {
  it("opens desktop OAuth in the system browser without reserving a WebView popup", async () => {
    mocks.desktop = true
    mocks.authorize.mockResolvedValue({
      authorization_url: "https://example.com/oauth/authorize",
    })
    mocks.openExternal.mockResolvedValue(undefined)
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledWith(
        "https://example.com/oauth/authorize"
      )
    )
    expect(open).not.toHaveBeenCalled()
    expect(result.current.tabBlocked).toBe(false)
  })

  it("preserves the browser popup-blocked state without starting OAuth", () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    expect(result.current.tabBlocked).toBe(true)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })

  it("allows another desktop attempt after an authorization failure", async () => {
    mocks.desktop = true
    mocks.authorize.mockRejectedValueOnce(new Error("unavailable"))
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    mocks.authorize.mockResolvedValueOnce({
      authorization_url: "https://example.com/oauth/authorize",
    })
    mocks.openExternal.mockResolvedValue(undefined)
    act(() => result.current.start("onedrive"))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledOnce())
  })
})
