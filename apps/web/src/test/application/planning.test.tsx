import { nativeReconnectStorageKeyPrefix } from "@/features/conversations/native-reconnect-simulation"
import { stableOperationId } from "@/features/conversations/operation-id"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  type PlanReviewFixtureDecision,
  conversation,
  installApiMock,
  json,
  planReviewConversationFixture,
  planReviewFixtureIds,
  renderApp,
} from "./fixture"

describe("LinkSense application", () => {
  setupApplicationTests()
  it("creates and starts a new task with the selected native Plan mode", async () => {
    const planPrompt = "先分析完整实现方案"
    const { requests } = installApiMock({
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            collaboration_mode: "plan",
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [],
            attachments: [],
            artifacts: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
                collaboration_mode: "plan",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
              collaboration_mode: "plan",
            },
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /计划模式/ }))
    expect(screen.getByRole("button", { name: "退出计划模式" })).toBeVisible()
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      planPrompt
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        collaboration_mode: "plan",
        prewarmed_conversation_id: "71000000-0000-4000-8000-000000000001",
      })
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1/turns" &&
            request.method === "POST" &&
            (request.body as { input_text?: string } | undefined)
              ?.input_text === planPrompt
        )?.body
      ).toEqual({
        input_text: planPrompt,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        idempotency_key: expect.any(String),
        collaboration_mode: "plan",
      })
    })
  })

  it("waits for an existing task Plan mode update before submitting", async () => {
    const planPrompt = "先形成计划，再等我确认"
    let resolveModePatch: ((response: Response) => void) | undefined
    const modePatchResponse = new Promise<Response>((resolve) => {
      resolveModePatch = resolve
    })
    const { requests } = installApiMock({
      conversationOverride: {
        collaboration_mode: "default",
        execution_status: "completed",
        draft_input: "",
        turns: [],
        running_turn: null,
        pending_requests: [],
      },
      conversationPatchResponse: async (_conversationId, body) => {
        expect(body).toEqual({ collaboration_mode: "plan" })
        return modePatchResponse
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, planPrompt)
    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /计划模式/ }))

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ collaboration_mode: "plan" })
        )
      ).toBe(true)
    )
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    await interaction.keyboard("{Enter}")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    resolveModePatch?.(
      json({
        success: true,
        data: {
          ...conversation,
          collaboration_mode: "plan",
          execution_status: "completed",
          draft_input: planPrompt,
          turns: [],
          running_turn: null,
          pending_requests: [],
        },
      })
    )
    expect(
      await screen.findByRole("button", { name: "退出计划模式" })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: planPrompt,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "plan",
        idempotency_key: expect.any(String),
      })
    )
  })

  it("renders a completed native plan and starts implementation only after confirmation", async () => {
    let decision: PlanReviewFixtureDecision = null
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({
          success: true,
          data: planReviewConversationFixture(decision),
        }),
      planReviewActionResponse: async (reviewId) => {
        expect(reviewId).toBe(planReviewFixtureIds.review)
        decision = "implement"
        return json(
          {
            success: true,
            data: {
              review: planReviewConversationFixture(decision).plan_reviews[0],
              turn: {
                id: planReviewFixtureIds.followUpTurn,
                status: "running",
                collaboration_mode: "default",
              },
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole("region", { name: "方案" }, { timeout: 3_000 })
    ).toHaveTextContent("完整实施计划")
    const decisionCard = screen
      .getByRole("heading", { name: "实施此计划？" })
      .closest<HTMLElement>('[data-testid="conversation-plan-decision"]')
    const blockingPanel = decisionCard?.closest<HTMLElement>(
      '[data-testid="conversation-blocking-panel"]'
    )
    expect(decisionCard).toBeVisible()
    expect(blockingPanel).not.toBeNull()
    expect(screen.getByRole("log")).toContainElement(blockingPanel ?? null)
    expect(decisionCard?.closest(".conversation-column")).not.toBeNull()
    expect(decisionCard?.closest(".conversation-bottom-stack")).toBeNull()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "是，实施此计划" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              `/api/v1/conversations/c1/plan-reviews/${planReviewFixtureIds.review}/actions` &&
            request.method === "POST"
        )?.body
      ).toEqual({
        action: "implement",
        idempotency_key: expect.any(String),
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "实施此计划？" })
      ).not.toBeInTheDocument()
    )
    expect(screen.queryByText("Implement the plan.")).not.toBeInTheDocument()
  })

  it("removes only the final answer superseded by the native Plan Stop hook", async () => {
    const supersededText = "请切换到可写工作区后重试。"
    const commentaryText = "已核对 GitHub 最近一周的数据来源。"
    const planText = "## Excel 交付计划\n\n1. 整理项目数据\n2. 生成饼图"
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const initialDetail = planReviewConversationFixture(null)
    const finalDetail = planReviewConversationFixture(null)
    const sourceTurn = planReviewFixtureIds.sourceTurn
    const event = (
      sequence: number,
      method: string,
      payload: Record<string, unknown>,
      visibility: "user_visible" | "user_collapsed" = "user_visible"
    ) => {
      const eventId = `c1:${sequence}`
      return `id: ${eventId}\nevent: ${method}\ndata: ${JSON.stringify({
        id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        conversation_id: planReviewFixtureIds.conversation,
        turn_id: sourceTurn,
        sequence_no: sequence,
        event_type: method,
        visibility,
        payload,
        sse_event_id: eventId,
        created_at: `2026-08-10T08:00:${String(sequence).padStart(2, "0")}.000Z`,
      })}\n\n`
    }
    const nativePayload = (
      method: string,
      params: Record<string, unknown>,
      local?: Record<string, unknown>
    ) => ({
      schema_version: 2,
      source: "codex_app_server",
      method,
      params,
      ...(local ? { local } : {}),
    })
    const threadId = "native-thread-plan"
    const nativeTurnId = "native-turn-plan"
    const invalidItemId = "native-invalid-final"
    const eventStreamBody = [
      event(
        31,
        "item/agentMessage/delta",
        nativePayload("item/agentMessage/delta", {
          threadId,
          turnId: nativeTurnId,
          itemId: invalidItemId,
          delta: supersededText,
        })
      ),
      event(
        32,
        "item/completed",
        nativePayload(
          "item/completed",
          {
            threadId,
            turnId: nativeTurnId,
            item: {
              id: invalidItemId,
              type: "agentMessage",
              text: supersededText,
              phase: "final_answer",
            },
          },
          { message_id: "60000000-0000-4000-8000-000000000032" }
        )
      ),
      event(
        33,
        "hook/completed",
        nativePayload(
          "hook/completed",
          {
            threadId,
            turnId: nativeTurnId,
            run: { eventName: "stop", status: "blocked" },
            supersededItemId: invalidItemId,
          },
          {
            superseded_message_id: "60000000-0000-4000-8000-000000000032",
            superseded_item_id: invalidItemId,
          }
        ),
        "user_collapsed"
      ),
      event(
        34,
        "item/completed",
        nativePayload(
          "item/completed",
          {
            threadId,
            turnId: nativeTurnId,
            item: {
              id: "native-plan-item",
              type: "plan",
              text: planText,
            },
          },
          {
            message_id: planReviewFixtureIds.planMessage,
            plan_review_id: planReviewFixtureIds.review,
          }
        )
      ),
    ].join("")

    installApiMock({
      eventStreamBody,
      eventStreamStart,
      conversationGetResponse: async (callIndex) =>
        callIndex === 1
          ? json({
              success: true,
              data: {
                ...initialDetail,
                execution_status: "running",
                messages: [
                  initialDetail.messages[0],
                  {
                    id: "60000000-0000-4000-8000-000000000030",
                    role: "assistant",
                    turn_id: sourceTurn,
                    phase: "commentary",
                    content: commentaryText,
                    created_at: "2026-08-10T08:00:30.000Z",
                  },
                ],
                turns: [
                  {
                    ...initialDetail.turns[0],
                    status: "running",
                    completed_at: null,
                  },
                ],
                running_turn: {
                  ...initialDetail.turns[0],
                  status: "running",
                  completed_at: null,
                },
                plan_reviews: [],
              },
            })
          : refreshResponse,
    })

    renderApp()

    expect(await screen.findByText(commentaryText)).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByRole("region", { name: "方案" })
    ).toHaveTextContent("Excel 交付计划")
    expect(screen.queryByText(supersededText)).not.toBeInTheDocument()

    resolveRefresh?.(
      json({
        success: true,
        data: {
          ...finalDetail,
          messages: [
            finalDetail.messages[0],
            {
              id: "60000000-0000-4000-8000-000000000030",
              role: "assistant",
              turn_id: sourceTurn,
              phase: "commentary",
              content: commentaryText,
              created_at: "2026-08-10T08:00:30.000Z",
            },
            finalDetail.messages[1],
          ],
        },
      })
    )

    expect(
      await screen.findByRole("heading", { name: "实施此计划？" })
    ).toBeVisible()
    expect(screen.queryByText(supersededText)).not.toBeInTheDocument()
  })

  it("uses the follow-up turn mode returned by a plan implementation action", async () => {
    let decision: PlanReviewFixtureDecision = null
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: async (callIndex) =>
        callIndex === 1
          ? json({
              success: true,
              data: planReviewConversationFixture(decision),
            })
          : refreshResponse,
      planReviewActionResponse: async () => {
        decision = "implement"
        return json(
          {
            success: true,
            data: {
              review: planReviewConversationFixture(decision).plan_reviews[0],
              turn: {
                id: planReviewFixtureIds.followUpTurn,
                status: "running",
                collaboration_mode: "plan",
              },
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "是，实施此计划" })
    )

    expect(
      await screen.findByRole("button", { name: "退出计划模式" })
    ).toBeVisible()

    const refreshed = planReviewConversationFixture(decision)
    resolveRefresh?.(
      json({
        success: true,
        data: {
          ...refreshed,
          collaboration_mode: "plan",
          turns: refreshed.turns.map((turn) =>
            turn.id === planReviewFixtureIds.followUpTurn
              ? { ...turn, collaboration_mode: "plan" }
              : turn
          ),
          running_turn: refreshed.running_turn
            ? { ...refreshed.running_turn, collaboration_mode: "plan" }
            : null,
        },
      })
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
  })

  it.each([
    {
      action: "revise" as const,
      buttonName: "否，先修改计划",
      expectedBody: {
        action: "revise",
        feedback: "请补充灰度发布和回滚验证",
        idempotency_key: expect.any(String),
      },
    },
    {
      action: "skip" as const,
      buttonName: "跳过",
      expectedBody: { action: "skip" },
    },
    {
      action: "exit" as const,
      buttonName: "退出计划模式",
      expectedBody: { action: "exit" },
    },
  ])(
    "submits the $action plan decision through its dedicated action",
    async ({ action, buttonName, expectedBody }) => {
      let decision: PlanReviewFixtureDecision = null
      const revisionFeedback = "请补充灰度发布和回滚验证"
      const { requests } = installApiMock({
        conversationGetResponse: async () =>
          json({
            success: true,
            data: planReviewConversationFixture(decision, revisionFeedback),
          }),
        planReviewActionResponse: async () => {
          decision = action
          const resolvedReview = planReviewConversationFixture(
            decision,
            revisionFeedback
          ).plan_reviews[0]
          return json(
            {
              success: true,
              data: {
                review: resolvedReview,
                turn:
                  action === "revise"
                    ? {
                        id: planReviewFixtureIds.followUpTurn,
                        status: "running",
                        collaboration_mode: "plan",
                      }
                    : null,
              },
            },
            action === "revise" ? 202 : 200
          )
        },
      })
      const interaction = userEvent.setup()
      renderApp()

      await screen.findByRole("heading", { name: "实施此计划？" })
      await interaction.click(screen.getByRole("button", { name: buttonName }))
      if (action === "revise") {
        await interaction.type(
          screen.getByRole("textbox", { name: "修改意见" }),
          revisionFeedback
        )
        await interaction.click(
          screen.getByRole("button", { name: "提交修改意见" })
        )
      }

      await waitFor(() =>
        expect(
          requests.find(
            (request) =>
              request.path ===
                `/api/v1/conversations/c1/plan-reviews/${planReviewFixtureIds.review}/actions` &&
              request.method === "POST"
          )?.body
        ).toEqual(expectedBody)
      )
    }
  )

  it("shows token usage admission errors as a plain empty-task notice", async () => {
    installApiMock({
      conversationOverride: {
        messages: [],
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      turnStartResponse: async () =>
        json(
          {
            success: false,
            error_code: "TOKEN_LIMIT_EXCEEDED",
          },
          429
        ),
    })
    const interaction = userEvent.setup()
    const { container } = renderApp()

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const notice = await screen.findByRole("alert")
    expect(notice).toHaveClass("conversation-empty-notice")
    expect(notice).toHaveTextContent(
      "你的可用 Token 额度已用尽，暂时不能发起新任务。"
    )
    expect(notice.querySelector(".lucide-circle-alert")).not.toBeNull()
    expect(notice.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(
      container.querySelector(".conversation-top-overlay-stack")
    ).toBeNull()
  })

  it("blocks starting tasks and shows a dismissible usage card when usage is exhausted", async () => {
    const { requests } = installApiMock({
      userOverride: {
        token_quota: {
          total: null,
          weekly: {
            limit_tokens: "1000",
            used_tokens: "1000",
            remaining_tokens: "0",
            remaining_percentage: 0,
            reset_at: "2026-08-09T16:00:00.000Z",
          },
          monthly: null,
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const quotaTitle = await screen.findByText("Token 用量已达上限")
    const quotaCard = quotaTitle.closest<HTMLElement>(
      ".conversation-token-quota-card"
    )
    expect(quotaCard).not.toBeNull()
    expect(quotaCard).toHaveTextContent(
      "可用 Token 额度已用尽，暂时不能发起新任务或补充请求；正在运行的任务不受影响。"
    )
    expect(
      quotaCard?.closest(".conversation-token-quota-card-dock")?.parentElement
    ).toHaveClass("conversation-bottom-stack")
    expect(
      quotaCard?.closest(".conversation-token-quota-card-dock")
        ?.nextElementSibling
    ).toHaveClass("composer-shell")

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "尝试发起任务")
    const sendButton = screen.getByRole("button", { name: "发送" })
    expect(sendButton).toBeDisabled()
    expect(sendButton).toHaveAttribute("aria-disabled", "true")
    await interaction.keyboard("{Enter}")
    expect(
      requests.some(
        (request) => request.method === "POST" && /\/turns$/u.test(request.path)
      )
    ).toBe(false)

    await interaction.click(
      screen.getByRole("button", { name: "关闭用量提醒" })
    )
    expect(screen.queryByText("Token 用量已达上限")).not.toBeInTheDocument()
    expect(sendButton).toBeDisabled()
  })

  it("keeps the running plan above queued follow-ups in the bottom stack", async () => {
    const interaction = userEvent.setup()
    installApiMock({
      conversationOverride: {
        turn_file_change_counts: { "turn-1": 4 },
        pending_requests: [
          {
            id: "pending-plan-layout-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "页面的数量加到三页吧。",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
        events: [
          {
            id: "plan-event-1",
            type: "turn/plan/updated",
            turn_id: "turn-1",
            sequence_no: 12,
            created_at: "2026-07-14T08:00:12.000Z",
            payload: {
              schema_version: 2,
              source: "codex_app_server",
              method: "turn/plan/updated",
              params: {
                threadId: "thread-native-1",
                turnId: "turn-native-1",
                plan: [
                  { step: "核对现有实现", status: "completed" },
                  { step: "实现输入框上方清单", status: "inProgress" },
                  { step: "完成回归测试", status: "pending" },
                ],
              },
            },
          },
        ],
      },
    })

    const { container } = renderApp()

    const trigger = await screen.findByRole("button", {
      name: "展开执行计划",
    })
    const planCard = trigger.closest<HTMLElement>(
      ".conversation-plan-card-composer"
    )
    const workspace = container.querySelector(".conversation-workspace")
    const bottomStack = container.querySelector(".conversation-bottom-stack")
    const pendingRequests = await screen.findByRole("region", {
      name: "后续请求",
    })
    const composer = await screen.findByRole("form", { name: "任务输入框" })

    expect(planCard).toHaveAttribute("data-placement", "composer")
    expect(planCard?.parentElement).toHaveClass("conversation-plan-dock")
    expect(workspace).toContainElement(planCard)
    expect(bottomStack).toContainElement(planCard)
    expect(planCard?.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(planCard?.parentElement?.nextElementSibling).toBe(pendingRequests)
    expect(pendingRequests.nextElementSibling).toBe(composer)
    expect(
      within(planCard as HTMLElement).getByText("第 2 / 3 步")
    ).toBeVisible()
    expect(
      within(planCard as HTMLElement).queryByText("4 个文件已更改")
    ).toBeNull()
    expect(screen.queryByText("实现输入框上方清单")).toBeNull()

    await interaction.hover(trigger)

    expect(
      screen.getByRole("button", { name: "收起执行计划" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("实现输入框上方清单")).toBeVisible()
  })

  it("shows the readable Codex reasoning summary streamed for the running turn", async () => {
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turnId = "30000000-0000-4000-8000-000000000001"
    const summaryText = "Evaluating test timing reliability"
    const eventId = "c1:13"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "检查测试稳定性",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: item/reasoning/summaryTextDelta\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000013",
          conversation_id: conversationId,
          turn_id: turnId,
          sequence_no: 13,
          event_type: "item/reasoning/summaryTextDelta",
          visibility: "user_collapsed",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "item/reasoning/summaryTextDelta",
            params: {
              threadId: "thread-native-1",
              turnId: "turn-native-1",
              itemId: "reasoning-1",
              summaryIndex: 0,
              delta: summaryText,
            },
          },
          sse_event_id: eventId,
          created_at: "2026-07-15T08:00:13.000Z",
        }
      )}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("正在处理", { exact: true })).toBeVisible()
    expect(await screen.findByText(summaryText, { exact: true })).toBeVisible()
    expect(screen.queryByText("思考内容", { exact: true })).toBeNull()
  })

  it("renders the localized Plan output error streamed by the conversation", async () => {
    const turnId = "30000000-0000-4000-8000-000000000016"
    const eventId = "c1:16"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "先生成计划",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamStart,
      eventStreamBody: `id: ${eventId}\nevent: conversation.error\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000016",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: turnId,
          sequence_no: 16,
          event_type: "conversation.error",
          visibility: "user_visible",
          payload: {
            schema_version: 1,
            error_code: "PLAN_OUTPUT_MISSING",
            message_key: "errors.conversation.planOutputMissing",
            retryable: true,
          },
          sse_event_id: eventId,
          created_at: "2026-08-10T08:00:16.000Z",
        }
      )}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("先生成计划")).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByText("计划模式未生成可确认的计划，请重新发起请求", {
        exact: true,
      })
    ).toBeVisible()
    expect(
      screen.queryByText("本轮执行失败。你可以调整输入后继续重试。", {
        exact: true,
      })
    ).toBeNull()
  })

  it("clears a stale missing-Plan error when the same turn projects its native Plan review", async () => {
    const turnId = "30000000-0000-4000-8000-000000000017"
    const conversationId = "20000000-0000-4000-8000-000000000001"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const planText =
      "# AI 演示文稿计划\n\n## 目标与范围\n规划 10 页内容。\n\n## 实施步骤\n1. 设计结构。\n\n## 验收标准\n检查页数。\n\n## 默认设定与边界\n不在计划阶段生成文件。"
    const errorEvent = `id: c1:17\nevent: conversation.error\ndata: ${JSON.stringify(
      {
        id: "60000000-0000-4000-8000-000000000017",
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 17,
        event_type: "conversation.error",
        visibility: "user_visible",
        payload: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
        sse_event_id: "c1:17",
        created_at: "2026-08-10T08:00:17.000Z",
      }
    )}\n\n`
    const planEvent = `id: c1:18\nevent: item/completed\ndata: ${JSON.stringify(
      {
        id: "60000000-0000-4000-8000-000000000018",
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 18,
        event_type: "item/completed",
        visibility: "user_visible",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            threadId: "thread-native-plan",
            turnId: "turn-native-plan",
            item: {
              id: "native-plan-item",
              type: "plan",
              text: planText,
            },
          },
          local: {
            message_id: "60000000-0000-4000-8000-000000000019",
            plan_review_id: "60000000-0000-4000-8000-000000000020",
          },
        },
        sse_event_id: "c1:18",
        created_at: "2026-08-10T08:00:18.000Z",
      }
    )}\n\n`
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "先生成 PPT 计划",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `${errorEvent}${planEvent}`,
      eventStreamStart,
    })

    renderApp()

    expect(await screen.findByText("先生成 PPT 计划")).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByRole("region", { name: "方案" })
    ).toHaveTextContent("AI 演示文稿计划")
    expect(
      screen.queryByText("计划模式未生成可确认的计划，请重新发起请求。", {
        exact: true,
      })
    ).toBeNull()
  })

  it("starts and persists the inline reconnect simulation for a retryable response stream disconnect", async () => {
    const turnId = "30000000-0000-4000-8000-000000000002"
    const eventId = "c1:14"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "继续完成",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: turnId,
            content: "正在核对实现。",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: error\ndata: ${JSON.stringify({
        id: "60000000-0000-4000-8000-000000000014",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: turnId,
        sequence_no: 14,
        event_type: "error",
        visibility: "user_collapsed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "error",
          params: {
            threadId: "thread-native-1",
            turnId: "turn-native-1",
            willRetry: true,
            error: {
              codexErrorInfo: {
                responseStreamDisconnected: { httpStatusCode: null },
              },
            },
          },
        },
        sse_event_id: eventId,
        created_at: "2026-07-18T08:00:14.000Z",
      })}\n\n`,
    })

    renderApp()

    expect(
      await screen.findByText("正在重新连接 1/5", { exact: true })
    ).toBeVisible()
    expect(screen.queryByText("连接正在恢复", { exact: true })).toBeNull()
    expect(
      JSON.parse(
        window.localStorage.getItem(`${nativeReconnectStorageKeyPrefix}:c1`) ??
          "null"
      )
    ).toMatchObject({
      conversationId: "c1",
      turnId,
      phase: "reconnecting",
      round: 1,
      attempt: 1,
    })
  })

  it("keeps normal thinking for retryable native errors that are not stream disconnects", async () => {
    const turnId = "30000000-0000-4000-8000-000000000002"
    const eventId = "c1:15"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "继续完成",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: turnId,
            content: "正在核对实现。",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: error\ndata: ${JSON.stringify({
        id: "60000000-0000-4000-8000-000000000015",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: turnId,
        sequence_no: 15,
        event_type: "error",
        visibility: "user_collapsed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "error",
          params: {
            threadId: "thread-native-1",
            turnId: "turn-native-1",
            willRetry: true,
            error: { codexErrorInfo: "serverOverloaded" },
          },
        },
        sse_event_id: eventId,
        created_at: "2026-07-18T08:00:15.000Z",
      })}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("正在思考", { exact: true })).toBeVisible()
    expect(screen.queryByText("正在重新连接 1/5", { exact: true })).toBeNull()
    expect(
      window.localStorage.getItem(`${nativeReconnectStorageKeyPrefix}:c1`)
    ).toBeNull()
  })

  it("interrupts an exhausted turn, stops loading, and marks the task with a red warning", async () => {
    window.localStorage.setItem(
      `${nativeReconnectStorageKeyPrefix}:c1`,
      JSON.stringify({
        version: 2,
        conversationId: "c1",
        turnId: "turn-1",
        phase: "failed",
        round: 3,
        attempt: 5,
        startedAtMs: Date.now() - 75_000,
        nextAttemptAtMs: null,
      })
    )
    const { requests } = installApiMock()

    renderApp()

    const inlineError = await screen.findByRole("alert", undefined, {
      timeout: 15_000,
    })
    expect(inlineError).toHaveTextContent(
      "stream disconnected before completion."
    )
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1/turns/turn-1/interrupt",
          method: "POST",
        })
      )
    })

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = within(sidebar).getByText("活动风险评估")
    const item = title.closest(".sidebar-conversation-item")
    const link = title.closest("a")
    expect(item).toHaveAttribute("data-warning", "true")
    expect(item).not.toHaveAttribute("data-running")
    expect(link).not.toHaveAttribute("aria-busy")
    const warning = within(item as HTMLElement).getByRole("img", {
      name: "任务因流连接中断而终止",
    })
    expect(warning).toHaveClass(
      "sidebar-conversation-warning",
      "text-[var(--destructive)]"
    )
    expect(warning.querySelector(".lucide-circle-alert")).toHaveClass(
      "size-3.5"
    )
    expect(
      within(item as HTMLElement).queryByRole("status", { name: "执行中" })
    ).toBeNull()

    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.getByRole("button", { name: "发送" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("已中断", { exact: true })).toBeVisible()
    expect(summary.querySelector('[aria-busy="true"]')).toBeNull()
    expect(summary.querySelector(".animate-spin")).toBeNull()
    expect(summary.querySelector(".shimmer")).toBeNull()
  })

  it("derives the same operation id after a reload for the same submission", async () => {
    const payload = {
      operation: "turn_steer",
      conversation_id: "c1",
      turn_id: "turn-1",
      submitted_at: "2026-07-11T08:00:01.000Z",
    }
    const first = await stableOperationId({ current: null }, payload)
    const afterReload = await stableOperationId({ current: null }, payload)
    const nextSubmission = await stableOperationId(
      { current: null },
      { ...payload, submitted_at: "2026-07-11T08:00:02.000Z" }
    )

    expect(afterReload).toBe(first)
    expect(nextSubmission).not.toBe(first)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
  })

  it("exposes model selection without speed, sandbox, scheduling, or permission controls", async () => {
    installApiMock()
    renderApp()
    await screen.findByRole("form", { name: "任务输入框" })
    expect(
      await screen.findByRole("button", { name: "选择模型与推理强度" })
    ).toBeVisible()
    const forbidden =
      /速度|speed|sandbox|沙箱|执行权限|execution permission|完全访问|full access|项目区|已安排|主题/i
    expect(
      screen.queryByRole("button", { name: forbidden })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: forbidden })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
  })

  it("keeps model selection scoped to each task when navigating between tasks", async () => {
    let releaseSecondTaskModelPreference!: () => void
    const secondTaskModelPreferenceStart = new Promise<void>((resolve) => {
      releaseSecondTaskModelPreference = resolve
    })
    const { requests } = installApiMock({
      modelPreferenceByConversation: {
        c1: "model-a",
        c2: "model-b",
      },
      modelPreferenceStart: (conversationId) =>
        conversationId === "c2"
          ? secondTaskModelPreferenceStart
          : Promise.resolve(),
    })
    const interaction = userEvent.setup()
    renderApp()

    const modelSelector = await screen.findByRole("button", {
      name: "选择模型与推理强度",
    })
    expect(modelSelector).toHaveTextContent("Model A")

    await interaction.click(
      screen.getByRole("link", { name: "整理项目会议纪要" })
    )
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2/model-preference",
          method: "GET",
        })
      )
    )
    expect(
      screen.queryByRole("button", { name: "选择模型与推理强度" })
    ).not.toBeInTheDocument()

    releaseSecondTaskModelPreference()
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Model B")
    })

    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    await interaction.hover(
      await screen.findByRole("menuitem", { name: /^模型/ })
    )
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Test Model" })
    )
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Test Model")
    })
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c2/model-preference" &&
          request.method === "PUT"
      )
    ).toBe(true)

    await interaction.click(screen.getByRole("link", { name: "活动风险评估" }))
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Model A")
    })
  })
})
