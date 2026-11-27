import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQuery,
} from "@tanstack/react-query"
import { act, cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { installQueryFocusTracking } from "./query-focus"

function FocusProbe({ onFetch }: { onFetch: () => void }) {
  useQuery({
    queryKey: ["query-focus-probe"],
    queryFn: async () => {
      onFetch()
      return "value"
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  return null
}

afterEach(() => {
  cleanup()
  focusManager.setFocused(undefined)
})

describe("query focus tracking", () => {
  it("revalidates stale queries when a visible window regains focus", async () => {
    const uninstall = installQueryFocusTracking()
    const onFetch = vi.fn()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <FocusProbe onFetch={onFetch} />
      </QueryClientProvider>
    )
    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(1))

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => expect(onFetch).toHaveBeenCalledTimes(2))
    uninstall()
  })

  it("restores automatic visibility focus after tracking is removed", () => {
    const uninstall = installQueryFocusTracking()
    focusManager.setFocused(false)

    uninstall()

    expect(focusManager.isFocused()).toBe(true)
  })
})
