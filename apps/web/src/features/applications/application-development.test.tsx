import type { ApplicationAnnotationOptions } from "./application-annotation-preview"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import {
  applicationDevelopmentSchema,
  type ApplicationDevelopmentDiagnostic,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentCreateDialog } from "./application-development-create-dialog"
import { ApplicationDevelopmentPanel } from "./application-development-panel"
import { applicationDevelopmentKeys } from "./application-development-api"
import { ApplicationTestHistory } from "./application-test-history"

const renderPreview = vi.hoisted(() =>
  vi.fn<(annotation?: ApplicationAnnotationOptions) => void>()
)

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "owner" } }),
}))
// Task preflight and polling are exercised with the real query in
// application-publication-readiness.test.tsx; these tests cover development flows.
vi.mock("./use-application-publication-readiness", () => ({
  useApplicationPublicationReadiness: () => ({
    isFetchedAfterMount: true,
    isSuccess: true,
    isError: false,
    data: { has_active_tasks: false },
  }),
}))
vi.mock("@/pages/conversation-pages", () => ({
  ConversationPage: ({
    conversationId,
    readOnly,
  }: {
    conversationId: string
    readOnly: boolean
  }) => (
    <div data-testid="test-history-detail" data-read-only={readOnly}>
      {conversationId}
    </div>
  ),
}))
vi.mock("./interactive-application-page", () => ({
  InteractiveApplicationPage: ({
    conversationId,
    onDiagnostic,
    annotation,
  }: {
    conversationId: string
    onDiagnostic: (value: ApplicationDevelopmentDiagnostic) => void
    annotation?: ApplicationAnnotationOptions
  }) => {
    renderPreview(annotation)
    return (
      <div data-testid="runtime" data-conversation={conversationId}>
        {annotation && (
          <>
            <button onClick={() => annotation.onActiveChange(true)}>
              start annotations
            </button>
            <button onClick={() => annotation.onActiveChange(false)}>
              finish annotations
            </button>
          </>
        )}
        <button
          onClick={() =>
            onDiagnostic({
              message: "Runtime failure",
              file: "https://preview.example.test/private-ticket/app.js?token=private-token",
              line: 3,
            })
          }
        >
          simulate error
        </button>
      </div>
    )
  },
}))
vi.mock("./application-development-capabilities-dialog", () => ({
  ApplicationDevelopmentCapabilitiesDialog: ({
    developmentId,
    onClose,
  }: {
    developmentId: string
    onClose: () => void
  }) => (
    <button data-development-id={developmentId} onClick={onClose}>
      close capabilities
    </button>
  ),
}))
const id = "10000000-0000-4000-8000-000000000001"
const testTask = "20000000-0000-4000-8000-000000000001"
const nextTask = "20000000-0000-4000-8000-000000000002"
const initial = applicationDevelopmentSchema.parse({
  id,
  conversation_id: id,
  name: "Builder",
  directory: "applications/example",
  application_id: null,
  preview_application_id: id,
  preview_conversation_id: testTask,
  preview_current: true,
  revision: 1,
  source_hash: "a".repeat(64),
  installed_source_hash: null,
  source_error: null,
  manifest: null,
  diagnostics: [],
  updated_at: "2026-09-17T00:00:00Z",
})
function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}
const clients: QueryClient[] = []
function show(content: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        {content}
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return client
}
async function openActions() {
  const trigger = screen.getByRole("button", {
    name: i18n.t("applicationDevelopment.actions"),
  })
  if (trigger.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(trigger)
    })
  }
  return trigger
}
async function selectDebugItem(
  name: string,
  role: "menuitem" | "menuitemradio" = "menuitemradio"
) {
  await openActions()
  fireEvent.click(screen.getByRole(role, { name }))
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.useRealTimers()
  vi.resetAllMocks()
})
describe("application development interface", () => {
  it("lights only the preview perimeter for the developer task without rerendering the runtime", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    const preview = screen.getByRole("region", { name: "应用预览" })
    const runtime = screen.getByTestId("runtime")
    const glow = preview.querySelector(".application-development-glow")
    if (!(glow instanceof HTMLElement)) throw new Error("Missing preview glow")
    expect(glow).toHaveAttribute("data-active", "false")
    await waitFor(() => expect(client.isFetching()).toBe(0))
    const previewRenderCount = renderPreview.mock.calls.length
    await act(async () => {
      client.setQueryData(["conversation", testTask], {
        execution_status: "running",
        running_turn: { id: "debug-turn", status: "running" },
      })
    })
    expect(glow).toHaveAttribute("data-active", "false")
    await act(async () => {
      client.setQueryData(["conversation", initial.conversation_id], {
        execution_status: "running",
        running_turn: { id: "development-turn", status: "running" },
      })
    })
    await waitFor(() => expect(glow).toHaveAttribute("data-active", "true"))
    expect(renderPreview).toHaveBeenCalledTimes(previewRenderCount)
    expect(screen.getByTestId("runtime")).toBe(runtime)
    expect(runtime).not.toContainElement(glow)
    await selectDebugItem("调试日志（0）")
    expect(glow).toHaveAttribute("data-active", "false")
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(glow).toHaveAttribute("data-active", "true")
    expect(screen.getByTestId("runtime")).toBe(runtime)
  })

  it("places annotation controls immediately before the actions menu and hides them outside the preview", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(
      <ApplicationDevelopmentPanel
        initial={initial}
        onSubmitAnnotations={vi.fn()}
      />
    )
    await waitFor(() =>
      expect(
        renderPreview.mock.calls.at(-1)?.[0]?.controlsContainer
      ).toBeInstanceOf(HTMLElement)
    )
    const controls = renderPreview.mock.calls.at(-1)?.[0]?.controlsContainer
    const actions = screen.getByRole("button", {
      name: i18n.t("applicationDevelopment.actions"),
    })
    expect(controls?.nextElementSibling).toBe(actions)
    expect(actions.closest("header")).toContainElement(controls ?? null)
    expect(controls).toBeVisible()
    await selectDebugItem(
      i18n.t("applicationDevelopment.diagnostics", { count: 0 })
    )
    expect(controls).not.toBeVisible()
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("common.close") })
    )
    expect(controls).toBeVisible()
  })
  it.each([
    ["zh-CN", "草稿", "已发布"],
    ["en-US", "Draft", "Published"],
    ["de-DE", "草稿", "已发布"],
  ])(
    "shows lightweight publication status next to the name in %s",
    async (language, draft, published) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockResolvedValue(initial)
      const client = show(<ApplicationDevelopmentPanel initial={initial} />)
      await waitFor(() => expect(client.isFetching()).toBe(0))
      const status = within(
        screen
          .getByRole("region", {
            name: i18n.t("applicationDevelopment.workspace"),
          })
          .querySelector("header")!
      ).getByRole("status")
      await waitFor(() => expect(status).toHaveTextContent(draft))
      expect(status).toHaveClass("h-4", "text-[10px]", "font-normal")
      expect(status.parentElement).toContainElement(
        screen.getByRole("heading", { name: initial.name })
      )
      expect(
        screen.queryByRole("button", { name: published })
      ).not.toBeInTheDocument()
      const queryKey = applicationDevelopmentKeys.preview("owner", id)
      await act(async () => {
        client.setQueryData(queryKey, {
          ...initial,
          application_id: id,
          installed_source_hash: initial.source_hash,
        })
      })
      await waitFor(() => expect(status).toHaveTextContent(published))
      await openActions()
      expect(
        screen.getByRole("menuitem", {
          name: i18n.t("applicationDevelopment.publish.update"),
        })
      ).toHaveAttribute("aria-disabled", "true")
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.actions"),
        })
      )
      await act(async () => {
        client.setQueryData(queryKey, {
          ...initial,
          application_id: id,
          installed_source_hash: "b".repeat(64),
        })
      })
      await waitFor(() => expect(status).toHaveTextContent(draft))
      await openActions()
      expect(
        screen.getByRole("menuitem", {
          name: i18n.t("applicationDevelopment.publish.update"),
        })
      ).not.toHaveAttribute("aria-disabled", "true")
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.actions"),
        })
      )
      await act(async () => {
        client.setQueryData(queryKey, {
          ...initial,
          application_id: id,
          installed_source_hash: initial.source_hash,
          source_error: "APPLICATION_PACKAGE_INVALID",
        })
      })
      await waitFor(() => expect(status).toHaveTextContent(draft))
    }
  )
  it("edits the development icon and metadata with the current source hash", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path.endsWith("/metadata")
        ? {
            ...initial,
            icon: { type: "preset", preset: "book-open" },
            source_hash: "b".repeat(64),
          }
        : initial
    )
    show(<ApplicationDevelopmentPanel initial={initial} />)
    const editMetadata = screen.getByRole("button", {
      name: i18n.t("applications.editMetadata"),
    })
    expect(
      editMetadata.querySelector('[data-application-icon-preset="bot"] svg')
    ).toHaveClass("size-full")
    await userEvent.click(editMetadata)
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.iconPresets.book-open"),
      })
    )
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-developments/${id}/metadata`,
        expect.objectContaining({
          method: "PATCH",
          body: {
            source_hash: initial.source_hash,
            name: initial.name,
            description: null,
            icon: { type: "preset", preset: "book-open" },
          },
        })
      )
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })
  it.each([
    ["zh-CN", "应用操作", "新建调试对话", "调试对话记录", "调试日志（0）"],
    [
      "en-US",
      "Application actions",
      "New debug conversation",
      "Debug conversation history",
      "Debug logs (0)",
    ],
    ["de-DE", "应用操作", "新建调试对话", "调试对话记录", "调试日志（0）"],
  ])(
    "groups debug actions in the rightmost menu in %s",
    async (language, menu, create, history, logs) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockResolvedValue(initial)
      show(<ApplicationDevelopmentPanel initial={initial} />)
      const user = userEvent.setup()
      const trigger = screen.getByRole("button", { name: menu })
      expect(trigger.parentElement?.lastElementChild).toBe(trigger)
      expect(
        screen.queryByRole("button", { name: create })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole("tab")).not.toBeInTheDocument()
      await user.click(trigger)
      expect(
        screen.queryByRole("menuitemradio", {
          name: i18n.t("applicationDevelopment.preview"),
        })
      ).not.toBeInTheDocument()
      expect(await screen.findAllByRole("menuitemradio")).toHaveLength(2)
      expect(
        await screen.findByRole("menuitem", { name: create })
      ).toBeVisible()
      expect(screen.getByRole("menuitemradio", { name: history })).toBeVisible()
      await user.click(screen.getByRole("menuitemradio", { name: logs }))
      expect(screen.getByRole("region", { name: logs })).toBeVisible()
      await waitFor(() =>
        expect(trigger).toHaveAttribute("aria-expanded", "false")
      )
      await user.click(trigger)
      expect(
        await screen.findByRole("menuitemradio", { name: logs })
      ).toHaveAttribute("aria-checked", "true")
      await user.keyboard("{Escape}")
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
      await waitFor(() => expect(trigger).toHaveFocus())
    }
  )

  it("returns to the same preview from debug history without resetting its form", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path.endsWith("/test-sessions")
        ? { items: [], next_cursor: null }
        : initial
    )
    show(<ApplicationDevelopmentPanel initial={initial} />)
    const runtime = screen.getByTestId("runtime")
    await selectDebugItem("调试对话记录")
    expect(await screen.findByText("还没有调试对话记录")).toBeVisible()
    expect(runtime).not.toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(screen.getByTestId("runtime")).toBe(runtime)
    expect(runtime).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "关闭" })
    ).not.toBeInTheDocument()
  })

  it.each([
    { ...initial, preview_current: false },
    { ...initial, source_error: "APPLICATION_PACKAGE_INVALID" as const },
  ])(
    "disables new debug conversations when the preview cannot start one",
    async (project) => {
      vi.mocked(apiRequest).mockResolvedValue(project)
      show(<ApplicationDevelopmentPanel initial={project} />)
      await selectDebugItem("新建调试对话", "menuitem")
      expect(
        screen.getByRole("menuitem", { name: "新建调试对话" })
      ).toHaveAttribute("aria-disabled", "true")
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.some(([path]) => path.endsWith("/restart"))
      ).toBe(false)
    }
  )

  it("prevents duplicate debug creation and preserves the preview when creation fails", async () => {
    let rejectRestart: (reason: Error) => void = () => {}
    vi.mocked(apiRequest).mockImplementation((path) =>
      path.endsWith("/restart")
        ? new Promise((_resolve, reject) => {
            rejectRestart = reject
          })
        : Promise.resolve(initial)
    )
    show(<ApplicationDevelopmentPanel initial={initial} />)
    const runtime = screen.getByTestId("runtime")
    await selectDebugItem("新建调试对话", "menuitem")
    await selectDebugItem("新建调试对话", "menuitem")
    expect(
      screen.getByRole("menuitem", { name: "新建调试对话" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.filter(([path]) => path.endsWith("/restart"))
    ).toHaveLength(1)
    await act(async () => rejectRestart(new Error("offline")))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByTestId("runtime")).toBe(runtime)
    expect(
      screen.getByRole("menuitem", { name: "新建调试对话" })
    ).not.toHaveAttribute("aria-disabled", "true")
  })

  it("opens the capability editor for the development project even before its first preview exists", async () => {
    const project = {
      ...initial,
      preview_application_id: null,
      preview_conversation_id: null,
      preview_current: false,
    }
    vi.mocked(apiRequest).mockResolvedValue(project)
    show(<ApplicationDevelopmentPanel initial={project} />)
    await selectDebugItem("配置能力", "menuitem")
    expect(
      screen.getByRole("button", { name: "close capabilities" })
    ).toHaveAttribute("data-development-id", id)
    expect(
      screen.queryByRole("button", { name: "配置资源" })
    ).not.toBeInTheDocument()
  })
  it("refreshes titles only after a failed initial sync is retried successfully", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("Sync failed"))
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const queryKey = applicationDevelopmentKeys.preview("owner", initial.id)
    await waitFor(() =>
      expect(client.getQueryState(queryKey)?.status).toBe("error")
    )
    expect(invalidate).not.toHaveBeenCalled()
    vi.mocked(apiRequest).mockResolvedValue({
      ...initial,
      name: "Renamed after retry",
    })
    await act(async () => {
      await client.refetchQueries({ queryKey })
    })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["conversation", initial.conversation_id],
      })
    )
  })

  it("refreshes renamed task titles without invalidating unchanged opening data or polls", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await waitFor(() =>
      expect(
        client.getQueryState(
          applicationDevelopmentKeys.preview("owner", initial.id)
        )?.fetchStatus
      ).toBe("idle")
    )
    expect(invalidate).not.toHaveBeenCalled()

    vi.mocked(apiRequest).mockResolvedValue({ ...initial, name: "Renamed app" })
    await act(async () => {
      await client.refetchQueries({
        queryKey: applicationDevelopmentKeys.preview("owner", initial.id),
      })
    })
    expect(
      await screen.findByRole("heading", { name: "Renamed app" })
    ).toBeVisible()
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["conversation", initial.conversation_id],
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] })
    invalidate.mockClear()

    await act(async () => {
      await client.refetchQueries({
        queryKey: applicationDevelopmentKeys.preview("owner", initial.id),
      })
    })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("restarts with the displayed session and revision and switches the preview to the new context", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path.endsWith("/restart")
        ? { ...initial, preview_conversation_id: nextTask }
        : initial
    )
    show(<ApplicationDevelopmentPanel initial={initial} />)
    await selectDebugItem("新建调试对话", "menuitem")
    await waitFor(() =>
      expect(screen.getByTestId("runtime")).toHaveAttribute(
        "data-conversation",
        nextTask
      )
    )
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${id}/test-sessions/restart`,
      expect.objectContaining({
        method: "POST",
        body: { preview_conversation_id: testTask, revision: 1 },
      })
    )
  })
  it("resets the preview form when starting over reuses an unsubmitted session", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(<ApplicationDevelopmentPanel initial={initial} />)
    const before = screen.getByTestId("runtime")
    await selectDebugItem("新建调试对话", "menuitem")
    await waitFor(() => expect(screen.getByTestId("runtime")).not.toBe(before))
    expect(screen.getByTestId("runtime")).toHaveAttribute(
      "data-conversation",
      testTask
    )
  })
  it.each(["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"])(
    "shows current and historical tests, opens history in place and deletes old records in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      const current = {
        id: testTask,
        current: true,
        version: "1.0.0+dev.1",
        status: "running",
        busy: true,
        turn_count: 0,
        created_at: initial.updated_at,
        last_run_at: null,
      }
      const older = {
        ...current,
        id: nextTask,
        current: false,
        status: "failed",
        busy: false,
        turn_count: 2,
      }
      let removed = false
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (options?.method === "DELETE") {
          removed = true
          return { success: true }
        }
        if (path.endsWith("/test-sessions"))
          return {
            items: removed ? [current] : [current, older],
            next_cursor: null,
          }
        return initial
      })
      show(<ApplicationDevelopmentPanel initial={initial} />)
      await selectDebugItem(i18n.t("applicationDevelopment.tests.title"))
      expect(
        await screen.findByText(
          i18n.t("applicationDevelopment.tests.status.failed")
        )
      ).toBeVisible()
      expect(screen.queryByText(/dev\.1/)).not.toBeInTheDocument()
      expect(
        screen.getByText(i18n.t("applicationDevelopment.tests.submitted"))
      ).toBeVisible()
      expect(screen.getByTestId("runtime")).toBeInTheDocument()
      const viewButtons = screen.getAllByRole("button", {
        name: i18n.t("applicationDevelopment.tests.view"),
      })
      expect(viewButtons).toHaveLength(2)
      for (const button of viewButtons) {
        expect(button).toBeEnabled()
        expect(button.querySelector("svg")).toBeNull()
      }
      await user.click(viewButtons[1]!)
      expect(await screen.findByTestId("test-history-detail")).toHaveAttribute(
        "data-read-only",
        "true"
      )
      expect(screen.getByTestId("location")).toHaveTextContent("/")
      await user.keyboard("{Escape}")
      await waitFor(() =>
        expect(
          screen.queryByTestId("test-history-detail")
        ).not.toBeInTheDocument()
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.tests.delete"),
        })
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("common.delete"),
        })
      )
      await waitFor(() =>
        expect(
          screen.queryByText(
            i18n.t("applicationDevelopment.tests.status.failed")
          )
        ).not.toBeInTheDocument()
      )
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-developments/${id}/test-sessions/${nextTask}`,
        expect.objectContaining({ method: "DELETE" })
      )
      expect(
        screen.queryByRole("button", {
          name: i18n.t("applicationDevelopment.tests.delete"),
        })
      ).not.toBeInTheDocument()
    }
  )
  it("supports empty history and reports history failures", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [], next_cursor: null })
    const client = show(<ApplicationTestHistory project={initial} />)
    expect(await screen.findByText("还没有调试对话记录")).toBeVisible()
    vi.mocked(apiRequest).mockRejectedValue(new Error("offline"))
    await act(async () => {
      await client.invalidateQueries({
        queryKey: applicationDevelopmentKeys.tests("owner", id),
      })
    })
    expect(
      await screen.findByRole("button", { name: i18n.t("common.retry") })
    ).toBeVisible()
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "shows debug conversation history and its empty state in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockImplementation(async (path) =>
        path.endsWith("/test-sessions")
          ? { items: [], next_cursor: null }
          : initial
      )
      show(<ApplicationDevelopmentPanel initial={initial} />)
      await selectDebugItem(i18n.t("applicationDevelopment.tests.title"))
      expect(
        await screen.findByText(i18n.t("applicationDevelopment.tests.empty"))
      ).toBeVisible()
      expect(
        screen.getByText(i18n.t("applicationDevelopment.tests.emptyHint"))
      ).toBeVisible()
      expect(
        screen.queryByText(
          /这里只记录已提交的测试|Only submitted tests appear here/
        )
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText(/dev\.\d|0 次运行|0 runs/)
      ).not.toBeInTheDocument()
    }
  )

  it("refreshes a reused preview after source changes but keeps a running snapshot and unchanged polls stable", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    const queryKey = applicationDevelopmentKeys.preview("owner", initial.id)
    const invalidate = vi.spyOn(client, "invalidateQueries")
    await waitFor(() =>
      expect(client.getQueryState(queryKey)?.fetchStatus).toBe("idle")
    )
    expect(invalidate).not.toHaveBeenCalled()
    vi.mocked(apiRequest).mockResolvedValue({
      ...initial,
      revision: 2,
      preview_current: false,
    })
    await act(async () => {
      await client.refetchQueries({ queryKey })
    })
    expect(
      await screen.findByText(i18n.t("applicationDevelopment.waitingForTest"))
    ).toBeVisible()
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["conversation", testTask],
    })
    vi.mocked(apiRequest).mockResolvedValue({ ...initial, revision: 2 })
    await act(async () => {
      await client.refetchQueries({ queryKey })
    })
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["conversation", testTask],
      })
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [
        "applications",
        "detail",
        "owner",
        initial.preview_application_id,
      ],
    })
    invalidate.mockClear()
    await act(async () => {
      await client.refetchQueries({ queryKey })
    })
    expect(invalidate).not.toHaveBeenCalled()
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "renders test history dates and actions with %s or the default language",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockResolvedValue({
        items: [
          {
            id: testTask,
            current: true,
            version: "1.0.0",
            status: "completed",
            busy: false,
            turn_count: 1,
            created_at: "2026-09-17T00:00:00Z",
            last_run_at: "2026-09-17T00:00:00Z",
          },
        ],
        next_cursor: null,
      })
      show(<ApplicationTestHistory project={initial} />)
      expect(await screen.findByText(/^2026-09-17 \d{2}:\d{2}$/)).toBeVisible()
      expect(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.tests.view"),
        })
      ).toBeEnabled()
      expect(
        screen.getByText(
          i18n.t("applicationDevelopment.tests.status.completed")
        )
      ).toBeVisible()
    }
  )

  it("pauses all automatic preview queries while annotating and resumes after exit", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockResolvedValue(initial)
    const client = show(
      <ApplicationDevelopmentPanel
        initial={initial}
        onSubmitAnnotations={vi.fn()}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    fireEvent.click(screen.getByRole("button", { name: "start annotations" }))
    vi.mocked(apiRequest).mockClear()
    await act(async () => {
      await client.invalidateQueries({
        queryKey: applicationDevelopmentKeys.preview("owner", initial.id),
      })
      await vi.advanceTimersByTimeAsync(4500)
    })
    expect(apiRequest).not.toHaveBeenCalled()
    await openActions()
    expect(screen.getByRole("menuitem", { name: "发布" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(screen.getByRole("menuitem", { name: "配置能力" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("applicationDevelopment.actions"),
        })
      )
    })
    fireEvent.click(screen.getByRole("button", { name: "finish annotations" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(apiRequest).toHaveBeenCalled()
  })

  it("does not rerender the preview runtime when polling finds no source changes", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(<ApplicationDevelopmentPanel initial={initial} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    const renders = renderPreview.mock.calls.length
    const runtime = screen.getByTestId("runtime")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4500)
    })
    expect(apiRequest).toHaveBeenCalledTimes(4)
    expect(renderPreview).toHaveBeenCalledTimes(renders)
    expect(screen.getByTestId("runtime")).toBe(runtime)
  })

  it("places all actions in the metadata header and removes the separate preview toolbar", () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(<ApplicationDevelopmentPanel initial={initial} />)
    const panel = screen.getByRole("region", {
      name: i18n.t("applicationDevelopment.workspace"),
    })
    const dividers = panel.querySelectorAll(".border-b")
    expect(dividers).toHaveLength(1)
    dividers.forEach((divider) =>
      expect(divider).toHaveClass("border-[color:var(--app-border)]")
    )
    const header = panel.querySelector("header")
    expect(header).toHaveClass("gap-2", "px-3", "py-1.5")
    expect(screen.getByRole("button", { name: "编辑应用名称" })).toHaveClass(
      "py-0.5"
    )
    expect(screen.getByRole("button", { name: "编辑应用描述" })).toHaveClass(
      "py-0.5"
    )
    for (const name of ["编辑应用名称", "编辑应用描述", "应用操作"]) {
      expect(header).toContainElement(screen.getByRole("button", { name }))
    }
    expect(
      screen.queryByRole("button", { name: "应用预览" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("应用预览")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "重新检查应用" })
    ).not.toBeInTheDocument()
  })
  it("validates the name, prevents duplicate creates and opens the resulting development conversation", async () => {
    let finish: (value: unknown) => void = () => {}
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }) as ReturnType<typeof apiRequest>
    )
    show(<ApplicationDevelopmentCreateDialog onClose={vi.fn()} />)
    expect(screen.getByRole("button", { name: "开始开发" })).toBeDisabled()
    fireEvent.change(screen.getByRole("textbox", { name: "应用名称" }), {
      target: { value: "  Example  " },
    })
    fireEvent.click(screen.getByRole("button", { name: "开始开发" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "正在准备…" })).toBeDisabled()
    )
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith(
      "/application-developments",
      expect.objectContaining({ body: { name: "Example" }, method: "POST" })
    )
    await act(async () => finish(initial))
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/applications/open/"
      )
    )
  })
  it("polls edited source and swaps only the preview conversation automatically", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(<ApplicationDevelopmentPanel initial={initial} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByTestId("runtime")).toHaveAttribute(
      "data-conversation",
      testTask
    )
    vi.mocked(apiRequest).mockResolvedValue({
      ...initial,
      revision: 2,
      preview_conversation_id: nextTask,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(screen.getByTestId("runtime")).toHaveAttribute(
      "data-conversation",
      nextTask
    )
    expect(screen.getByTestId("location")).toHaveTextContent("/")
  })
  it.each([
    ["zh-CN", "发布", "发布应用", "取消"],
    ["en-US", "Publish", "Publish application", "Cancel"],
    ["de-DE", "发布", "发布应用", "取消"],
  ])(
    "requires confirmation and allows cancelling publication in %s",
    async (language, publish, title, cancel) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockResolvedValue(initial)
      show(<ApplicationDevelopmentPanel initial={initial} />)
      expect(screen.queryByText("实时预览")).not.toBeInTheDocument()
      expect(
        screen.queryByText("在左侧描述需求，应用效果会自动更新。")
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: publish })
      ).not.toBeInTheDocument()
      await selectDebugItem(publish, "menuitem")
      expect(screen.getByRole("dialog", { name: title })).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: cancel }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.some(([path]) => path.endsWith("/install"))
      ).toBe(false)
    }
  )

  it.each([
    ["zh-CN", "由对方手动安装更新", "需在应用中心另行提交更新"],
    [
      "en-US",
      "ask recipients to install the update",
      "submit an update to the Application Center separately",
    ],
    ["de-DE", "由对方手动安装更新", "需在应用中心另行提交更新"],
  ])(
    "explains manual shared updates and separate center publication in %s",
    async (language, shared, center) => {
      await i18n.changeLanguage(language)
      const development = {
        ...initial,
        application_id: id,
        installed_source_hash: "b".repeat(64),
      }
      vi.mocked(apiRequest).mockResolvedValue(development)
      show(<ApplicationDevelopmentPanel initial={development} />)
      await selectDebugItem(
        i18n.t("applicationDevelopment.publish.update"),
        "menuitem"
      )
      const dialog = screen.getByRole("dialog", {
        name: i18n.t("applicationDevelopment.publish.title"),
      })
      expect(dialog).toHaveTextContent(shared)
      expect(dialog).toHaveTextContent(center)
    }
  )

  it("blocks publication when the source changes after confirmation opens", async () => {
    vi.mocked(apiRequest).mockResolvedValue(initial)
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await selectDebugItem("发布", "menuitem")
    act(() =>
      client.setQueryData(applicationDevelopmentKeys.preview("owner", id), {
        ...initial,
        source_hash: "b".repeat(64),
        revision: 2,
      })
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布" })).toBeDisabled()
    )
    expect(
      screen.getByText("应用内容有新修改，请关闭后重新打开发布窗口。")
    ).toBeVisible()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.some(([path]) => path.endsWith("/install"))
    ).toBe(false)
  })

  it("keeps failed publication in the dialog and permits a retry", async () => {
    let rejectPublish: (reason: Error) => void = () => {}
    let attempts = 0
    vi.mocked(apiRequest).mockImplementation((path) => {
      if (path.endsWith("/distribution/settings"))
        return Promise.resolve({
          version_number: "1.0.0",
          highest_version_number: null,
          usage_instructions: "",
        })
      if (!path.endsWith("/install")) return Promise.resolve(initial)
      attempts += 1
      return attempts === 1
        ? new Promise((_resolve, reject) => {
            rejectPublish = reject
          })
        : Promise.resolve({
            ...initial,
            application_id: id,
            installed_source_hash: initial.source_hash,
          })
    })
    show(<ApplicationDevelopmentPanel initial={initial} />)
    await selectDebugItem("发布", "menuitem")
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole("button", { name: "发布" }))
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: "正在发布…" })
          .every((button) => button.hasAttribute("disabled"))
      ).toBe(true)
    )
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    await act(async () => rejectPublish(new Error("offline")))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "发布成功" })
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole("button", { name: "发布" }))
    const success = await screen.findByRole("dialog", { name: "发布成功" })
    expect(success).toHaveTextContent("v1.0.0")
    fireEvent.click(within(success).getByRole("button", { name: "知道了" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        within(
          screen
            .getByRole("region", {
              name: i18n.t("applicationDevelopment.workspace"),
            })
            .querySelector("header")!
        ).getByRole("status")
      ).toHaveTextContent("已发布")
    )
    expect(attempts).toBe(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each([
    { language: "zh-CN", updating: false, title: "发布成功" },
    { language: "zh-CN", updating: true, title: "发布成功" },
    { language: "en-US", updating: false, title: "Published successfully" },
    { language: "en-US", updating: true, title: "Published successfully" },
    { language: "de-DE", updating: false, title: "发布成功" },
    { language: "de-DE", updating: true, title: "发布成功" },
  ])(
    "shows a dismissible success dialog only after publication in $language (update: $updating)",
    async ({ language, updating, title }) => {
      await i18n.changeLanguage(language)
      const development = { ...initial, application_id: updating ? id : null }
      const published = {
        ...development,
        application_id: id,
        installed_source_hash: initial.source_hash,
      }
      let completePublication: (value: typeof published) => void = () => {}
      vi.mocked(apiRequest).mockImplementation((path) => {
        if (path.endsWith("/distribution/settings"))
          return Promise.resolve({
            version_number: "1.1.1",
            highest_version_number: updating ? "1.1.0" : null,
            usage_instructions: "",
          })
        if (path.endsWith("/install"))
          return new Promise((resolve) => {
            completePublication = resolve
          })
        return Promise.resolve(development)
      })
      const client = show(<ApplicationDevelopmentPanel initial={development} />)
      expect(
        screen.queryByRole("dialog", { name: title })
      ).not.toBeInTheDocument()
      await selectDebugItem(
        i18n.t(
          updating
            ? "applicationDevelopment.publish.update"
            : "applicationDevelopment.publish.action"
        ),
        "menuitem"
      )
      const publish = screen.getByRole("button", {
        name: i18n.t("applicationDevelopment.publish.confirm"),
      })
      await waitFor(() => expect(publish).toBeEnabled())
      fireEvent.click(publish)
      await waitFor(() => expect(publish).toBeDisabled())
      expect(
        screen.queryByRole("dialog", { name: title })
      ).not.toBeInTheDocument()
      await act(async () => completePublication(published))
      const success = await screen.findByRole("dialog", { name: title })
      expect(success).toHaveTextContent(initial.name)
      expect(success).toHaveTextContent("v1.1.1")
      expect(
        screen.queryByRole("dialog", {
          name: i18n.t("applicationDevelopment.publish.title"),
        })
      ).not.toBeInTheDocument()
      fireEvent.click(
        within(success).getByRole("button", { name: i18n.t("common.gotIt") })
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      act(() =>
        client.setQueryData(
          applicationDevelopmentKeys.preview("owner", id),
          published
        )
      )
      expect(
        screen.queryByRole("dialog", { name: title })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId("runtime")).toBeVisible()
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.filter(([path]) => path.endsWith("/install"))
      ).toHaveLength(1)
    }
  )

  it("publishes the confirmed source hash and refreshes the application catalog", async () => {
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path.endsWith("/distribution/settings")
        ? {
            version_number: "1.0.0",
            highest_version_number: null,
            usage_instructions: "",
          }
        : path.endsWith("/install")
          ? {
              ...initial,
              application_id: id,
              installed_source_hash: initial.source_hash,
            }
          : initial
    )
    const client = show(<ApplicationDevelopmentPanel initial={initial} />)
    const invalidation = vi.spyOn(client, "invalidateQueries")
    await selectDebugItem("发布", "menuitem")
    expect(screen.getByRole("dialog", { name: "发布应用" })).toBeVisible()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.some(([path]) => path.endsWith("/install"))
    ).toBe(false)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布" })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole("button", { name: "发布" }))
    const success = await screen.findByRole("dialog", { name: "发布成功" })
    fireEvent.click(within(success).getByRole("button", { name: "知道了" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        within(
          screen
            .getByRole("region", {
              name: i18n.t("applicationDevelopment.workspace"),
            })
            .querySelector("header")!
        ).getByRole("status")
      ).toHaveTextContent("已发布")
    )
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${id}/install`,
      expect.objectContaining({
        method: "POST",
        body: {
          source_hash: initial.source_hash,
          version_number: "1.0.0",
          usage_instructions: "",
        },
      })
    )
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["applications"] })
  })
  it.each([
    ["zh-CN", "调试日志（0）", "暂无调试日志"],
    ["en-US", "Debug logs (0)", "No debug logs yet"],
    ["de-DE", "调试日志（0）", "暂无调试日志"],
  ])(
    "renders debug logs and their empty state in %s",
    async (language, tabName, emptyTitle) => {
      await i18n.changeLanguage(language)
      vi.mocked(apiRequest).mockResolvedValue(initial)
      show(<ApplicationDevelopmentPanel initial={initial} />)
      await selectDebugItem(tabName)
      expect(screen.getByText(emptyTitle)).toBeVisible()
      expect(screen.getByRole("region", { name: tabName })).toHaveClass(
        "flex",
        "flex-col",
        "flex-1",
        "min-h-0",
        "overflow-y-auto"
      )
      expect(
        screen.getByText(emptyTitle).closest('[data-slot="empty"]')
      ).toHaveClass("flex-1", "justify-center", "items-center")
      expect(
        screen.getByText(i18n.t("applicationDevelopment.noErrorsHint"))
      ).toBeVisible()
      const runtime = screen.getByTestId("runtime")
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("common.close") })
      )
      expect(screen.getByTestId("runtime")).toBe(runtime)
      expect(runtime).toBeVisible()
      expect(
        screen.queryByRole("region", { name: tabName })
      ).not.toBeInTheDocument()
    }
  )
  it("reports deduplicated runtime issues for the current version in debug logs", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockResolvedValue(initial)
    show(<ApplicationDevelopmentPanel initial={initial} />)
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(screen.getByRole("button", { name: "simulate error" }))
    fireEvent.click(screen.getByRole("button", { name: "simulate error" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${id}/diagnostics`,
      expect.objectContaining({
        body: {
          revision: 1,
          diagnostics: [
            { message: "Runtime failure", file: "app.js", line: 3 },
          ],
        },
      })
    )
    await selectDebugItem("调试日志（1）")
    expect(screen.getByText("Runtime failure")).toBeVisible()
    expect(screen.getByText("app.js:3")).toBeVisible()
    expect(document.body).not.toHaveTextContent("private-ticket")
    expect(document.body).not.toHaveTextContent("private-token")
  })
  it("allows publication during old preview execution but disables it for incomplete source", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      ...initial,
      preview_current: false,
    })
    const client = show(
      <ApplicationDevelopmentPanel
        initial={{ ...initial, preview_current: false }}
      />
    )
    await openActions()
    expect(screen.getByRole("menuitem", { name: "发布" })).not.toHaveAttribute(
      "aria-disabled",
      "true"
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applicationDevelopment.actions"),
      })
    )
    expect(screen.getByText(/当前调试对话仍在运行/)).toBeVisible()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await act(async () => {
      client.setQueryData(applicationDevelopmentKeys.preview("owner", id), {
        ...initial,
        source_error: "APPLICATION_PACKAGE_INVALID",
      })
    })
    await waitFor(() =>
      expect(screen.getByText(/当前修改还不能运行/)).toBeVisible()
    )
    await openActions()
    expect(screen.getByRole("menuitem", { name: "发布" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
  })
  it("has Chinese, English and Chinese fallback copy for development and errors", () => {
    for (const locale of ["zh-CN", "en-US", "de-DE"]) {
      const t = i18n.getFixedT(locale)
      for (const key of [
        "applicationDevelopment.create",
        "applicationDevelopment.waitingForTest",
        "applicationDevelopment.tests.title",
        "applicationDevelopment.tests.restart",
        "applicationDevelopment.tests.deleteDevelopmentHint",
        "applicationDevelopment.deleteDescription",
        "errors.applicationDevelopment.testBusy",
        "errors.applicationDevelopment.testChanged",
        "errors.applicationDevelopment.sourceChanged",
      ])
        expect(t(key)).not.toBe(key)
    }
    expect(i18n.getFixedT("de-DE")("applicationDevelopment.create")).toBe(
      "创建交互式应用"
    )
    expect(
      i18n.getFixedT("zh-CN")("capability.builtIns.applicationBuilder.name", {
        productName: "LinkSense",
      })
    ).toBe("LinkSense 交互式应用开发")
    expect(
      i18n.getFixedT("en-US")("capability.builtIns.applicationBuilder.name", {
        productName: "LinkSense",
      })
    ).toBe("LinkSense Interactive Application Development")
    expect(i18n.getFixedT("de-DE")("conversation.requiredCapability")).toBe(
      "此任务必需"
    )
  })
})
