import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  setupApplicationTests,
  conversation,
  conversations,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("prewarms a new task once without creating a sidebar task on focus changes", async () => {
    const { requests } = installApiMock()
    renderApp("/conversations/new")

    await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/prewarm" &&
            request.method === "POST"
        )
      ).toHaveLength(1)
    )

    act(() => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
    })

    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/prewarm" &&
          request.method === "POST"
      )
    ).toHaveLength(1)
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "POST"
      )
    ).toBe(false)
  })

  it("redirects the removed conversations list path to a new task", async () => {
    installApiMock()
    renderApp("/conversations")

    expect(
      await screen.findByRole(
        "form",
        { name: "任务输入框" },
        { timeout: 15_000 }
      )
    ).toBeVisible()
    expect(
      screen.getByRole("heading", {
        name: "我们一起在 LinkSense 中做些什么？",
      })
    ).toBeVisible()
    expect(
      screen.queryByText("页面不存在。", { exact: true })
    ).not.toBeInTheDocument()
  }, 20_000)

  it.each([
    { status: 404, errorCode: "CONVERSATION_NOT_FOUND" },
    { status: 403, errorCode: "ACCESS_DENIED" },
  ])(
    "repairs a stale task route after a $status detail response",
    async ({ status, errorCode }) => {
      const staleConversationId = "stale-conversation"
      const { requests } = installApiMock({
        conversationDetailResponse: async (conversationId) =>
          conversationId === staleConversationId
            ? json({ success: false, error_code: errorCode }, status)
            : json({ success: true, data: conversation }),
      })

      renderApp(`/conversations/${staleConversationId}`)

      expect(
        await screen.findByRole(
          "form",
          { name: "任务输入框" },
          { timeout: 2_000 }
        )
      ).toBeVisible()
      expect(
        screen.getByRole("heading", {
          name: "我们一起在 LinkSense 中做些什么？",
        })
      ).toBeVisible()
      expect(
        screen.queryByText("请求的资源不存在或你无权访问。")
      ).not.toBeInTheDocument()
      expect(
        requests.filter(
          (request) =>
            request.path === `/api/v1/conversations/${staleConversationId}` &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    }
  )

  it("fills and focuses the Composer without sending when a starter question is selected", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.click(
      screen.getByRole("button", { name: /分析一份文件/u })
    )

    expect(composer).toHaveValue(
      "请分析我上传的文件，提炼核心结论、关键风险和待办事项，并按重要程度整理。"
    )
    expect(composer).toHaveFocus()
    expect(
      requests.some(
        (request) => request.method === "POST" && /\/turns$/u.test(request.path)
      )
    ).toBe(false)
  })

  it("keeps one centered loading state while an existing task loads", async () => {
    let releaseConversation: ((response: Response) => void) | undefined
    const pendingConversation = new Promise<Response>((resolve) => {
      releaseConversation = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: (callIndex) =>
        callIndex === 1
          ? pendingConversation
          : Promise.resolve(json({ success: true, data: conversation })),
    })

    renderApp()

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "GET",
        })
      )
    )

    const loadingStates = document.querySelectorAll(".page-state-loading")
    expect(loadingStates).toHaveLength(1)
    expect(loadingStates[0]).not.toHaveClass("page-state-loading-fullscreen")
    expect(loadingStates[0]).toHaveTextContent("正在加载")
    expect(
      screen.getByRole("complementary", { name: "LinkSense 导航" })
    ).toBeVisible()

    releaseConversation?.(
      json({
        success: true,
        data: conversation,
      })
    )

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
  })

  it("keeps the navigation shell mounted while switching between existing tasks", async () => {
    const interaction = userEvent.setup()
    let releaseConversation: ((response: Response) => void) | undefined
    const pendingConversation = new Promise<Response>((resolve) => {
      releaseConversation = resolve
    })
    const { requests } = installApiMock({
      conversationDetailResponse: (conversationId) =>
        conversationId === "c2"
          ? pendingConversation
          : Promise.resolve(json({ success: true, data: conversation })),
    })

    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await screen.findByRole("form", { name: "任务输入框" })
    expect(await screen.findByText("任务概览")).toBeVisible()
    await interaction.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "关闭任务概览",
      })
    )
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()

    await interaction.click(
      within(sidebar).getByRole("link", { name: "整理项目会议纪要" })
    )

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "GET",
        })
      )
    )

    expect(sidebar).toBeVisible()
    expect(document.querySelector(".page-state-loading-fullscreen")).toBeNull()
    const loadingWorkspace = document.querySelector(
      ".conversation-workspace-loading"
    )
    expect(loadingWorkspace).toBeInTheDocument()
    expect(
      loadingWorkspace?.querySelector(".page-state-loading")
    ).toBeInTheDocument()

    releaseConversation?.(
      json({
        success: true,
        data: {
          ...conversation,
          ...conversations[1],
          messages: [
            {
              id: "c2-message-1",
              role: "assistant",
              content: "会议纪要已加载。",
            },
          ],
          turns: [],
          running_turn: null,
          draft: {
            ...conversation.draft,
            id: "draft-c2",
            conversation_id: "c2",
          },
        },
      })
    )

    expect(
      await screen.findByText("会议纪要已加载。", { exact: true })
    ).toBeVisible()
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "打开任务概览",
      })
    ).toBeVisible()
    await interaction.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "打开任务概览",
      })
    )
    expect(await screen.findByText("任务概览")).toBeVisible()
  })

  it("hides the empty-task message while a new task's first message is loading", async () => {
    let releaseNewTaskDetail: (() => void) | undefined
    const newTaskDetailReady = new Promise<void>((resolve) => {
      releaseNewTaskDetail = resolve
    })
    const { requests } = installApiMock({
      newTaskDetailResponse: async () => {
        await newTaskDetailReady
        return json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            category_id: null,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-1",
                role: "user",
                turn_id: "00000000-0000-4000-8000-000000000002",
                content: "生成一段欢迎语音",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
            },
            pending_requests: [],
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    expect(
      screen.queryByText("还没有任务。可以直接从输入框开始。")
    ).not.toBeInTheDocument()

    releaseNewTaskDetail?.()

    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toHaveTextContent("生成一段欢迎语音")
    )
  })

  it("shows a new task loading indicator before task creation finishes", async () => {
    let releaseNewTaskCreation: (() => void) | undefined
    const newTaskCreationStart = new Promise<void>((resolve) => {
      releaseNewTaskCreation = resolve
    })
    let releaseNewTaskTurn: (() => void) | undefined
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    const { requests } = installApiMock({
      newTaskCreationStart,
      newTaskTurnStart,
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) => ({
              ...item,
              execution_status: "completed",
            })),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            id: "new-task-1",
            title: "未命名任务",
            execution_status: "running",
            messages: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
            },
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const title = within(sidebar).getByText("未命名任务")
    const item = title.closest(".sidebar-conversation-item")
    expect(item).not.toBeNull()
    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/new-task-1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    releaseNewTaskCreation?.()
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    const detailRequestCountBeforeAdmission = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/new-task-1" &&
        request.method === "GET"
    ).length
    await act(async () => {
      releaseNewTaskTurn?.()
      await newTaskTurnStart
    })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeAdmission)
    )
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    const persistedTitle = within(sidebar).getByText("未命名任务")
    const persistedItem = persistedTitle.closest(".sidebar-conversation-item")
    expect(persistedItem).not.toBeNull()
    expect(
      within(persistedItem as HTMLElement).getByRole("status", {
        name: "执行中",
      })
    ).toBeVisible()
    expect(persistedTitle.closest("a")).toHaveAttribute("aria-busy", "true")
  })

  it("keeps the task workspace and composer mounted when the first message creates the task", async () => {
    let releaseNewTaskCreation!: () => void
    const newTaskCreationStart = new Promise<void>((resolve) => {
      releaseNewTaskCreation = resolve
    })
    let releaseNewTaskTurn!: () => void
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    let releaseNewTaskModelPreference!: () => void
    const newTaskModelPreferenceStart = new Promise<void>((resolve) => {
      releaseNewTaskModelPreference = resolve
    })
    let releaseStaleNewTaskDetail!: () => void
    const staleNewTaskDetailStart = new Promise<void>((resolve) => {
      releaseStaleNewTaskDetail = resolve
    })
    let releaseHydratedNewTaskDetail!: () => void
    const hydratedNewTaskDetailStart = new Promise<void>((resolve) => {
      releaseHydratedNewTaskDetail = resolve
    })
    let resolveStaleNewTaskDetailSettled!: () => void
    const staleNewTaskDetailSettled = new Promise<void>((resolve) => {
      resolveStaleNewTaskDetailSettled = resolve
    })
    let releaseDelayedNewTaskEvent!: () => void
    const newTaskEventStreamStart = new Promise<void>((resolve) => {
      releaseDelayedNewTaskEvent = resolve
    })
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const turnStartedEventId = "new-task-1:2"
    const generatedTitle = "页面闪烁排查"
    const titleEventId = "new-task-1:3"
    const { requests } = installApiMock({
      newTaskCreationStart,
      newTaskTurnStart,
      newTaskModelPreferenceStart,
      newTaskEventStreamStart,
      newTaskEventStreamInitialBody: `id: ${turnStartedEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: turnStartedEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskEventStreamBody: `id: ${titleEventId}\nevent: conversation.title.updated\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000003",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: null,
          sequence_no: 3,
          event_type: "conversation.title.updated",
          visibility: "user_visible",
          payload: { schema_version: 1, title: generatedTitle },
          sse_event_id: titleEventId,
          created_at: "2026-07-18T08:00:03.000Z",
        }
      )}\n\n`,
      modelPreferenceByConversation: { "new-task-1": "model-a" },
      newTaskDetailResponse: async (callIndex) => {
        const hydrated = callIndex > 1
        if (!hydrated) await staleNewTaskDetailStart
        if (hydrated) await hydratedNewTaskDetailStart
        const response = json({
          success: true,
          data: {
            id: "new-task-1",
            title: callIndex > 2 ? generatedTitle : "未命名任务",
            archived: false,
            category_id: null,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: hydrated
              ? [
                  {
                    id: "new-task-message-1",
                    role: "user",
                    turn_id: projectedTurnId,
                    content: "排查页面闪烁",
                    created_at: "2026-07-18T08:00:02.000Z",
                  },
                ]
              : [],
            attachments: [],
            artifacts: [],
            turns: hydrated
              ? [
                  {
                    id: projectedTurnId,
                    status: "running",
                  },
                ]
              : [],
            running_turn: hydrated
              ? {
                  id: projectedTurnId,
                  status: "running",
                }
              : null,
            pending_requests: [],
            user_input_requests: [],
          },
        })
        if (!hydrated) {
          window.setTimeout(resolveStaleNewTaskDetailSettled, 0)
        }
        return response
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    const initialWorkspace = document.querySelector(".conversation-workspace")
    const initialScroller = document.querySelector(".conversation-scroll")
    const initialConversationColumn = document.querySelector(
      ".conversation-column"
    )
    const initialComposerShell = screen.getByRole("form", {
      name: "任务输入框",
    })
    const initialModelSelector = await screen.findByRole("button", {
      name: "选择模型与推理强度",
    })
    const initialSendButton = await screen.findByRole("button", {
      name: "发送",
    })
    expect(initialSendButton).toBeVisible()
    expect(initialSendButton).toHaveAttribute("aria-disabled", "true")
    expect(initialWorkspace).toBeInTheDocument()
    expect(initialScroller).toBeInTheDocument()
    expect(initialConversationColumn).toBeInTheDocument()
    if (!(initialScroller instanceof HTMLElement)) {
      throw new Error("conversation scroller was not mounted")
    }
    const promotionScrollTo = vi.fn()
    Object.defineProperty(initialScroller, "scrollTo", {
      configurable: true,
      value: promotionScrollTo,
    })

    await interaction.type(composer, "排查页面闪烁")
    expect(screen.getByRole("button", { name: "发送" })).toBe(initialSendButton)
    expect(initialSendButton).toHaveAttribute("aria-disabled", "false")
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations",
          method: "POST",
        })
      )
    )
    const optimisticUserMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticTurnSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    const optimisticStopButton = await screen.findByRole("button", {
      name: "停止",
    })
    expect(optimisticTurnSummary).toBeInTheDocument()
    promotionScrollTo.mockClear()
    initialScroller.scrollTop = 37

    releaseNewTaskCreation()

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    )
    expect(
      await screen.findByRole("button", { name: "打开任务概览" })
    ).toBeVisible()
    expect(screen.getByTestId(`turn-summary-${projectedTurnId}`)).toBe(
      optimisticTurnSummary
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(document.querySelector(".conversation-column")).toBe(
      initialConversationColumn
    )
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    releaseNewTaskTurn()
    await waitFor(() =>
      expect(screen.getByTestId(`turn-summary-${projectedTurnId}`)).toBe(
        optimisticTurnSummary
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    releaseHydratedNewTaskDetail()
    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )
    releaseStaleNewTaskDetail()
    await staleNewTaskDetailSettled
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector(".conversation-workspace")).toBe(
        initialWorkspace
      )
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
      expect(screen.getByRole("article", { name: "用户消息" })).toBe(
        optimisticUserMessage
      )
      expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
        optimisticTurnSummary
      )
    })
    expect(initialWorkspace).not.toHaveAttribute("data-task-overview-open")
    expect(
      document.querySelector(".page-state-loading-fullscreen")
    ).not.toBeInTheDocument()
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(initialScroller).toHaveProperty("scrollTop", 37)
    expect(promotionScrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    releaseDelayedNewTaskEvent()
    await screen.findByRole("heading", { name: generatedTitle })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(3)
    )
    expect(document.querySelector(".conversation-workspace")).toBe(
      initialWorkspace
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(initialScroller).toHaveProperty("scrollTop", 37)
    expect(promotionScrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/model-preference",
          method: "GET",
        })
      )
    )
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(promotionScrollTo).not.toHaveBeenCalled()

    releaseNewTaskModelPreference()
    await waitFor(() =>
      expect(initialModelSelector).toHaveTextContent("Model A")
    )
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await interaction.click(
      screen.getByRole("button", { name: "打开任务概览" })
    )
    expect(await screen.findByText("任务概览")).toBeVisible()
    expect(initialWorkspace).toHaveAttribute("data-task-overview-open", "true")
  })

  it("keeps the stop control mounted while the first task turn is being projected", async () => {
    let releaseNewTaskCreation!: () => void
    const newTaskCreationStart = new Promise<void>((resolve) => {
      releaseNewTaskCreation = resolve
    })
    let releaseTurnStartedEvent!: () => void
    const newTaskEventStreamStart = new Promise<void>((resolve) => {
      releaseTurnStartedEvent = resolve
    })
    let exposeRunningProjection = false
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const turnStartedEventId = "new-task-1:2"
    const { requests } = installApiMock({
      newTaskCreationStart,
      newTaskEventStreamStart,
      newTaskEventStreamBody: `id: ${turnStartedEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: turnStartedEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            category_id: null,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-1",
                role: "user",
                turn_id: projectedTurnId,
                content: "保持停止按钮",
                created_at: "2026-07-18T08:00:02.000Z",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: exposeRunningProjection
              ? [{ id: projectedTurnId, status: "running" }]
              : [],
            running_turn: exposeRunningProjection
              ? { id: projectedTurnId, status: "running" }
              : null,
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    await screen.findByRole(
      "heading",
      { name: conversations[0]!.title },
      { timeout: 15_000 }
    )
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1/events",
          method: "GET",
        })
      )
    )
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      within(sidebar).getByRole("link", { name: "新任务" })
    )
    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    const workspace = document.querySelector(".conversation-workspace")
    const scroller = document.querySelector(".conversation-scroll")
    const composerShell = screen.getByRole("form", { name: "任务输入框" })

    await interaction.type(composer, "保持停止按钮")
    await interaction.keyboard("{Enter}")

    const optimisticMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    const stopControl = await screen.findByRole("button", { name: "停止" })
    expect(optimisticSummary).toBeInTheDocument()

    releaseNewTaskCreation()
    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
    )
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })

    expect(screen.getByRole("button", { name: "停止" })).toBe(stopControl)
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticSummary
    )
    expect(document.querySelector(".conversation-workspace")).toBe(workspace)
    expect(document.querySelector(".conversation-scroll")).toBe(scroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(composerShell)

    const detailRequestCountBeforeTurnStarted = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/new-task-1" &&
        request.method === "GET"
    ).length
    exposeRunningProjection = true
    releaseTurnStartedEvent()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeTurnStarted)
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBe(stopControl)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticSummary
    )
    expect(document.querySelector(".conversation-workspace")).toBe(workspace)
    expect(document.querySelector(".conversation-scroll")).toBe(scroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(composerShell)
  })

  it("keeps one user message when promoted detail arrives before the turn receipt", async () => {
    let releaseNewTaskCreation!: () => void
    const newTaskCreationStart = new Promise<void>((resolve) => {
      releaseNewTaskCreation = resolve
    })
    let releaseNewTaskTurn!: () => void
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const detailRefreshEventId = "new-task-1:2"
    const { requests } = installApiMock({
      newTaskCreationStart,
      newTaskTurnStart,
      newTaskEventStreamBody: `id: ${detailRefreshEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: detailRefreshEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            category_id: null,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-before-receipt",
                role: "user",
                turn_id: projectedTurnId,
                content: "详情先于回执",
                created_at: "2026-07-18T08:00:02.000Z",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: [{ id: projectedTurnId, status: "running" }],
            running_turn: { id: projectedTurnId, status: "running" },
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    await interaction.type(composer, "详情先于回执")
    await interaction.keyboard("{Enter}")
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations",
          method: "POST",
        })
      )
    )
    const optimisticUserMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticTurnSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    expect(optimisticTurnSummary).toBeInTheDocument()

    releaseNewTaskCreation()
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    )
    await waitFor(() =>
      expect(
        document.getElementById(
          "conversation-message-new-task-message-before-receipt"
        )
      ).toBeInTheDocument()
    )

    expect(screen.getAllByRole("article", { name: "用户消息" })).toHaveLength(1)
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )

    releaseNewTaskTurn()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
  })

  it("keeps starter questions hidden while the first new-task message is being created", async () => {
    let releaseNewTaskCreation: (() => void) | undefined
    const newTaskCreationStart = new Promise<void>((resolve) => {
      releaseNewTaskCreation = resolve
    })
    installApiMock({
      newTaskCreationStart,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            category_id: null,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [],
            attachments: [],
            artifacts: [],
            turns: [],
            running_turn: null,
            pending_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    expect(
      await screen.findByRole("group", { name: "常见任务建议" })
    ).toBeVisible()
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "排查页面闪烁"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "常见任务建议" })
      ).not.toBeInTheDocument()
    )

    releaseNewTaskCreation?.()
  })
})
