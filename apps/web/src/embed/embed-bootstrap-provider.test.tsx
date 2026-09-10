import { act, cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useBootstrap } from "@/app/bootstrap-state"
import { EmbedBootstrapProvider } from "./embed-bootstrap-provider"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function Status() {
  const { bootstrap, isLoading, error, refetch } = useBootstrap()
  return (
    <>
      <output>
        {isLoading
          ? "loading"
          : bootstrap?.maintenance?.active
            ? "maintenance"
            : error
              ? "error"
              : "available"}
      </output>
      <button onClick={refetch}>Refresh</button>
    </>
  )
}

describe("embedded system status", () => {
  it("polls maintenance without main-site credentials and recovers after a temporary failure", async () => {
    vi.useFakeTimers()
    let active = false
    let failed = false
    const fetchMock = vi.fn(async () => {
      if (failed) throw new TypeError("offline")
      return Response.json({
        success: true,
        data: {
          initialized: true,
          system_name: "LinkSense",
          default_language: "zh-CN",
          maintenance: {
            enabled: true,
            active,
            reason: null,
            start_at: null,
            end_at: null,
          },
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient()
    const view = render(
      <QueryClientProvider client={queryClient}>
        <EmbedBootstrapProvider>
          <Status />
        </EmbedBootstrapProvider>
      </QueryClientProvider>
    )
    expect(screen.getByRole("status")).toHaveTextContent("loading")
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getByRole("status")).toHaveTextContent("available")
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/system/bootstrap",
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    )

    active = true
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByRole("status")).toHaveTextContent("maintenance")
    failed = true
    await act(() => vi.advanceTimersByTimeAsync(31_100))
    expect(screen.getByRole("status")).toHaveTextContent("maintenance")
    failed = false
    active = false
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByRole("status")).toHaveTextContent("available")
    view.unmount()
    queryClient.clear()
  })
})
