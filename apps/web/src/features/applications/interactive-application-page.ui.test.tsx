import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { ReactNode } from "react"

import type { ConversationEvent } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { InteractiveApplicationPage } from "@/features/applications/interactive-application-page"
import { getPendingConversationTurnSubmission } from "@/features/conversations/conversation-pending-turn-submission"
import { getPendingConversationExecution } from "@/features/conversations/conversation-pending-execution"
import i18n from "@/i18n"

const { apiRequest, useConversationEvents } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  useConversationEvents: vi.fn(
    (
      _conversationId: string | undefined,
      _onEvent: (event: ConversationEvent) => void,
      _initialEventId?: string
    ) => {
      void _conversationId
      void _onEvent
      void _initialEventId
      return {
        connectionState: "connected",
        reconnectingWarningVisible: false,
      }
    }
  ),
}))

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest }
})

vi.mock("@/features/conversations/use-conversation-events", () => ({
  useConversationEvents,
}))

vi.mock("@/pages/conversation-pages", () => ({
  ConversationPage: ({ headerActions }: { headerActions?: ReactNode }) => (
    <div>
      <header data-testid="native-conversation-header">
        <button type="button" aria-label="任务概览" />
        {headerActions}
      </header>
      <div>原生任务聊天</div>
    </div>
  ),
}))

