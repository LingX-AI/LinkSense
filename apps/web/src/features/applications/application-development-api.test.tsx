import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { useOpenApplicationDevelopment } from "./application-development-api"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized")
  }
  let reject: (error: Error) => void = () => {
    throw new Error("Promise not initialized")
  }
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  const loading = vi.spyOn(notify, "loading").mockReturnValue("opening")
  const dismiss = vi.spyOn(notify, "dismiss").mockReturnValue("opening")
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/applications"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  const hook = renderHook(
    () => ({
      open: useOpenApplicationDevelopment(),
      location: useLocation().pathname,
    }),
    { wrapper }
  )
  return { ...hook, client, loading, dismiss }
}

describe("development opening feedback", () => {
  it.each([
    [
      "zh-CN",
      { developmentId: "draft" },
      "/application-developments/draft/resume",
      "正在打开开发界面…",
    ],
    [
      "en-US",
      { applicationId: "app" },
      "/application-developments/by-application/app",
      "Opening the development workspace…",
    ],
    [
      "fr",
      { name: "New application" },
      "/application-developments",
      "正在打开开发界面…",
    ],
  ] as const)(
    "keeps global feedback through request and refresh in %s",
    async (locale, input, path, message) => {
      await i18n.changeLanguage(locale)
      const request = deferred<{ conversation_id: string }>()
      vi.mocked(apiRequest).mockReturnValue(request.promise)
      const { result, client, loading, dismiss } = setup()
      const refresh = deferred<void>()
      vi.spyOn(client, "invalidateQueries").mockReturnValue(refresh.promise)

      act(() => result.current.open.mutate(input))
      await waitFor(() => expect(loading).toHaveBeenCalledWith(message))
      expect(apiRequest).toHaveBeenCalledWith(
        path,
        expect.objectContaining({ method: "POST" })
      )
      expect(dismiss).not.toHaveBeenCalled()
      expect(result.current.open.isPending).toBe(true)

      await act(async () => {
        request.resolve({ conversation_id: "task" })
      })
      expect(result.current.location).toBe("/applications")
      expect(dismiss).not.toHaveBeenCalled()
      await act(async () => {
        refresh.resolve(undefined)
      })
      await waitFor(() =>
        expect(result.current.location).toBe("/conversations/task")
      )
      expect(dismiss).toHaveBeenCalledExactlyOnceWith("opening")
    }
  )

  it("dismisses loading after failure and allows another attempt", async () => {
    const request = deferred<never>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    const { result, loading, dismiss } = setup()
    act(() => result.current.open.mutate({ developmentId: "draft" }))
    await waitFor(() => expect(loading).toHaveBeenCalledTimes(1))
    const error = new Error("Request failed")
    await act(async () => {
      request.reject(error)
    })
    await waitFor(() => expect(result.current.open.error).toBe(error))
    expect(dismiss).toHaveBeenCalledExactlyOnceWith("opening")
    expect(result.current.location).toBe("/applications")

    vi.mocked(apiRequest).mockResolvedValue({ conversation_id: "task" })
    await act(async () => {
      await result.current.open.mutateAsync({ developmentId: "draft" })
    })
    expect(loading).toHaveBeenCalledTimes(2)
    expect(dismiss).toHaveBeenCalledTimes(2)
    expect(result.current.location).toBe("/conversations/task")
  })

  it("cleans up global loading even if the initiating card unmounts", async () => {
    const request = deferred<never>()
    vi.mocked(apiRequest).mockReturnValue(request.promise)
    const { result, loading, dismiss, unmount } = setup()
    act(() => result.current.open.mutate({ developmentId: "draft" }))
    await waitFor(() => expect(loading).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => {
      request.reject(new Error("Request failed"))
    })
    await waitFor(() =>
      expect(dismiss).toHaveBeenCalledExactlyOnceWith("opening")
    )
  })
})
