import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Conversation } from "@/api/contracts"
import { useNewProject } from "./use-new-project"
import {
  newProjectNavigationState,
  readNewProject,
  rememberNewProject,
} from "./new-project-preference"

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: request,
}))
const work = "80000000-0000-4000-8000-000000000001"
const personal = "80000000-0000-4000-8000-000000000002"
const projects = [{ id: work }, { id: personal }]
const now = "2026-09-09T00:00:00.000Z"
function sourceTask(project_id: string | null): Conversation {
  return {
    id: "source",
    title: "source",
    project_id,
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
      ...useNewProject({ userId, isNew: true }),
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

describe("new task project defaults", () => {
  it.each([work, null])(
    "inherits the source task project %s before the last manual choice",
    async (projectId) => {
      rememberNewProject("first", personal)
      request.mockImplementation(async (path: string) =>
        path === "/projects" ? projects : sourceTask(projectId)
      )
      const { result } = mount(newProjectNavigationState("first", "source"))
      await waitFor(() =>
        expect(request).toHaveBeenCalledWith(
          "/conversations/source",
          expect.anything()
        )
      )
      await waitFor(() => expect(result.current.projectId).toBe(projectId))
      expect(readNewProject("first")).toBe(personal)
    }
  )
  it("restores the last choice after remounting and isolates a different user", async () => {
    request.mockResolvedValue(projects)
    const first = mount()
    act(() => first.result.current.chooseProject(work))
    await waitFor(() => expect(first.result.current.projectId).toBe(work))
    first.unmount()
    const second = mount()
    await waitFor(() => expect(second.result.current.projectId).toBe(work))
    second.rerender({ userId: "second" })
    expect(second.result.current.projectId).toBeNull()
  })
  it("uses Common workspace when the remembered project is no longer available", async () => {
    rememberNewProject("first", work)
    request.mockResolvedValue([{ id: personal }])
    const { result } = mount()
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(result.current.projectId).toBeNull()
  })
  it("waits for the remembered project to be validated before allowing task creation", async () => {
    rememberNewProject("first", work)
    let finishProjects!: (value: typeof projects) => void
    request.mockReturnValue(
      new Promise<typeof projects>((resolve) => {
        finishProjects = resolve
      })
    )
    const { result } = mount()
    expect(result.current.isResolving).toBe(true)
    await act(async () => finishProjects(projects))
    await waitFor(() => expect(result.current.isResolving).toBe(false))
    expect(result.current.projectId).toBe(work)
  })
  it("keeps a manual choice when a delayed source task finishes loading and after refresh", async () => {
    let finishSource!: (value: Conversation) => void
    const pendingSource = new Promise<Conversation>((resolve) => {
      finishSource = resolve
    })
    request.mockImplementation((path: string) =>
      path === "/projects" ? Promise.resolve(projects) : pendingSource
    )
    const page = mount(newProjectNavigationState("first", "source"))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/conversations/source",
        expect.anything()
      )
    )
    expect(page.result.current.isResolving).toBe(true)
    act(() => page.result.current.chooseProject(personal))
    await act(async () => finishSource(sourceTask(work)))
    await waitFor(() => expect(page.result.current.projectId).toBe(personal))
    expect(page.result.current.isResolving).toBe(false)
    expect(page.result.current.location.state).not.toHaveProperty(
      "newTaskSource"
    )
    const state = page.result.current.location.state
    page.unmount()
    const refreshed = mount(state)
    await waitFor(() =>
      expect(refreshed.result.current.projectId).toBe(personal)
    )
  })
})
