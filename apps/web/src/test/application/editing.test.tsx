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
  seedLocalDraft,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("regenerates from the edited latest user message without changing the composer draft", async () => {
    seedLocalDraft("c1", { input: "输入框里保留的草稿" })
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "输入框里保留的草稿",
        draft_capability_ids: [],
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            updated_at: "2026-07-11T08:00:00.000Z",
            content: "请评估活动风险",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始风险评估。",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const userMessage = await screen.findByRole("article", { name: "用户消息" })
    const composer = screen.getByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue("输入框里保留的草稿"))
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const editor = within(userMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, "请重新评估活动风险，并补充雨天预案")
    await interaction.click(
      within(userMessage).getByRole("button", { name: "发送" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/messages/m1/regenerate" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "请重新评估活动风险，并补充雨天预案",
        idempotency_key: expect.any(String),
      })
    )
    expect(composer).toHaveValue("输入框里保留的草稿")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toBe(false)
  })

  it("branches from an assistant message and opens the new numbered task", async () => {
    let finishFork: (() => void) | undefined
    const forkStart = new Promise<void>((resolve) => {
      finishFork = resolve
    })
    let conversationListCalls = 0
    let finishSidebarRefresh: ((response: Response) => void) | undefined
    const pendingSidebarRefresh = new Promise<Response>((resolve) => {
      finishSidebarRefresh = resolve
    })
    const { requests } = installApiMock({
      forkStart,
      conversationListResponse: (_query, state) => {
        conversationListCalls += 1
        if (state.forkCalls === 0) {
          return json({
            success: true,
            data: {
              items: conversations,
              next_cursor: null,
              total_count: conversations.length,
            },
          })
        }
        return pendingSidebarRefresh
      },
      conversationOverride: {
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            content: "请评估活动风险",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始风险评估。",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const assistantMessage = await screen.findByRole(
      "article",
      { name: "助手回复" },
      { timeout: 5_000 }
    )
    await interaction.click(
      within(assistantMessage).getByRole("button", { name: "分支到新聊天" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/messages/m2/fork" &&
            request.method === "POST"
        )?.body
      ).toEqual({ idempotency_key: expect.any(String) })
    )
    const forkLoadingNotification = await waitFor(() => {
      const notification = screen
        .getAllByText("正在创建分支…", { exact: true })
        .find((element) => element.closest("[data-sonner-toast]"))
      expect(notification).toBeDefined()
      return notification!
    })
    expect(
      forkLoadingNotification.closest("[data-sonner-toast]")
    ).toHaveAttribute("data-type", "loading")

    finishFork?.()
    expect(await screen.findByText("活动风险评估(2)已加载。")).toBeVisible()
    await waitFor(() =>
      expect(
        screen
          .queryAllByText("正在创建分支…", { exact: true })
          .some((element) => element.closest("[data-sonner-toast]"))
      ).toBe(false)
    )
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    expect(within(sidebar).getByText("活动风险评估(2)")).toBeVisible()
    expect(conversationListCalls).toBeGreaterThan(1)

    await interaction.click(
      within(sidebar).getByText("活动风险评估", { exact: true })
    )
    const sourceAssistantMessage = await screen.findByRole("article", {
      name: "助手回复",
    })
    await interaction.click(
      within(sourceAssistantMessage).getByRole("button", {
        name: "分支到新聊天",
      })
    )

    expect(await screen.findByText("活动风险评估(3)已加载。")).toBeVisible()
    expect(within(sidebar).getByText("活动风险评估(3)")).toBeVisible()
    const forkRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/messages/m2/fork" &&
        request.method === "POST"
    )
    expect(forkRequests).toHaveLength(2)
    expect(forkRequests[0]?.body).toEqual({
      idempotency_key: expect.any(String),
    })
    expect(forkRequests[1]?.body).toEqual({
      idempotency_key: expect.any(String),
    })
    expect(
      (forkRequests[1]?.body as { idempotency_key: string }).idempotency_key
    ).not.toBe(
      (forkRequests[0]?.body as { idempotency_key: string }).idempotency_key
    )

    finishSidebarRefresh?.(
      json({
        success: true,
        data: {
          items: [
            {
              ...conversations[0],
              id: "c4",
              title: "活动风险评估(2)",
              execution_status: "completed",
              updated_at: new Date().toISOString(),
            },
            ...conversations,
          ],
          next_cursor: null,
          total_count: conversations.length + 1,
        },
      })
    )
  })

  it("replaces the latest turn optimistically without waiting for regeneration admission", async () => {
    let acceptRegeneration: ((response: Response) => void) | undefined
    const regenerationAdmission = new Promise<Response>((resolve) => {
      acceptRegeneration = resolve
    })
    installApiMock({
      conversationOverride: {
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            content: "原始请求",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始回复",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
      regenerateResponse: () => regenerationAdmission,
    })
    const interaction = userEvent.setup()
    renderApp()

    const sourceMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "编辑消息" })
    )
    const editor = within(sourceMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, "立即显示的新请求")
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "发送" })
    )

    await waitFor(() => {
      const optimisticMessages = screen.getAllByRole("article", {
        name: "用户消息",
      })
      expect(optimisticMessages).toHaveLength(1)
      expect(
        within(optimisticMessages[0]).getByText("立即显示的新请求")
      ).toBeVisible()
    })
    expect(screen.queryByText("原始请求")).toBeNull()
    expect(screen.queryByText("原始回复")).toBeNull()
    expect(screen.queryByRole("button", { name: "正在发送" })).toBeNull()

    await act(async () => {
      acceptRegeneration?.(
        json(
          {
            success: true,
            data: {
              turn_id: "00000000-0000-4000-8000-000000000099",
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      )
      await regenerationAdmission
    })
  })

  it("does not restore the optimistic source message after interrupting and regenerating an edit", async () => {
    const originalContent =
      "帮我制作一个AI发展的PPT。挑一个合适的主题帮我实现就行，不用再继续追问了"
    const editedContent = "挑一个合适的主题帮我实现就行，不用再继续追问了"
    const sourceTurnId = "00000000-0000-4000-8000-000000000011"
    const editedTurnId = "00000000-0000-4000-8000-000000000012"
    let phase: "idle" | "running" | "interrupted" | "regenerated" = "idle"
    const detail = () => {
      if (phase === "idle") {
        return {
          ...conversation,
          execution_status: "idle",
          messages: [],
          turns: [],
          running_turn: null,
        }
      }
      if (phase === "regenerated") {
        return {
          ...conversation,
          execution_status: "running",
          messages: [
            {
              id: "edited-message",
              role: "user",
              turn_id: editedTurnId,
              created_at: "2026-07-11T08:01:00.000Z",
              content: editedContent,
            },
          ],
          turns: [{ id: editedTurnId, status: "running" }],
          running_turn: { id: editedTurnId, status: "running" },
        }
      }
      const status = phase === "running" ? "running" : "interrupted"
      return {
        ...conversation,
        execution_status: status,
        messages: [
          {
            id: "source-message",
            role: "user",
            turn_id: sourceTurnId,
            created_at: "2026-07-11T08:00:00.000Z",
            content: originalContent,
          },
        ],
        turns: [{ id: sourceTurnId, status }],
        running_turn:
          status === "running" ? { id: sourceTurnId, status } : null,
      }
    }
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({ success: true, data: detail() }),
      turnStartResponse: async () => {
        phase = "running"
        return json(
          {
            success: true,
            data: {
              turn_id: sourceTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      },
      interruptResponse: () => {
        phase = "interrupted"
        return json(
          {
            success: true,
            data: { code: "TURN_INTERRUPT_REQUESTED" },
          },
          202
        )
      },
      regenerateResponse: () => {
        phase = "regenerated"
        return json(
          {
            success: true,
            data: {
              turn_id: editedTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, originalContent)
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    const sourceMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    expect(within(sourceMessage).getByText(originalContent)).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "停止" }))
    const editButton = await within(sourceMessage).findByRole("button", {
      name: "编辑消息",
    })
    await interaction.click(editButton)
    const editor = within(sourceMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, editedContent)
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "发送" })
    )

    const userMessages = await screen.findAllByRole("article", {
      name: "用户消息",
    })
    expect(userMessages).toHaveLength(1)
    expect(within(userMessages[0]).getByText(editedContent)).toBeVisible()
    expect(
      within(userMessages[0]).queryByText(originalContent)
    ).not.toBeInTheDocument()
  })

  it("loads a persisted draft image as a thumbnail and opens the shared preview", async () => {
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    )
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    )
    const createObjectURL = vi.fn(() => "blob:draft-image-preview")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })

    try {
      const { requests } = installApiMock({
        conversationOverride: {
          turns: [],
          running_turn: null,
          execution_status: "idle",
          attachments: [
            {
              id: "draft-image-1",
              name: "活动现场.png",
              mime_type: "image/png",
              kind: "attachment",
              status: "staged",
              size: 1024,
            },
          ],
        },
      })
      const interaction = userEvent.setup()
      const view = renderApp()

      const preview = await screen.findByRole(
        "button",
        { name: "预览图片 活动现场.png" },
        { timeout: 3_000 }
      )
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/attachments/draft-image-1/content" &&
            request.method === "GET"
        )
      ).toBe(true)

      await interaction.click(preview)
      expect(
        await screen.findByRole("img", { name: "活动现场.png" })
      ).toHaveAttribute("src", "blob:draft-image-preview")

      vi.useFakeTimers()
      view.unmount()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(2_000))
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:draft-image-preview")
    } finally {
      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl)
      } else {
        Reflect.deleteProperty(URL, "createObjectURL")
      }
      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl)
      } else {
        Reflect.deleteProperty(URL, "revokeObjectURL")
      }
    }
  })

  it("interrupts once without an error when Stop is clicked before the turn start receipt", async () => {
    let resolveTurnStart: ((response: Response) => void) | undefined
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      turnStartResponse: async () =>
        new Promise((resolve) => {
          resolveTurnStart = resolve
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 3_000 }
    )
    await interaction.type(composer, "立即显示这条消息")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const optimisticUserMessage = (
      await screen.findAllByRole("article", {
        name: "用户消息",
      })
    ).find((element) => element.textContent?.includes("立即显示这条消息"))
    expect(optimisticUserMessage).toBeDefined()
    expect(
      within(optimisticUserMessage as HTMLElement).getByText("立即显示这条消息")
    ).toBeVisible()
    expect(screen.getByText("正在思考", { exact: true })).toBeVisible()
    expect(screen.queryByText("正在准备执行…")).toBeNull()
    const stop = screen.getByRole("button", { name: "停止" })
    expect(stop).toBeEnabled()
    await interaction.click(stop)
    expect(
      await screen.findByRole("button", { name: "正在中断…" })
    ).toBeDisabled()
    expect(
      requests.some(
        (request) =>
          request.path.includes("/interrupt") && request.method === "POST"
      )
    ).toBe(false)
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toBe(false)

    resolveTurnStart?.(
      json(
        {
          success: true,
          data: {
            turn_id: "00000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          },
        },
        202
      )
    )

    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/turns/00000000-0000-4000-8000-000000000001/interrupt" &&
            request.method === "POST"
        )
      ).toHaveLength(1)
    )
    await waitFor(() => expect(composer).toHaveValue(""))
    await waitFor(() =>
      expect(
        document.querySelector('button[aria-label="正在中断…"]')
      ).toBeNull()
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("queues a consecutive submission with a distinct operation", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 3_000 }
    )
    await interaction.type(composer, "第一条连续消息")
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(composer).toHaveValue(""))
    await waitFor(() => expect(composer).toBeEnabled(), { timeout: 3_000 })

    await interaction.type(composer, "紧接着发送第二条消息")
    await interaction.keyboard("{Enter}")

    await waitFor(
      () => {
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1/turns" &&
              request.method === "POST"
          )
        ).toHaveLength(1)
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1/pending-requests" &&
              request.method === "POST"
          )
        ).toHaveLength(1)
      },
      { timeout: 3_000 }
    )
    const turnRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/turns" &&
        request.method === "POST"
    )
    const pendingRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/pending-requests" &&
        request.method === "POST"
    )
    expect(turnRequests[0]?.body).toEqual({
      input_text: "第一条连续消息",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      collaboration_mode: "default",
      idempotency_key: expect.any(String),
    })
    expect(pendingRequests[0]?.body).toEqual({
      input_text: "紧接着发送第二条消息",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      collaboration_mode: "default",
      idempotency_key: expect.any(String),
    })
    expect(
      (turnRequests[0]?.body as { idempotency_key: string }).idempotency_key
    ).not.toBe(
      (pendingRequests[0]?.body as { idempotency_key: string }).idempotency_key
    )
  })

  it("stores an attachment-only running follow-up as a pending request", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        attachments: [
          {
            id: "draft-attachment-1",
            name: "补充材料.pdf",
            kind: "attachment",
            status: "staged",
            size: 1024,
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.click(composer)
    await interaction.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/pending-requests" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps a queued follow-up in the composer when the pending limit is reached", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: Array.from({ length: 5 }, (_, index) => ({
          id: `pending-${index + 1}`,
          queue_no: index + 1,
          status: "waiting_previous_turn",
        })),
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "只补充一条文字说明"
    )
    await interaction.keyboard("{Enter}")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最多只能保留 5 条后续请求，请先处理已有请求。"
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
      "只补充一条文字说明"
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/pending-requests" &&
          request.method === "POST"
      )
    ).toBe(false)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("queues a steer default follow-up with selected capabilities instead of dropping context", async () => {
    const { requests } = installApiMock({
      userOverride: { running_message_action: "steer" },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByText("报告写作"))
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "补充新的写作要求"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/pending-requests" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "补充新的写作要求",
        priority_capability_ids: ["s1"],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(
      await screen.findByText(
        "当前补充包含附件或指定插件/Skill，已自动排队为下一条请求。"
      )
    ).toBeVisible()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