describe("interactive application runtime page", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
    apiRequest.mockImplementation(async (path: string) => {
      if (path.endsWith("/interactive-runtime-token")) {
        return {
          runtime_url:
            "/api/v1/interactive-app-runtime/runtime-token/index.html",
          expires_at: "2026-08-25T01:00:00.000Z",
          manifest: applicationFixture().interactive_package.manifest,
        }
      }
      if (path.startsWith("/applications/")) return applicationFixture()
      if (path.startsWith("/conversations/")) return conversationFixture()
      if (path === "/knowledge-bases") {
        return { items: [], next_cursor: null }
      }
      throw new Error(`unexpected request: ${path}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it.each([false, true])(
    "enforces manifest file permission and refuses task submission during upload (allowed=%s)",
    async (allowed) => {
      const original = apiRequest.getMockImplementation()!
      let finish: (value: unknown) => void = () => undefined
      apiRequest.mockImplementation(async (path: string, options?: unknown) => {
        if (path.endsWith("/interactive-runtime-token")) {
          const result = await original(path, options)
          return {
            ...result,
            manifest: {
              ...result.manifest,
              permissions: allowed
                ? ["tasks:write", "files:write"]
                : ["tasks:write"],
            },
          }
        }
        if (path.endsWith("/interactive-attachments"))
          return new Promise((resolve) => {
            finish = resolve
          })
        return original(path, options)
      })
      renderPage(
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      )
      const frame = await screen.findByTitle("研究工作台")
      const frameWindow = (frame as HTMLIFrameElement).contentWindow!
      const postMessage = vi.spyOn(frameWindow, "postMessage")
      act(() => dispatchFrameMessage(frameWindow, { type: "ready" }))
      const initialize = postMessage.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .find((value) => value.type === "initialize")!
      const request = {
        type: "request",
        instanceId: initialize.instanceId,
        requestId: "upload",
        method: "files.upload",
        params: { file: new File(["notes"], "notes.txt") },
      }
      act(() => dispatchFrameMessage(frameWindow, request))
      if (!allowed) {
        await waitFor(() =>
          expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
              requestId: "upload",
              ok: false,
              error: "LINKSENSE_SDK_PERMISSION_DENIED",
            }),
            "*"
          )
        )
        expect(
          apiRequest.mock.calls.some(([path]) =>
            path.endsWith("/interactive-attachments")
          )
        ).toBe(false)
        return
      }
      act(() =>
        dispatchFrameMessage(frameWindow, {
          ...request,
          requestId: "run",
          method: "tasks.run",
          params: { prompt: "Analyze", file_ids: [] },
        })
      )
      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId: "run",
            ok: false,
            error: "CONFLICT",
          }),
          "*"
        )
      )
      await act(async () =>
        finish({
          id: "60000000-0000-4000-8000-000000000001",
          filename: "notes.txt",
          size_bytes: 5,
          mime_type: "text/plain",
          status: "staged",
          turn_id: null,
        })
      )
      await waitFor(() =>
        expect(postMessage).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "upload", ok: true }),
          "*"
        )
      )
    }
  )

  it("shows the submitted message and opens chat before the slow request finishes, then acknowledges without waiting for refresh", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    renderPage(queryClient)
    const frame = await screen.findByTitle("研究工作台")
    const frameWindow = (frame as HTMLIFrameElement).contentWindow!
    const postMessage = vi.spyOn(frameWindow, "postMessage")
    act(() => dispatchFrameMessage(frameWindow, { type: "ready" }))
    const initialize = postMessage.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .find((value) => value.type === "initialize")!
    await userEvent.click(screen.getByRole("button", { name: "隐藏聊天" }))
    const conversationId = "30000000-0000-4000-8000-000000000001"
    const receipt = {
      accepted: true,
      turn_id: "60000000-0000-4000-8000-000000000001",
      status: "starting",
    }
    let finishRequest = () => {}
    apiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRequest = () => resolve(receipt)
        })
    )
    const refresh = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockImplementation(() => new Promise(() => {}))
    const request = {
      type: "request",
      instanceId: initialize.instanceId,
      requestId: "run-1",
      method: "tasks.run",
      params: { prompt: "生成完整研究报表", idempotency_key: "research-1" },
    }
    act(() => dispatchFrameMessage(frameWindow, request))

    await waitFor(() =>
      expect(
        getPendingConversationTurnSubmission(queryClient, conversationId)
          ?.message.content
      ).toBe("生成完整研究报表")
    )
    expect(frame.closest(".interactive-application-layout")).toHaveAttribute(
      "data-chat-open",
      "true"
    )
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)?.message
    ).toMatchObject({
      display: { kind: "interactive_application" },
      delivery_status: "sending",
    })
    expect(
      getPendingConversationExecution(queryClient, conversationId)
    ).not.toBeNull()
    expect(refresh).not.toHaveBeenCalled()
    // A repeated click shares the same in-flight submission.
    act(() =>
      dispatchFrameMessage(frameWindow, { ...request, requestId: "run-2" })
    )
    expect(
      apiRequest.mock.calls.filter(([path]) => path.endsWith("/turns"))
    ).toHaveLength(1)

    await act(async () => finishRequest())
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "response",
          requestId: "run-1",
          ok: true,
          result: receipt,
        }),
        "*"
      )
    )
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "run-2",
        ok: true,
        result: receipt,
      }),
      "*"
    )
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)
    ).toMatchObject({
      turnId: receipt.turn_id,
      message: { turn_id: receipt.turn_id },
    })
    expect(
      getPendingConversationTurnSubmission(queryClient, conversationId)?.message
        .delivery_status
    ).toBeUndefined()
    expect(refresh).toHaveBeenCalled()
  })

  it("clears optimistic state and reports a submission failure in the host and SDK", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    renderPage(queryClient)
    const frameWindow = (
      (await screen.findByTitle("研究工作台")) as HTMLIFrameElement
    ).contentWindow!
    const postMessage = vi.spyOn(frameWindow, "postMessage")
    act(() => dispatchFrameMessage(frameWindow, { type: "ready" }))
    const initialize = postMessage.mock.calls
      .map(([value]) => value as Record<string, unknown>)
      .find((value) => value.type === "initialize")!
    apiRequest.mockRejectedValueOnce(new Error("send failed"))
    act(() =>
      dispatchFrameMessage(frameWindow, {
        type: "request",
        instanceId: initialize.instanceId,
        requestId: "run-failed",
        method: "tasks.run",
        params: { prompt: "生成报表" },
      })
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "run-failed", ok: false }),
        "*"
      )
    )
    expect(
      getPendingConversationTurnSubmission(
        queryClient,
        "30000000-0000-4000-8000-000000000001"
      )
    ).toBeNull()
    expect(
      getPendingConversationExecution(
        queryClient,
        "30000000-0000-4000-8000-000000000001"
      )
    ).toBeNull()
    expect(screen.getByRole("alert")).toBeVisible()
  })

  it("places the LinkSense-native chat beside the application and keeps both surfaces mounted when toggled", async () => {
    mockSplitLayoutWidth(1_600)
    const interaction = userEvent.setup()
    renderPage()

    const frame = await screen.findByTitle("研究工作台")
    expect(frame).not.toHaveAttribute("sandbox")
    expect(frame).not.toHaveAttribute("csp")
    expect(frame.parentElement).toHaveClass("interactive-application-workspace")
    expect(screen.queryByText("研究工作台")).not.toBeInTheDocument()
    expect(screen.queryByText("正在连接…")).not.toBeInTheDocument()
    const chat = screen.getByRole("complementary", {
      name: "LinkSense 聊天",
    })
    expect(chat.parentElement).toHaveClass("interactive-application-chat-pane")
    const layout = chat.closest(".interactive-application-layout")
    expect(layout).toHaveAttribute("data-chat-open", "true")
    expect(screen.getByText("原生任务聊天")).toBeVisible()
    expect(screen.queryByText("LinkSense 聊天")).not.toBeInTheDocument()
    const overviewButton = screen.getByRole("button", { name: "任务概览" })
    const hideButton = screen.getByRole("button", { name: "隐藏聊天" })
    expect(overviewButton.nextElementSibling).toBe(hideButton)
    expect(hideButton.querySelector("svg")).toHaveClass("text-foreground/55")

    await interaction.click(hideButton)
    expect(layout).toHaveAttribute("data-chat-open", "false")
    expect(chat.parentElement).toHaveAttribute("aria-hidden", "true")
    const show = screen.getByRole("button", { name: "显示聊天" })
    expect(show).toBeVisible()
    expect(show).toHaveClass(
      "h-7",
      "rounded-full",
      "border-[color:var(--app-border)]",
      "bg-[var(--app-canvas)]",
      "shadow-[var(--app-shadow)]"
    )
    expect(show.querySelector("svg")).toHaveClass(
      "lucide-message-circle",
      "size-3.5",
      "text-foreground/70"
    )
    await interaction.click(show)

    expect(layout).toHaveAttribute("data-chat-open", "true")
    expect(screen.getByTitle("研究工作台")).toBe(frame)
    expect(screen.getByRole("complementary", { name: "LinkSense 聊天" })).toBe(
      chat
    )
    expect(screen.getByRole("button", { name: "隐藏聊天" })).toBeVisible()
  })

  it("resizes the application and chat panes with the shared file-preview interaction", async () => {
    mockSplitLayoutWidth(1_600)
    const interaction = userEvent.setup()
    renderPage()

    const frame = await screen.findByTitle("研究工作台")
    const layout = frame.closest(".interactive-application-layout")
    const separator = screen.getByRole("separator", {
      name: "调整聊天区域宽度",
    })
    expect(separator).toHaveClass(
      "sidebar-resize-handle",
      "interactive-application-chat-resize-handle"
    )
    expect(separator).toHaveAttribute("aria-valuenow", "1067")
    expect(layout).toHaveStyle(
      "--interactive-application-workspace-width: 1067px"
    )

    fireEvent.pointerDown(separator, {
      button: 0,
      clientX: 1067,
      pointerId: 21,
    })
    expect(layout).toHaveAttribute("data-chat-resizing", "true")
    fireEvent.pointerMove(separator, { clientX: 947, pointerId: 21 })
    await waitFor(() =>
      expect(layout).toHaveStyle(
        "--interactive-application-workspace-width: 947px"
      )
    )
    fireEvent.pointerUp(separator, { clientX: 947, pointerId: 21 })
    expect(layout).not.toHaveAttribute("data-chat-resizing")

    await interaction.click(screen.getByRole("button", { name: "隐藏聊天" }))
    await interaction.click(screen.getByRole("button", { name: "显示聊天" }))
    expect(screen.getByTitle("研究工作台")).toBe(frame)
    expect(layout).toHaveStyle(
      "--interactive-application-workspace-width: 947px"
    )
  })

  it("uses one full-width surface at a time when the split layout is narrow", async () => {
    mockSplitLayoutWidth(760)
    const interaction = userEvent.setup()
    renderPage()

    const frame = await screen.findByTitle("研究工作台")
    const layout = frame.closest(".interactive-application-layout")
    expect(layout).toHaveAttribute("data-compact", "true")
    expect(
      screen.queryByRole("separator", { name: "调整聊天区域宽度" })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "隐藏聊天" }))
    expect(layout).toHaveAttribute("data-chat-open", "false")
    expect(screen.getByTitle("研究工作台")).toBe(frame)
  })

  it("replays custom events from the beginning and delivers each event once after iframe initialization", async () => {
    renderPage()

    const frame = await screen.findByTitle("研究工作台")
    const frameWindow = (frame as HTMLIFrameElement).contentWindow
    expect(frameWindow).not.toBeNull()
    const postMessage = vi.spyOn(frameWindow!, "postMessage")
    const postedCustomEvents = () =>
      postMessage.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .filter((value) => value.type === "custom-event")
    const subscription = useConversationEvents.mock.calls.find(
      ([conversationId]) =>
        conversationId === "30000000-0000-4000-8000-000000000001"
    )
    expect(subscription?.[2]).toBe("")
    const onEvent = subscription?.[1] as
      ((event: ConversationEvent) => void) | undefined
    expect(onEvent).toBeTypeOf("function")

    const first = customEvent({
      eventId: "50000000-0000-4000-8000-000000000001",
      sequence: 7,
      title: "Historical result",
    })
    act(() => {
      onEvent?.(first)
      onEvent?.(first)
    })
    expect(postedCustomEvents()).toHaveLength(0)

    act(() => {
      dispatchFrameMessage(frameWindow!, { type: "ready" })
    })
    const initialize = await waitFor(() => {
      const message = postMessage.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .find((value) => value.type === "initialize")
      expect(message).toBeDefined()
      return message!
    })
    act(() => {
      dispatchFrameMessage(frameWindow!, {
        type: "initialized",
        instanceId: initialize.instanceId,
      })
    })

    await waitFor(() => expect(postedCustomEvents()).toHaveLength(1))
    expect(postedCustomEvents()[0]).toMatchObject({
      name: "research.section_ready",
      event: { id: "50000000-0000-4000-8000-000000000001", sequence: 7 },
    })

    const liveOnEvent = useConversationEvents.mock.calls
      .filter(
        ([conversationId]) =>
          conversationId === "30000000-0000-4000-8000-000000000001"
      )
      .at(-1)?.[1]
    act(() => {
      liveOnEvent?.(
        customEvent({
          eventId: "50000000-0000-4000-8000-000000000002",
          sequence: 9,
          title: "Live result",
        })
      )
    })
    await waitFor(() => expect(postedCustomEvents()).toHaveLength(2))
  })

  it("loads SDK knowledge resources within the API page limit", async () => {
    renderPage()

    const frame = await screen.findByTitle("研究工作台")
    const frameWindow = (frame as HTMLIFrameElement).contentWindow
    expect(frameWindow).not.toBeNull()
    const postMessage = vi.spyOn(frameWindow!, "postMessage")

    act(() => {
      dispatchFrameMessage(frameWindow!, { type: "ready" })
    })
    const initialize = await waitFor(() => {
      const message = postMessage.mock.calls
        .map(([value]) => value as Record<string, unknown>)
        .find((value) => value.type === "initialize")
      expect(message).toBeDefined()
      return message!
    })

    act(() => {
      dispatchFrameMessage(frameWindow!, {
        type: "request",
        instanceId: initialize.instanceId,
        requestId: "knowledge-request-1",
        method: "resources.listKnowledgeBases",
        params: {},
      })
    })

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/knowledge-bases",
        expect.objectContaining({
          query: expect.objectContaining({ limit: 100 }),
        })
      )
    )
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "response",
          requestId: "knowledge-request-1",
          ok: true,
        }),
        "*"
      )
    )
  })
})

function customEvent({
  eventId,
  sequence,
  title,
}: {
  eventId: string
  sequence: number
  title: string
}): ConversationEvent {
  return {
    id: `30000000-0000-4000-8000-000000000001:${sequence}`,
    type: "linksense/application/custom-event",
    turn_id: "60000000-0000-4000-8000-000000000001",
    payload: {
      schema_version: 1,
      source: "linksense_runner",
      method: "linksense/application/custom-event",
      params: {
        eventId,
        name: "research.section_ready",
        eventSchemaVersion: 1,
        payload: { title },
      },
    },
    created_at: "2026-08-25T00:00:01.000Z",
    sequence_no: sequence,
  }
}

function dispatchFrameMessage(
  source: Window,
  message: Record<string, unknown>
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source,
      data: { protocol: "linksense.interactive.v1", ...message },
    })
  )
}

function renderPage(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
) {
  return render(
    <AuthContext.Provider
      value={{
        status: "authenticated",
        user: {
          id: "10000000-0000-4000-8000-000000000001",
          name: "测试用户",
          email: "user@example.test",
          role: "user",
          status: "active",
          avatar_url: null,
          language: "zh-CN",
          login_method: "password",
          running_message_action: "queue",
          registration_source: "organization_invitation",
          weekly_credit_limit: null,
          monthly_credit_limit: null,
          user_groups: [],
        },
        acceptSession: vi.fn(),
        refreshUser: vi.fn(),
        signOut: vi.fn(),
      }}
    >
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/applications/20000000-0000-4000-8000-000000000001/run/30000000-0000-4000-8000-000000000001",
          ]}
        >
          <Routes>
            <Route
              path="/applications/:applicationId/run/:conversationId"
              element={<InteractiveApplicationPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>
  )
}

function mockSplitLayoutWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function getBoundingClientRect(this: HTMLElement) {
      const measuredWidth = this.classList.contains(
        "interactive-application-layout"
      )
        ? width
        : 0
      return {
        x: 0,
        y: 0,
        top: 0,
        right: measuredWidth,
        bottom: 800,
        left: 0,
        width: measuredWidth,
        height: 800,
        toJSON: () => ({}),
      }
    }
  )
}

function applicationFixture() {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    owner: {
      id: "10000000-0000-4000-8000-000000000001",
      name: "测试用户",
    },
    name: "研究工作台",
    icon: { type: "preset", preset: "sparkles" },
    description: null,
    kind: "interactive",
    instructions: "完成研究",
    model: null,
    reasoning_effort: null,
    status: "active",
    is_owner: true,
    can_manage: true,
    access_source: "owner",
    capability_count: 0,
    knowledge_base_count: 0,
    mcp_server_count: 0,
    share_targets: [],
    dependencies_available: true,
    capabilities: [],
    knowledge_bases: [],
    mcp_servers: [],
    interactive_package: {
      id: "40000000-0000-4000-8000-000000000001",
      version: "1.0.0",
      manifest: {
        schema_version: 1,
        id: "research-workbench",
        name: "研究工作台",
        version: "1.0.0",
        description: null,
        instructions: null,
        icon: null,
        entry: "index.html",
        sdk_version: 1,
        permissions: ["knowledge_bases:read", "tasks:write"],
        custom_events: [],
      },
      created_at: "2026-08-25T00:00:00.000Z",
    },
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  }
}

function conversationFixture() {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    owner_id: "10000000-0000-4000-8000-000000000001",
    title: "研究工作台",
    title_source: "manual",
    archive_status: "active",
    archived_at: null,
    pinned_at: null,
    sort_order: null,
    codex_thread_id: null,
    agents_template_version: null,
    collaboration_mode: "default",
    last_turn_status: null,
    execution_status: "idle",
    last_run_at: null,
    has_unread_completion: false,
    selected_knowledge_base_ids: [],
    application: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "研究工作台",
      kind: "interactive",
      package_id: "40000000-0000-4000-8000-000000000001",
    },
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
    available_capabilities: [],
    messages: [],
    activities: [],
    events: [],
    turns: [],
    pending_requests: [],
    user_input_requests: [],
    plan_reviews: [],
    attachments: [],
    artifacts: [],
  }
}
