import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "@/api/contracts"
import { useNewTaskCategory } from "./use-new-task-category"
import {
  newTaskCategoryNavigationState,
  readNewTaskCategory,
  rememberNewTaskCategory,
} from "./new-task-category-preference"

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: request,
}))
const work = "80000000-0000-4000-8000-000000000001"
const personal = "80000000-0000-4000-8000-000000000002"
const categories = [{ id: work }, { id: personal }]
const now = "2026-09-09T00:00:00.000Z"
function sourceTask(category_id: string | null): Conversation {
  return {
    id: "source",
    title: "source",
    category_id,
    archived: false,
    updated_at: now,
    pinned_at: null,
    sort_order: null,
    collaboration_mode: "default",
    has_unread_completion: false,
    has_automation: false,
    user_input_requests: [],
    messages: [],
    turns: [],
  }
}
const clients: QueryClient[] = []
function mount(state: unknown = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return renderHook(
    ({ userId }) => ({
      ...useNewTaskCategory({ userId, isNew: true }),
      location: useLocation(),
    }),
    {
      initialProps: { userId: "first" },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter
            initialEntries={[{ pathname: "/conversations/new", state }]}
          >
            {children}
          </MemoryRouter>
        </QueryClientProvider>
      ),
    }
  )
}
beforeEach(() => {
  window.localStorage.clear()
  request.mockReset()
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

describe("new task category defaults", () => {
  it.each([work, null])(
    "inherits the source task category %s before the last manual choice",
    async (categoryId) => {
      rememberNewTaskCategory("first", personal)
      request.mockImplementation(async (path: string) =>
        path === "/task-categories" ? categories : sourceTask(categoryId)
      )
      const { result } = mount(
        newTaskCategoryNavigationState("first", "source")
      )
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/conversations/source",
          expect.anything()
        )
      )
      await waitFor(() => expect(result.current.categoryId).toBe(categoryId))
      expect(readNewTaskCategory("first")).toBe(personal)
    }
  )
  it("restores the last choice after remounting and isolates a different user", async () => {
    request.mockResolvedValue(categories)
    const first = mount()
    act(() => first.result.current.chooseCategory(work))
    await waitFor(() => expect(first.result.current.categoryId).toBe(work))
    first.unmount()
    const second = mount()
    await waitFor(() => expect(second.result.current.categoryId).toBe(work))
    second.rerender({ userId: "second" })
    expect(second.result.current.categoryId).toBeNull()
  })
  it("uses Unclassified when the remembered category is no longer available", async () => {
    rememberNewTaskCategory("first", work)
    request.mockResolvedValue([{ id: personal }])
    const { result } = mount()
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(result.current.categoryId).toBeNull()
  })
  it("waits for the remembered category to be validated before allowing task creation", async () => {
    rememberNewTaskCategory("first", work)
    let finishCategories!: (value: typeof categories) => void
    request.mockReturnValue(
      new Promise<typeof categories>((resolve) => {
        finishCategories = resolve
      })
    )
    const { result } = mount()
    expect(result.current.isResolving).toBe(true)
    await act(async () => finishCategories(categories))
    await waitFor(() => expect(result.current.isResolving).toBe(false))
    expect(result.current.categoryId).toBe(work)
  })
  it("keeps a manual choice when a delayed source task finishes loading and after refresh", async () => {
    let finishSource!: (value: Conversation) => void
    const pendingSource = new Promise<Conversation>((resolve) => {
      finishSource = resolve
    })
    request.mockImplementation((path: string) =>
      path === "/task-categories" ? Promise.resolve(categories) : pendingSource
    )
    const page = mount(newTaskCategoryNavigationState("first", "source"))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/conversations/source",
        expect.anything()
      )
    )
    expect(page.result.current.isResolving).toBe(true)
    act(() => page.result.current.chooseCategory(personal))
    await act(async () => finishSource(sourceTask(work)))
    await waitFor(() => expect(page.result.current.categoryId).toBe(personal))
    expect(page.result.current.isResolving).toBe(false)
    expect(page.result.current.location.state).not.toHaveProperty(
      "newTaskSource"
    )
    const state = page.result.current.location.state
    page.unmount()
    const refreshed = mount(state)
    await waitFor(() =>
      expect(refreshed.result.current.categoryId).toBe(personal)
    )
  })
})
