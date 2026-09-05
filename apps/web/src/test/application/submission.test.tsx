import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
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
  it("selects and removes a priority Skill", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    expect(
      await screen.findByPlaceholderText("搜索可用插件或 Skill…")
    ).toBeInTheDocument()
    await interaction.click(screen.getByText("报告写作"))
    expect(
      screen.getByRole("button", { name: "移除 报告写作" })
    ).toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "移除 报告写作" })
    )
    expect(
      screen.queryByRole("button", { name: "移除 报告写作" })
    ).not.toBeInTheDocument()
  })

  it("automatically queues a running follow-up using the saved default", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "补充关注雨天预案"
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
        input_text: "补充关注雨天预案",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("blocks the composer and answers a native Plan-mode user-input request", async () => {
    const turnId = "30000000-0000-4000-8000-000000000003"
    const requestId = "30000000-0000-4000-8000-000000000005"
    const { requests } = installApiMock({
      conversationOverride: {
        collaboration_mode: "plan",
        turns: [{ id: turnId, status: "running", collaboration_mode: "plan" }],
        running_turn: {
          id: turnId,
          status: "running",
          collaboration_mode: "plan",
        },
        user_input_requests: [
          {
            id: requestId,
            conversation_id: "20000000-0000-4000-8000-000000000001",
            turn_id: turnId,
            item_id: "native-user-input-item-1",
            kind: "questions",
            questions: [
              {
                id: "scope",
                header: "范围",
                question: "请选择实施范围。",
                is_other: true,
                is_secret: false,
                options: [
                  {
                    label: "完整实现（推荐）",
                    description: "完成前后端与测试。",
                  },
                  { label: "仅做界面", description: "只增加入口。" },
                ],
              },
            ],
            status: "pending",
            auto_resolve_at: null,
            resolved_at: null,
            resolved_action: null,
            created_at: "2026-08-09T08:00:00.000Z",
            updated_at: "2026-08-09T08:00:00.000Z",
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const requestCard = (
      await screen.findByRole(
        "heading",
        { name: "需要你的回答" },
        { timeout: 3_000 }
      )
    ).closest<HTMLElement>('[data-testid="conversation-user-input-request"]')
    const blockingPanel = requestCard?.closest<HTMLElement>(
      '[data-testid="conversation-blocking-panel"]'
    )
    expect(requestCard).toBeVisible()
    expect(blockingPanel).not.toBeNull()
    expect(screen.getByRole("log")).toContainElement(blockingPanel ?? null)
    expect(requestCard?.closest(".conversation-column")).not.toBeNull()
    expect(requestCard?.closest(".conversation-bottom-stack")).toBeNull()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("radio", { name: /完整实现（推荐）/ })
    )
    await interaction.click(screen.getByRole("button", { name: "提交回答" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              `/api/v1/conversations/c1/user-input-requests/${requestId}/respond` &&
            request.method === "POST"
        )?.body
      ).toEqual({
        action: "accept",
        content: { scope: "完整实现（推荐）" },
      })
    )
  })

  it("restores a persisted LinkSense form after refresh when the running-turn snapshot is temporarily different", async () => {
    const requestTurnId = "30000000-0000-4000-8000-000000000013"
    const snapshotTurnId = "30000000-0000-4000-8000-000000000014"
    const requestId = "30000000-0000-4000-8000-000000000015"
    installApiMock({
      conversationOverride: {
        turns: [
          {
            id: requestTurnId,
            status: "running",
            collaboration_mode: "default",
          },
          {
            id: snapshotTurnId,
            status: "running",
            collaboration_mode: "default",
          },
        ],
        running_turn: {
          id: snapshotTurnId,
          status: "running",
          collaboration_mode: "default",
        },
        user_input_requests: [
          {
            id: requestId,
            conversation_id: "20000000-0000-4000-8000-000000000001",
            turn_id: requestTurnId,
            item_id: "linksense-form-31",
            kind: "form",
            server_name: "linksense_core",
            message: "请确认是否创建草稿。",
            requested_schema: {
              type: "object",
              properties: {
                decision: {
                  type: "string",
                  title: "审批结果",
                  oneOf: [
                    { const: "approve", title: "批准创建草稿" },
                    { const: "reject", title: "拒绝" },
                  ],
                },
              },
              required: ["decision"],
            },
            ui_hints: {},
            response_semantics: {
              kind: "approval",
              decision_field_id: "decision",
              approve_value: "approve",
              reject_value: "reject",
            },
            response_content: null,
            status: "pending",
            auto_resolve_at: "2026-08-25T01:15:00.000Z",
            resolved_at: null,
            resolved_action: null,
            created_at: "2026-08-25T01:05:00.000Z",
            updated_at: "2026-08-25T01:05:00.000Z",
          },
        ],
      },
    })

    renderApp()

    expect(
      await screen.findByRole(
        "heading",
        { name: "需要你确认信息" },
        { timeout: 3_000 }
      )
    ).toBeVisible()
    expect(screen.getByText("请确认是否创建草稿。")).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()
  })

  it("restores a queued request to the composer for editing", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-edit-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "补充雨天活动预案",
            priority_capability_ids: ["s1"],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑信息" })
    )

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "补充雨天活动预案"
      )
    )
    expect(screen.getByRole("button", { name: "移除 报告写作" })).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/pending-requests/pending-edit-1/restore-input" &&
          request.method === "POST"
      )
    ).toBe(true)
    expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    expect(
      screen.queryByText("已将排队信息恢复到输入框，可以继续编辑。")
    ).toBeNull()
  })

  it("guides the first plain-text queued request without creating a new turn", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-guide-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "优先检查 AirPods 断开后的麦克风切换。",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(await screen.findByRole("button", { name: "引导" }))

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/pending-requests/pending-guide-1/steer" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    )
    expect(screen.queryByText("已将队首后续请求引导到当前执行。")).toBeNull()
  })

  it("closes a queued request from the details menu", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-close-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "不再需要的补充要求",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "关闭排队" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/pending-requests/pending-close-1" &&
            request.method === "DELETE"
        )
      ).toBe(true)
    )
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    )
    expect(
      screen.queryByText("后续请求已取消，待用附件已恢复为任务草稿附件。")
    ).toBeNull()
  })

  it("automatically guides a running follow-up when the saved default is steer", async () => {
    const { requests } = installApiMock({
      userOverride: { running_message_action: "steer" },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "优先补充风险阈值"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns/turn-1/steer" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        text: "优先补充风险阈值",
        idempotency_key: expect.any(String),
      })
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

  it("keeps Send visible for an attachment-only draft", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        turns: [],
        running_turn: null,
        execution_status: "idle",
        attachments: [
          {
            id: "draft-attachment-1",
            name: "活动简报.pdf",
            kind: "attachment",
            status: "staged",
            size: 1024,
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const input = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeEnabled()
    expect(send).toHaveAttribute("aria-disabled", "false")

    await interaction.type(input, "请分析附件")
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    await waitFor(() => expect(send).toBeEnabled())
    await interaction.click(send)
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "请分析附件",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
  })

  it("keeps submitted files and images out of the composer while stale detail refreshes", async () => {
    const submittedAttachments = [
      {
        id: "draft-file-1",
        name: "成员周报.xlsx",
        mime_type:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        kind: "attachment",
        status: "staged",
        size: 1024,
      },
      {
        id: "draft-image-1",
        name: "活动现场.png",
        mime_type: "image/png",
        kind: "attachment",
        status: "staged",
        size: 2048,
      },
    ]
    let resolveStaleRefresh: ((response: Response) => void) | undefined
    const staleRefresh = new Promise<Response>((resolve) => {
      resolveStaleRefresh = resolve
    })
    let turnAdmitted = false
    let resolveStaleRefreshRequested: (() => void) | undefined
    const staleRefreshRequested = new Promise<void>((resolve) => {
      resolveStaleRefreshRequested = resolve
    })
    installApiMock({
      conversationGetResponse: async () => {
        if (turnAdmitted) {
          resolveStaleRefreshRequested?.()
          return staleRefresh
        }
        return json({
          success: true,
          data: {
            ...conversation,
            execution_status: "completed",
            turns: [{ id: "turn-1", status: "completed" }],
            running_turn: null,
            attachments: submittedAttachments,
          },
        })
      },
      turnStartResponse: async () => {
        turnAdmitted = true
        return json(
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
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composerInput = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 5_000 }
    )
    const composerForm = composerInput.closest("form")
    expect(composerForm).not.toBeNull()
    expect(
      within(composerForm as HTMLFormElement).getByRole("button", {
        name: "移除附件 成员周报.xlsx",
      })
    ).toBeVisible()
    expect(
      within(composerForm as HTMLFormElement).getByRole("button", {
        name: "移除附件 活动现场.png",
      })
    ).toBeVisible()

    await interaction.type(composerInput, "请分析这些附件")
    await interaction.click(
      within(composerForm as HTMLFormElement).getByRole("button", {
        name: "发送",
      })
    )

    expect(
      within(composerForm as HTMLFormElement).queryByRole("button", {
        name: "移除附件 成员周报.xlsx",
      })
    ).toBeNull()
    expect(
      within(composerForm as HTMLFormElement).queryByRole("button", {
        name: "移除附件 活动现场.png",
      })
    ).toBeNull()
    await staleRefreshRequested

    await act(async () => {
      resolveStaleRefresh?.(
        json({
          success: true,
          data: {
            ...conversation,
            title: "刷新详情已返回",
            execution_status: "running",
            turns: [
              { id: "turn-1", status: "completed" },
              {
                id: "00000000-0000-4000-8000-000000000001",
                status: "running",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000001",
              status: "running",
            },
            attachments: submittedAttachments,
          },
        })
      )
      await staleRefresh
    })

    await screen.findByText("刷新详情已返回")
    expect(
      within(composerForm as HTMLFormElement).queryByRole("button", {
        name: "移除附件 成员周报.xlsx",
      })
    ).toBeNull()
    expect(
      within(composerForm as HTMLFormElement).queryByRole("button", {
        name: "移除附件 活动现场.png",
      })
    ).toBeNull()
  })

  it("returns to the latest message immediately when sending a new turn", async () => {
    installApiMock({
      conversationOverride: {
        draft_input: "",
        execution_status: "completed",
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const log = await screen.findByRole("log")
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, get: () => 2_000 },
      clientHeight: { configurable: true, get: () => 500 },
    })
    log.scrollTop = 800
    fireEvent.wheel(log, { deltaY: -200 })
    fireEvent.scroll(log)
    const scrollToBottomButton = await screen.findByRole("button", {
      name: "回到底部",
    })
    expect(scrollToBottomButton).toBeVisible()
    expect(scrollToBottomButton).toHaveClass("size-9")

    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "请补充风险建议"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    expect(log.scrollTop).toBe(2_000)
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
  })

  it("shows the active task loading indicator immediately when sending a new turn", async () => {
    let resolveTurnStart: ((response: Response) => void) | undefined
    const pendingTurnStart = new Promise<Response>((resolve) => {
      resolveTurnStart = resolve
    })
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        execution_status: "completed",
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
      },
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? { ...item, execution_status: "completed" }
                : item
            ),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      turnStartResponse: () => pendingTurnStart,
    })
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const title = await within(sidebar).findByText("活动风险评估")
    const item = title.closest(".sidebar-conversation-item")
    expect(item).not.toBeNull()
    expect(
      within(item as HTMLElement).queryByRole("status", { name: "执行中" })
    ).toBeNull()

    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "请补充风险建议"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")

    const detailRequestCountBeforeAdmission = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1" && request.method === "GET"
    ).length
    await act(async () => {
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
      await pendingTurnStart
    })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeAdmission)
    )
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")
  })

  it("keeps a just-submitted task running after immediately switching tasks", async () => {
    const submittedTurnId = "30000000-0000-4000-8000-000000000084"
    let releaseTurnStart: (() => void) | undefined
    const turnStartReady = new Promise<void>((resolve) => {
      releaseTurnStart = resolve
    })
    const completedConversation = {
      ...conversation,
      execution_status: "completed",
      turns: [{ id: "turn-1", status: "completed" }],
      running_turn: null,
    }
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({ success: true, data: completedConversation }),
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
      turnStartResponse: async () => {
        await turnStartReady
        return json(
          {
            success: true,
            data: {
              turn_id: submittedTurnId,
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

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const submittedTaskTitle = await within(sidebar).findByText(
      "活动风险评估",
      undefined,
      { timeout: 5_000 }
    )
    const submittedTask = submittedTaskTitle.closest(
      ".sidebar-conversation-item"
    )
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "立即切换任务也要保持执行中"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    expect(submittedTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")
    expect(
      within(submittedTask as HTMLElement).getByRole("status", {
        name: "执行中",
      })
    ).toBeVisible()

    await interaction.click(within(sidebar).getByText("整理项目会议纪要"))
    expect(
      await screen.findByText("整理项目会议纪要已加载。", undefined, {
        timeout: 5_000,
      })
    ).toBeVisible()
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    expect(submittedTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")
    expect(
      within(submittedTask as HTMLElement).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).toBeNull()

    await act(async () => releaseTurnStart?.())
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    await interaction.click(within(sidebar).getByText("活动风险评估"))
    expect(
      await screen.findByText("立即切换任务也要保持执行中", undefined, {
        timeout: 5_000,
      })
    ).toBeVisible()
    expect(
      within(submittedTask as HTMLElement).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).toBeNull()
    expect(submittedTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")
  })

  it("keeps visible streamed output when switching away and back before completion", async () => {
    const partialText = "已经生成的回复切换任务后仍然可见。"
    const continuedText = "切换回来后新增的回复也会继续显示。"
    const localTurnId = "30000000-0000-4000-8000-000000000090"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const eventStreamBody = (sequence: number, delta: string) =>
      `id: c1:${sequence}\nevent: item/agentMessage/delta\ndata: ${JSON.stringify(
        {
          id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: localTurnId,
          sequence_no: sequence,
          event_type: "item/agentMessage/delta",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "item/agentMessage/delta",
            params: {
              threadId: "thread-native-switch",
              turnId: "turn-native-switch",
              itemId: "native-switch-stream",
              delta,
            },
          },
          sse_event_id: `c1:${sequence}`,
          created_at: "2026-08-13T08:00:01.000Z",
        }
      )}\n\n`
    const apiOptions: NonNullable<Parameters<typeof installApiMock>[0]> = {
      eventStreamBody: eventStreamBody(91, partialText),
      eventStreamStart,
      conversationGetResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [{ id: localTurnId, status: "running" }],
            running_turn: { id: localTurnId, status: "running" },
            last_event_id: "c1:0",
          },
        }),
    }
    const { requests } = installApiMock(apiOptions)
    const interaction = userEvent.setup()
    renderApp()

    await screen.findByRole("log", undefined, { timeout: 10_000 })
    await act(async () => releaseEventStream?.())
    expect(
      await screen.findByText(partialText, undefined, { timeout: 10_000 })
    ).toBeVisible()
    // Keep the replacement foreground stream empty so this assertion proves
    // that navigation restores content already rendered before the switch.
    apiOptions.eventStreamBody = undefined

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(within(sidebar).getByText("整理项目会议纪要"))
    expect(await screen.findByText("整理项目会议纪要已加载。")).toBeVisible()
    expect(screen.queryByText(partialText)).toBeNull()

    let releaseContinuedEventStream: (() => void) | undefined
    apiOptions.eventStreamStart = new Promise<void>((resolve) => {
      releaseContinuedEventStream = resolve
    })
    apiOptions.eventStreamBody = eventStreamBody(92, continuedText)
    const eventStreamRequestCountBeforeReturn = requests.filter(
      (request) => request.path === "/api/v1/conversations/c1/events"
    ).length
    await interaction.click(within(sidebar).getByText("活动风险评估"))

    expect(await screen.findByText(partialText)).toBeVisible()
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    await waitFor(() => {
      const eventStreamRequestCount = requests.filter(
        (request) => request.path === "/api/v1/conversations/c1/events"
      ).length
      expect(eventStreamRequestCount).toBeGreaterThan(
        eventStreamRequestCountBeforeReturn
      )
    })

    await act(async () => releaseContinuedEventStream?.())

    expect(
      await screen.findByText(`${partialText}${continuedText}`, undefined, {
        timeout: 10_000,
      })
    ).toBeVisible()
  }, 15_000)

  it("clears a submitted task after its terminal event when the user switched away", async () => {
    const submittedTurnId = "30000000-0000-4000-8000-000000000085"
    let releaseCompletion: (() => void) | undefined
    const completionReady = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    const precedingConversationSnapshot = {
      ...conversation,
      execution_status: "completed",
      turns: [{ id: "turn-1", status: "completed" }],
      running_turn: null,
    }
    const eventId = "c1:85"
    let completionPersisted = false
    const completedConversationSnapshot = {
      ...precedingConversationSnapshot,
      messages: [
        ...(precedingConversationSnapshot.messages ?? []),
        {
          id: "submitted-background-user-message",
          role: "user",
          turn_id: submittedTurnId,
          content: "切换任务后也要正确结束",
          created_at: "2026-08-13T08:00:00.000Z",
        },
        {
          id: "submitted-background-assistant-message",
          role: "assistant",
          turn_id: submittedTurnId,
          item_id: "submitted-background-answer",
          phase: "final_answer",
          content: "切换回来后可以直接看到最终结果。",
          created_at: "2026-08-13T08:00:02.000Z",
        },
      ],
      turns: [
        ...(precedingConversationSnapshot.turns ?? []),
        {
          id: submittedTurnId,
          status: "completed",
          started_at: "2026-08-13T08:00:00.000Z",
          completed_at: "2026-08-13T08:00:03.000Z",
        },
      ],
      last_event_id: eventId,
    }
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({
          success: true,
          data: completionPersisted
            ? completedConversationSnapshot
            : precedingConversationSnapshot,
        }),
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) => ({
              ...item,
              execution_status: item.id === "c1" ? "running" : "completed",
            })),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      turnStartResponse: async () =>
        json(
          {
            success: true,
            data: {
              turn_id: submittedTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        ),
      eventStreamStart: completionReady,
      eventStreamBody: `id: ${eventId}\nevent: turn/completed\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000085",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: submittedTurnId,
          sequence_no: 85,
          event_type: "turn/completed",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/completed",
            params: {
              threadId: "thread-submitted-background",
              turn: {
                id: "native-submitted-background",
                status: "completed",
              },
            },
          },
          sse_event_id: eventId,
          created_at: "2026-08-13T08:00:03.000Z",
        }
      )}\n\n`,
    })
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const submittedTaskTitle = await within(sidebar).findByText("活动风险评估")
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/events" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(1)
    )
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "切换任务后也要正确结束"
    )
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

    await interaction.click(within(sidebar).getByText("整理项目会议纪要"))
    expect(submittedTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/events" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    )
    completionPersisted = true
    await act(async () => releaseCompletion?.())

    await waitFor(() =>
      expect(submittedTaskTitle.closest("a")).not.toHaveAttribute("aria-busy")
    )
    await interaction.click(submittedTaskTitle)
    await waitFor(() =>
      expect(
        screen.queryByText("正在思考", { exact: true })
      ).not.toBeInTheDocument()
    )
    expect(
      await screen.findByText("切换回来后可以直接看到最终结果。")
    ).toBeVisible()
    expect(
      screen.queryByText("本轮执行已结束，但没有产出可展示的内容，请重新执行。")
    ).toBeNull()
  })

  it("ends a background task loading state from its completion event without polling the task list", async () => {
    const previousTurnId = "30000000-0000-4000-8000-000000000081"
    const backgroundTurnId = "30000000-0000-4000-8000-000000000082"
    const eventId = "c2:82"
    let releaseCompletion: (() => void) | undefined
    const completionReady = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    let backgroundDetailCalls = 0
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? { ...item, execution_status: "completed" }
                : item.id === "c2"
                  ? { ...item, execution_status: "running" }
                  : item
            ),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      conversationDetailResponse: async (conversationId) => {
        if (conversationId === "c2") backgroundDetailCalls += 1
        const completed = conversationId === "c2" && backgroundDetailCalls > 1
        return json({
          success: true,
          data: {
            ...conversation,
            ...conversations.find((item) => item.id === conversationId),
            execution_status: completed ? "completed" : "running",
            messages: completed
              ? [
                  {
                    id: "background-user-message",
                    role: "user",
                    turn_id: backgroundTurnId,
                    content: "请整理项目会议纪要",
                    created_at: "2026-08-13T08:00:00.000Z",
                  },
                  {
                    id: "background-assistant-message",
                    role: "assistant",
                    turn_id: backgroundTurnId,
                    item_id: "native-background-answer",
                    phase: "final_answer",
                    content: "项目会议纪要已经整理完成。",
                    created_at: "2026-08-13T08:00:01.000Z",
                  },
                ]
              : [],
            turns: [
              {
                id: backgroundTurnId,
                status: completed ? "completed" : "running",
                started_at: "2026-08-13T08:00:00.000Z",
                ...(completed
                  ? { completed_at: "2026-08-13T08:00:02.000Z" }
                  : {}),
              },
            ],
            running_turn: completed
              ? null
              : { id: backgroundTurnId, status: "running" },
            last_event_id: completed ? eventId : "c2:79",
          },
        })
      },
      backgroundEventStreams: {
        c2: {
          start: completionReady,
          body: [
            `id: c2:80\nevent: turn/completed\ndata: ${JSON.stringify({
              id: "60000000-0000-4000-8000-000000000080",
              conversation_id: "20000000-0000-4000-8000-000000000002",
              turn_id: previousTurnId,
              sequence_no: 80,
              event_type: "turn/completed",
              visibility: "user_visible",
              payload: {
                schema_version: 2,
                source: "codex_app_server",
                method: "turn/completed",
                params: {
                  threadId: "thread-background",
                  turn: {
                    id: "native-previous-turn",
                    status: "completed",
                  },
                },
              },
              sse_event_id: "c2:80",
              created_at: "2026-08-13T08:00:01.000Z",
            })}\n\n`,
            `id: c2:81\nevent: item/completed\ndata: ${JSON.stringify({
              id: "60000000-0000-4000-8000-000000000081",
              conversation_id: "20000000-0000-4000-8000-000000000002",
              turn_id: backgroundTurnId,
              sequence_no: 81,
              event_type: "item/completed",
              visibility: "user_visible",
              payload: {
                schema_version: 2,
                source: "codex_app_server",
                method: "item/completed",
                params: {
                  threadId: "thread-background",
                  turnId: "native-background-turn",
                  item: {
                    id: "native-background-answer",
                    type: "agentMessage",
                    text: "项目会议纪要已经整理完成。",
                    phase: "final_answer",
                  },
                },
                local: {
                  message_id: "background-assistant-message",
                },
              },
              sse_event_id: "c2:81",
              created_at: "2026-08-13T08:00:01.000Z",
            })}\n\n`,
            `id: ${eventId}\nevent: turn/completed\ndata: ${JSON.stringify({
              id: "60000000-0000-4000-8000-000000000082",
              conversation_id: "20000000-0000-4000-8000-000000000002",
              turn_id: backgroundTurnId,
              sequence_no: 82,
              event_type: "turn/completed",
              visibility: "user_visible",
              payload: {
                schema_version: 2,
                source: "codex_app_server",
                method: "turn/completed",
                params: {
                  threadId: "thread-background",
                  turn: {
                    id: "native-background-turn",
                    status: "completed",
                  },
                },
              },
              sse_event_id: eventId,
              created_at: "2026-08-13T08:00:02.000Z",
            })}\n\n`,
          ].join(""),
        },
      },
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const backgroundTitle = await within(sidebar).findByText("整理项目会议纪要")
    const backgroundItem = backgroundTitle.closest(".sidebar-conversation-item")
    expect(backgroundTitle.closest("a")).toHaveAttribute("aria-busy", "true")

    await act(async () => releaseCompletion?.())

    await waitFor(() => expect(backgroundDetailCalls).toBeGreaterThanOrEqual(2))
    await waitFor(() =>
      expect(backgroundTitle.closest("a")).not.toHaveAttribute("aria-busy")
    )
    expect(
      within(backgroundItem as HTMLElement).getByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).toBeVisible()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c2" &&
          request.method === "GET"
      )
    ).toHaveLength(2)

    await userEvent.setup().click(backgroundTitle)
    expect(await screen.findByText("项目会议纪要已经整理完成。")).toBeVisible()
    expect(
      screen.queryByText("本轮执行已结束，但没有产出可展示的内容，请重新执行。")
    ).toBeNull()
  })

  it("ends the active task loading state as soon as its completion event arrives", async () => {
    const activeTurnId = "30000000-0000-4000-8000-000000000083"
    const eventId = "c1:83"
    let releaseCompletion: (() => void) | undefined
    const completionReady = new Promise<void>((resolve) => {
      releaseCompletion = resolve
    })
    const pendingDetailRefresh = new Promise<Response>(() => undefined)
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
      },
      conversationGetResponse: async (callIndex) =>
        callIndex === 1
          ? json({
              success: true,
              data: {
                ...conversation,
                execution_status: "completed",
                turns: [{ id: "turn-1", status: "completed" }],
                running_turn: null,
              },
            })
          : callIndex === 2
            ? json({
                success: true,
                data: {
                  ...conversation,
                  execution_status: "running",
                  messages: [
                    {
                      id: "active-terminal-user-message",
                      role: "user",
                      turn_id: activeTurnId,
                      content: "完成后立即结束加载",
                      created_at: "2026-08-13T08:00:00.000Z",
                    },
                  ],
                  turns: [{ id: activeTurnId, status: "running" }],
                  running_turn: { id: activeTurnId, status: "running" },
                  last_event_id: "c1:82",
                },
              })
            : pendingDetailRefresh,
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? { ...item, execution_status: "completed" }
                : item
            ),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      turnStartResponse: async () =>
        json(
          {
            success: true,
            data: {
              turn_id: activeTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        ),
      eventStreamStart: completionReady,
      eventStreamBody: `id: ${eventId}\nevent: turn/completed\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000083",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: activeTurnId,
          sequence_no: 83,
          event_type: "turn/completed",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/completed",
            params: {
              threadId: "thread-active",
              turn: { id: "native-active-turn", status: "completed" },
            },
          },
          sse_event_id: eventId,
          created_at: "2026-08-13T08:00:03.000Z",
        }
      )}\n\n`,
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 5_000 }
    )
    await interaction.type(composer, "完成后立即结束加载")
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    expect(await screen.findByRole("button", { name: "停止" })).toBeVisible()

    await act(async () => releaseCompletion?.())

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    )
    expect(
      screen.queryByText("本轮执行已结束，但没有产出可展示的内容，请重新执行。")
    ).toBeNull()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  })

  it("keeps interrupt progress scoped to the task being stopped", async () => {
    const interruptedTurnId = "30000000-0000-4000-8000-000000000086"
    const otherTurnId = "30000000-0000-4000-8000-000000000087"
    let resolveInterrupt!: (response: Response) => void
    const pendingInterrupt = new Promise<Response>((resolve) => {
      resolveInterrupt = resolve
    })
    installApiMock({
      conversationOverride: {
        execution_status: "running",
        turns: [{ id: interruptedTurnId, status: "running" }],
        running_turn: { id: interruptedTurnId, status: "running" },
      },
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) => ({
              ...item,
              execution_status:
                item.id === "c1" || item.id === "c2"
                  ? "running"
                  : item.execution_status,
            })),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      conversationDetailResponse: async (conversationId) =>
        json({
          success: true,
          data: {
            ...conversation,
            ...conversations.find((item) => item.id === conversationId),
            execution_status: "running",
            messages: [],
            turns: [{ id: otherTurnId, status: "running" }],
            running_turn: { id: otherTurnId, status: "running" },
          },
        }),
      interruptResponse: () => pendingInterrupt,
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "停止" }, { timeout: 5_000 })
    )
    expect(screen.getByRole("button", { name: "正在中断…" })).toBeDisabled()

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(within(sidebar).getByText("整理项目会议纪要"))

    const otherTaskStop = await screen.findByRole("button", { name: "停止" })
    expect(otherTaskStop).toBeEnabled()

    await act(async () =>
      resolveInterrupt(
        json(
          {
            success: false,
            error_code: "TURN_INTERRUPT_FAILED",
            message: "停止任务失败",
          },
          500
        )
      )
    )
    await waitFor(() => expect(otherTaskStop).toBeEnabled())
    expect(document.querySelector(".conversation-banner-stack")).toBeNull()
  })
})
