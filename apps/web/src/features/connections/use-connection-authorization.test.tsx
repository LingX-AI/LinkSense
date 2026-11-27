import { act, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useConnectionAuthorization } from "./use-connection-authorization"

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))
vi.mock("./api", () => ({ connectionsApi: { authorize: mocks.authorize } }))

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

function browserPopup() {
  return {
    opener: {},
    location: { replace: vi.fn() },
    close: vi.fn(),
  } as unknown as Window
}

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("connection authorization", () => {
  it("navigates the reserved browser popup to the provider", async () => {
    mocks.authorize.mockResolvedValue({
      authorization_url: "https://example.com/oauth/authorize",
    })
    const popup = browserPopup()
    vi.spyOn(window, "open").mockReturnValue(popup)
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    await waitFor(() =>
      expect(popup.location.replace).toHaveBeenCalledWith(
        "https://example.com/oauth/authorize"
      )
    )
    expect(result.current.tabBlocked).toBe(false)
  })

  it("preserves the browser popup-blocked state without starting OAuth", () => {
    vi.spyOn(window, "open").mockReturnValue(null)
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    expect(result.current.tabBlocked).toBe(true)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it("allows another attempt after an authorization failure", async () => {
    mocks.authorize.mockRejectedValueOnce(new Error("unavailable"))
    const failedPopup = browserPopup()
    vi.spyOn(window, "open").mockReturnValueOnce(failedPopup)
    const { result } = renderHook(useConnectionAuthorization, { wrapper })
    act(() => result.current.start("onedrive"))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(failedPopup.close).toHaveBeenCalledOnce()

    const popup = browserPopup()
    vi.spyOn(window, "open").mockReturnValueOnce(popup)
    mocks.authorize.mockResolvedValueOnce({
      authorization_url: "https://example.com/oauth/authorize",
    })
    act(() => result.current.start("onedrive"))
    await waitFor(() =>
      expect(popup.location.replace).toHaveBeenCalledOnce()
    )
  })
})
