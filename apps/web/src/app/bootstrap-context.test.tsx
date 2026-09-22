import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { AuthContext } from "@/app/auth-state"
import { BootstrapProvider } from "@/app/bootstrap-context"
import { BootstrapGate } from "@/app/route-guards"
import i18n from "@/i18n"

const queryClients: QueryClient[] = []

function renderBootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: 1 },
    },
  })
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <BootstrapProvider>
        <AuthContext.Provider
          value={{
            status: "anonymous",
            user: null,
            acceptSession: vi.fn(),
            refreshUser: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <MemoryRouter initialEntries={["/conversations/new"]}>
            <Routes>
              <Route element={<BootstrapGate />}>
                <Route
                  path="/conversations/new"
                  element={<input aria-label="Draft" defaultValue="" />}
                />
                <Route path="/initialize" element={<h1>Initialize</h1>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </BootstrapProvider>
    </QueryClientProvider>
  )
  return queryClient
}

function mockBootstrap() {
  const state = { failed: false, initialized: true, maintenance: false }
  const fetchMock = vi.fn(async () =>
    state.failed
      ? new Response("Deployment in progress", { status: 503 })
      : Response.json({
          success: true,
          data: {
            initialized: state.initialized,
            organization_display_name: "LinkSense",
            default_locale: "zh-CN",
            maintenance_id: "01900000-0000-7000-8000-000000000001",
            maintenance: {
              enabled: state.maintenance,
              active: state.maintenance,
              reason: null,
              start_at: null,
              end_at: null,
            },
          },
        })
  )
  vi.stubGlobal("fetch", fetchMock)
  return { state, fetchMock }
}

beforeEach(async () => {
  vi.useFakeTimers()
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
  for (const queryClient of queryClients.splice(0)) queryClient.clear()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("bootstrap deployment recovery", () => {
  it("keeps the current page and draft mounted when deployment interrupts a background check", async () => {
    const { state } = mockBootstrap()
    const queryClient = renderBootstrap()
    await act(() => vi.advanceTimersByTimeAsync(10))
    const draft = screen.getByRole("textbox", { name: "Draft" })
    fireEvent.change(draft, { target: { value: "Unsent message" } })

    state.failed = true
    await act(() => vi.advanceTimersByTimeAsync(31_100))
    expect(queryClient.getQueryState(["system", "bootstrap"])?.status).toBe(
      "error"
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Unsent message")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    state.failed = false
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(queryClient.getQueryState(["system", "bootstrap"])?.status).toBe(
      "success"
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Unsent message")
  })

  it("fetches live bootstrap status without using the browser HTTP cache", async () => {
    const { fetchMock } = mockBootstrap()
    renderBootstrap()
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/system/bootstrap",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    )
  })

  it.each(["focus", "reconnect"])(
    "checks immediately on %s after an interrupted poll even with recently cached data",
    async (event) => {
      const { state, fetchMock } = mockBootstrap()
      const queryClient = renderBootstrap()
      await act(() => vi.advanceTimersByTimeAsync(10))
      state.failed = true
      await act(() => vi.advanceTimersByTimeAsync(31_100))
      const previousCalls = fetchMock.mock.calls.length
      state.failed = false

      await act(async () => {
        if (event === "focus") {
          focusManager.setFocused(false)
          focusManager.setFocused(true)
        } else {
          onlineManager.setOnline(false)
          onlineManager.setOnline(true)
        }
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(fetchMock).toHaveBeenCalledTimes(previousCalls + 1)
      expect(queryClient.getQueryState(["system", "bootstrap"])?.status).toBe(
        "success"
      )
    }
  )

  it.each(["zh-CN", "en-US", "de-DE"])(
    "shows a translated initial error and recovers by polling without reloading (%s)",
    async (language) => {
      await i18n.changeLanguage(language)
      const { state } = mockBootstrap()
      state.failed = true
      renderBootstrap()
      expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
      await act(() => vi.advanceTimersByTimeAsync(1_100))
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
      expect(screen.queryByText("Initialize")).not.toBeInTheDocument()
      expect(screen.getByRole("alert")).toHaveTextContent(
        language === "en-US"
          ? "Unable to connect to LinkSense. Please wait a moment or try again."
          : "暂时无法连接 LinkSense，请稍候或重试。"
      )
      expect(screen.getByRole("button")).toHaveTextContent(
        language === "en-US" ? "Retry" : "重试"
      )
      state.failed = false
      await act(() => vi.advanceTimersByTimeAsync(30_000))
      expect(screen.getByRole("textbox", { name: "Draft" })).toBeInTheDocument()
    }
  )

  it("allows retrying an initial error immediately", async () => {
    const { state } = mockBootstrap()
    state.failed = true
    renderBootstrap()
    await act(() => vi.advanceTimersByTimeAsync(1_100))
    state.failed = false
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeInTheDocument()
  })

  it("still applies maintenance and initialization changes returned by a successful check", async () => {
    const { state } = mockBootstrap()
    renderBootstrap()
    await act(() => vi.advanceTimersByTimeAsync(10))
    state.maintenance = true
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    const maintenanceHeading = screen.getByRole("heading", {
      name: i18n.t("maintenance.title"),
    })
    state.failed = true
    await act(() => vi.advanceTimersByTimeAsync(31_100))
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(maintenanceHeading).toBeInTheDocument()
    state.failed = false
    state.maintenance = false
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByRole("textbox", { name: "Draft" })).toBeInTheDocument()
    state.initialized = false
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(
      screen.getByRole("heading", { name: "Initialize" })
    ).toBeInTheDocument()
  })
})
