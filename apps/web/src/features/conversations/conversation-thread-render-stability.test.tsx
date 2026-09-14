import { act, cleanup, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  Conversation,
  ConversationActivity,
  ConversationEvent,
  ConversationFile,
  ConversationMessage,
} from "@/api/contracts"
import {
  AssistantMarkdown,
  ConversationThread,
} from "@/features/conversations/conversation-thread"
import { ReasoningSummaryMarkdown } from "@/features/conversations/reasoning-summary-markdown"
import {
  appendStreamingMessageDelta,
  applyStreamingMessageLifecycle,
} from "@/features/conversations/streaming-messages"
import i18n from "@/i18n"

const runningTurn = {
  id: "turn-render-stability",
  status: "running" as const,
  started_at: "2026-08-02T08:00:00.000Z",
  completed_at: null,
}

const userMessage: ConversationMessage = {
  id: "message-user-render-stability",
  role: "user",
  turn_id: runningTurn.id,
  content: "请继续处理",
  created_at: "2026-08-02T08:00:00.000Z",
}

const firstCommentary: ConversationMessage = {
  id: "message-commentary-render-stability-1",
  role: "assistant",
  turn_id: runningTurn.id,
  item_id: "item-commentary-render-stability-1",
  phase: "commentary",
  content: "第一段稳定内容",
  event_sequence_no: 1,
  created_at: "2026-08-02T08:00:01.000Z",
  streaming: false,
}

function createConversation(
  messages: ConversationMessage[],
  events: ConversationEvent[] = [],
  activities: ConversationActivity[] = []
): Conversation {
  return {
    id: "conversation-render-stability",
    title: "消息流渲染稳定性",
    archived: false,
    category_id: null,
    collaboration_mode: "default",
    user_input_requests: [],
    updated_at: "2026-08-02T08:00:02.000Z",
    has_unread_completion: false,
    has_automation: false,
    messages,
    turns: [runningTurn],
    running_turn: runningTurn,
    activities,
    events,
  }
}

function nativeCommandLifecycleEvent({
  id,
  itemId,
  sequence,
  method,
  status,
  command,
}: {
  id: string
  itemId: string
  sequence: number
  method: "item/started" | "item/completed"
  status: string
  command?: string
}): ConversationEvent {
  return {
    id,
    type: method,
    turn_id: runningTurn.id,
    sequence_no: sequence,
    created_at: `2026-08-02T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method,
      params: {
        threadId: "thread-render-stability",
        turnId: "native-turn-render-stability",
        item: {
          id: itemId,
          type: "commandExecution",
          status,
          commandActions: command
            ? [{ type: "unknown" as const, command }]
            : [],
          ...(command ? { command } : {}),
        },
      },
    },
  }
}

function legacyToolActivity({
  id,
  type,
  status,
}: {
  id: string
  type: string
  status: string
}): ConversationActivity {
  return {
    id,
    turn_id: runningTurn.id,
    item_id: "legacy-tool-render-stability",
    type,
    status,
    sequence_no: 1,
    created_at: "2026-08-02T08:00:01.000Z",
  }
}

function tentativeFinalStartedEvent(itemId: string): ConversationEvent {
  return {
    id: `event-started-${itemId}`,
    type: "item/started",
    turn_id: runningTurn.id,
    sequence_no: 2,
    created_at: "2026-08-02T08:00:02.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/started",
      params: {
        threadId: "thread-render-stability",
        turnId: "native-turn-render-stability",
        item: {
          id: itemId,
          type: "agentMessage",
          phase: "final_answer",
          text: "",
        },
      },
    },
  }
}

function completedCommentaryEvent(
  itemId: string,
  content: string
): ConversationEvent {
  return {
    id: `event-completed-${itemId}`,
    type: "item/completed",
    turn_id: runningTurn.id,
    sequence_no: 4,
    created_at: "2026-08-02T08:00:04.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-render-stability",
        turnId: "native-turn-render-stability",
        item: {
          id: itemId,
          type: "agentMessage",
          phase: "commentary",
          text: content,
        },
      },
    },
  }
}

describe("conversation stream render stability", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("keeps one status row through thinking and rapid tool lifecycle changes", () => {
    vi.useFakeTimers()
    const messages = [userMessage, firstCommentary]
    const started = nativeCommandLifecycleEvent({
      id: "first-started",
      itemId: "first",
      sequence: 2,
      method: "item/started",
      status: "inProgress",
      command: "pnpm test",
    })
    const completed = nativeCommandLifecycleEvent({
      id: "first-completed",
      itemId: "first",
      sequence: 3,
      method: "item/completed",
      status: "completed",
      command: "pnpm test",
    })
    const nextStarted = nativeCommandLifecycleEvent({
      id: "next-started",
      itemId: "next",
      sequence: 4,
      method: "item/started",
      status: "inProgress",
      command: "pnpm build",
    })
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation(messages)}
        onDownload={vi.fn()}
      />
    )
    const label = screen.getByText("正在思考", { exact: true })
    const row = label.closest('[data-slot="marker"]')
    act(() => vi.advanceTimersByTime(100))
    rerender(
      <ConversationThread
        conversation={createConversation(messages, [started])}
        onDownload={vi.fn()}
      />
    )
    expect(screen.getByText("正在思考", { exact: true })).toBe(label)
    act(() => vi.advanceTimersByTime(900))
    expect(screen.getByText("正在运行一个命令")).toBe(label)
    expect(label.closest('[data-slot="marker"]')).toBe(row)
    act(() => vi.advanceTimersByTime(100))
    rerender(
      <ConversationThread
        conversation={createConversation(messages, [started, completed])}
        onDownload={vi.fn()}
      />
    )
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
    expect(label).toHaveTextContent("正在运行一个命令")
    act(() => vi.advanceTimersByTime(100))
    rerender(
      <ConversationThread
        conversation={createConversation(messages, [
          started,
          completed,
          nextStarted,
        ])}
        onDownload={vi.fn()}
      />
    )
    act(() => vi.advanceTimersByTime(800))
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
    expect(screen.getByText("正在运行一个命令")).toBe(label)
    expect(label.closest('[data-slot="marker"]')).toBe(row)
    expect(row?.parentElement?.querySelectorAll(".shimmer")).toHaveLength(1)
  })

  it.each(["completed", "failed", "interrupted"] as const)(
    "immediately settles the activity row when a turn becomes %s during a pending status switch",
    (status) => {
      vi.useFakeTimers()
      const messages = [userMessage, firstCommentary]
      const started = nativeCommandLifecycleEvent({
        id: "started-before-stop",
        itemId: "tool-before-stop",
        sequence: 2,
        method: "item/started",
        status: "inProgress",
        command: "pnpm test",
      })
      const { container, rerender } = render(
        <ConversationThread
          conversation={createConversation(messages)}
          defaultActivityOpen
          onDownload={vi.fn()}
        />
      )
      act(() => vi.advanceTimersByTime(100))
      rerender(
        <ConversationThread
          conversation={createConversation(messages, [started])}
          defaultActivityOpen
          onDownload={vi.fn()}
        />
      )
      expect(screen.getByText("正在思考", { exact: true })).toBeVisible()
      rerender(
        <ConversationThread
          conversation={{
            ...createConversation(messages, [started]),
            turns: [
              {
                ...runningTurn,
                status,
                completed_at: "2026-08-02T08:00:05.000Z",
              },
            ],
            running_turn: null,
          }}
          defaultActivityOpen
          onDownload={vi.fn()}
        />
      )
      expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
      expect(screen.getByText("运行了一个命令")).toBeVisible()
      expect(container.querySelector('[aria-busy="true"]')).toBeNull()
      act(() => vi.advanceTimersByTime(2_000))
      expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
      expect(screen.queryByText("正在运行一个命令")).toBeNull()
    }
  )

  it("immediately removes a held thinking label when input is requested", () => {
    vi.useFakeTimers()
    const messages = [userMessage, firstCommentary]
    const started = nativeCommandLifecycleEvent({
      id: "started-before-input",
      itemId: "tool-before-input",
      sequence: 2,
      method: "item/started",
      status: "inProgress",
      command: "pnpm test",
    })
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation(messages)}
        onDownload={vi.fn()}
      />
    )
    act(() => vi.advanceTimersByTime(100))
    rerender(
      <ConversationThread
        conversation={createConversation(messages, [started])}
        onDownload={vi.fn()}
      />
    )
    expect(screen.getByText("正在思考", { exact: true })).toBeVisible()
    rerender(
      <ConversationThread
        conversation={{
          ...createConversation(messages, [started]),
          user_input_requests: [
            {
              id: "30000000-0000-4000-8000-000000000007",
              conversation_id: "conversation-render-stability",
              turn_id: runningTurn.id,
              item_id: "form-request",
              kind: "form",
              server_name: "linksense_core",
              message: "请选择处理方式",
              requested_schema: { type: "object", properties: {} },
              ui_hints: {},
              response_semantics: { kind: "input" },
              response_content: null,
              status: "pending",
              auto_resolve_at: null,
              resolved_at: null,
              resolved_action: null,
              created_at: "2026-08-02T08:00:03.000Z",
              updated_at: "2026-08-02T08:00:03.000Z",
            },
          ],
        }}
        onDownload={vi.fn()}
      />
    )
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
  })

  it("updates the same status row with readable reasoning between tool calls", () => {
    const conversation = createConversation([userMessage, firstCommentary])
    const { rerender } = render(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )
    const label = screen.getByText("正在思考", { exact: true })
    rerender(
      <ConversationThread
        conversation={conversation}
        onDownload={vi.fn()}
        liveReasoningSummaries={{
          reasoning: {
            itemId: "reasoning",
            turnId: runningTurn.id,
            summaryIndex: 0,
            text: "**Comparing URL parsing options**",
            createdAt: "2026-08-02T08:00:02.000Z",
            sequence: 2,
          },
        }}
      />
    )
    expect(screen.getByText("Comparing URL parsing options")).toBe(label)
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
  })

  it("keeps the summary through native completion and removes it when the turn ends", () => {
    const messages = [userMessage, firstCommentary]
    const liveReasoningSummaries = {
      current: {
        itemId: "reasoning",
        turnId: runningTurn.id,
        summaryIndex: 0,
        text: "**Checking results**",
        sequence: 2,
        createdAt: "2026-08-02T08:00:02.000Z",
      },
    }
    const { container, rerender } = render(
      <ConversationThread
        conversation={createConversation(messages)}
        liveReasoningSummaries={liveReasoningSummaries}
        onDownload={vi.fn()}
      />
    )
    const label = screen.getByText("Checking results")
    const event: ConversationEvent = {
      id: "reasoning-completed",
      type: "item/completed",
      turn_id: runningTurn.id,
      sequence_no: 3,
      created_at: "2026-08-02T08:00:03.000Z",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "native-thread",
          turnId: "native-turn",
          item: {
            id: "reasoning",
            type: "reasoning",
            summary: ["**Checking results**"],
          },
        },
      },
    }
    const conversation = createConversation(messages, [event])
    rerender(
      <ConversationThread conversation={conversation} onDownload={vi.fn()} />
    )
    expect(screen.getByText("Checking results")).toBe(label)
    expect(screen.queryByText("正在思考", { exact: true })).toBeNull()
    rerender(
      <ConversationThread
        conversation={{
          ...conversation,
          turns: [
            {
              ...runningTurn,
              status: "completed",
              completed_at: "2026-08-02T08:00:04.000Z",
            },
          ],
          running_turn: null,
        }}
        liveReasoningSummaries={liveReasoningSummaries}
        onDownload={vi.fn()}
      />
    )
    expect(screen.queryByText("Checking results")).toBeNull()
    expect(container.querySelector(".turn-thinking-activity")).toBeNull()
  })

  it("does not re-render completed commentary when new tail content arrives", () => {
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation([userMessage, firstCommentary])}
        onDownload={vi.fn()}
      />
    )
    const initialCommentary = screen
      .getByText(firstCommentary.content)
      .closest("p")
    expect(initialCommentary).not.toBeNull()

    rerender(
      <ConversationThread
        conversation={createConversation([
          userMessage,
          firstCommentary,
          {
            ...firstCommentary,
            id: "message-commentary-render-stability-2",
            item_id: "item-commentary-render-stability-2",
            content: "第二段新增内容",
            event_sequence_no: 2,
            created_at: "2026-08-02T08:00:02.000Z",
          },
        ])}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByText(firstCommentary.content).closest("p")).toBe(
      initialCommentary
    )
    expect(screen.getByText("第二段新增内容")).toBeVisible()
  })

  it("does not re-render an unchanged message while the live tail grows", () => {
    let selectedCapabilityReads = 0
    const stableUserMessage: ConversationMessage = { ...userMessage }
    Object.defineProperty(stableUserMessage, "selected_capabilities", {
      configurable: true,
      get: () => {
        selectedCapabilityReads += 1
        return []
      },
    })
    const onDownload = vi.fn()
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation([stableUserMessage, firstCommentary])}
        onDownload={onDownload}
      />
    )
    expect(selectedCapabilityReads).toBeGreaterThan(0)
    selectedCapabilityReads = 0

    rerender(
      <ConversationThread
        conversation={createConversation([
          stableUserMessage,
          firstCommentary,
          {
            ...firstCommentary,
            id: "message-commentary-render-stability-tail",
            item_id: "item-commentary-render-stability-tail",
            content: "仅更新流式尾部",
            event_sequence_no: 2,
          },
        ])}
        onDownload={onDownload}
      />
    )

    expect(selectedCapabilityReads).toBe(0)
    expect(screen.getByText("仅更新流式尾部")).toBeVisible()
  })

  it("keeps the running turn summary mounted when the first commentary arrives", () => {
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation([userMessage])}
        onDownload={vi.fn()}
      />
    )
    const initialSummary = screen.getByTestId(`turn-summary-${runningTurn.id}`)
    const initialActivityShell = initialSummary.querySelector(
      '[data-slot="collapsible"]'
    )
    const initialActivityTrigger = initialSummary.querySelector(
      '[data-slot="collapsible-trigger"]'
    )
    const initialSummaryHeading = initialSummary.querySelector(
      ".turn-summary-heading"
    )
    expect(initialActivityShell).not.toBeNull()
    expect(initialActivityTrigger).not.toBeNull()
    expect(initialSummaryHeading).not.toBeNull()

    rerender(
      <ConversationThread
        conversation={createConversation([userMessage, firstCommentary])}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByTestId(`turn-summary-${runningTurn.id}`)).toBe(
      initialSummary
    )
    expect(initialSummary.querySelector('[data-slot="collapsible"]')).toBe(
      initialActivityShell
    )
    expect(
      initialSummary.querySelector('[data-slot="collapsible-trigger"]')
    ).toBe(initialActivityTrigger)
    expect(initialSummary.querySelector(".turn-summary-heading")).toBe(
      initialSummaryHeading
    )

    rerender(
      <ConversationThread
        conversation={createConversation([
          userMessage,
          firstCommentary,
          {
            id: "message-final-render-stability",
            role: "assistant",
            turn_id: runningTurn.id,
            item_id: "item-final-render-stability",
            phase: "final_answer",
            content: "最终答案开始输出",
            event_sequence_no: 2,
            created_at: "2026-08-02T08:00:02.000Z",
            streaming: true,
          },
        ])}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByTestId(`turn-summary-${runningTurn.id}`)).toBe(
      initialSummary
    )
    expect(
      initialSummary.querySelector('[data-slot="collapsible-trigger"]')
    ).toBe(initialActivityTrigger)
    expect(initialSummary.querySelector(".turn-summary-heading")).toBe(
      initialSummaryHeading
    )
  })

  it("keeps the first user message and turn summary mounted through turn admission", () => {
    const pendingTurn = {
      ...runningTurn,
      id: "pending-turn-render-stability",
    }
    const optimisticMessage: ConversationMessage = {
      ...userMessage,
      id: "optimistic-message-render-stability",
      turn_id: null,
    }
    const onDownload = vi.fn()
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...createConversation([optimisticMessage]),
          turns: [pendingTurn],
          running_turn: pendingTurn,
        }}
        onDownload={onDownload}
      />
    )
    const initialArticle = screen.getByRole("article", { name: "用户消息" })
    const initialSummary = screen.getByTestId(`turn-summary-${pendingTurn.id}`)

    const admittedMessage = {
      ...optimisticMessage,
      turn_id: runningTurn.id,
    }
    rerender(
      <ConversationThread
        conversation={createConversation([admittedMessage])}
        onDownload={onDownload}
      />
    )

    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialArticle
    )
    expect(screen.getByTestId(`turn-summary-${runningTurn.id}`)).toBe(
      initialSummary
    )

    const persistedMessage: ConversationMessage = {
      ...admittedMessage,
      id: "persisted-user-message-render-stability",
      client_render_key: `message-${optimisticMessage.id}`,
    }
    rerender(
      <ConversationThread
        conversation={createConversation([persistedMessage])}
        onDownload={onDownload}
      />
    )

    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialArticle
    )
    expect(screen.getByTestId(`turn-summary-${runningTurn.id}`)).toBe(
      initialSummary
    )
  })

  it("keeps a regenerated message turn summary mounted through readmission", () => {
    const sourceTurn = {
      ...runningTurn,
      id: "source-turn-render-stability",
      status: "completed" as const,
      completed_at: "2026-08-02T08:00:03.000Z",
    }
    const pendingTurn = {
      ...runningTurn,
      id: "pending-regenerated-turn-render-stability",
    }
    const sourceMessage: ConversationMessage = {
      ...userMessage,
      id: "persisted-regenerated-source-message",
      turn_id: sourceTurn.id,
    }
    const baseConversation = createConversation([sourceMessage])
    const onDownload = vi.fn()
    const { rerender } = render(
      <ConversationThread
        conversation={{
          ...baseConversation,
          turns: [sourceTurn],
          running_turn: null,
        }}
        onDownload={onDownload}
      />
    )
    const initialArticle = screen.getByRole("article", { name: "用户消息" })
    const initialSummary = screen.getByTestId(`turn-summary-${sourceTurn.id}`)

    rerender(
      <ConversationThread
        conversation={{
          ...baseConversation,
          messages: [{ ...sourceMessage, turn_id: null }],
          turns: [pendingTurn],
          running_turn: pendingTurn,
        }}
        onDownload={onDownload}
      />
    )

    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialArticle
    )
    expect(screen.getByTestId(`turn-summary-${pendingTurn.id}`)).toBe(
      initialSummary
    )

    rerender(
      <ConversationThread
        conversation={{
          ...baseConversation,
          messages: [{ ...sourceMessage, turn_id: runningTurn.id }],
        }}
        onDownload={onDownload}
      />
    )

    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialArticle
    )
    expect(screen.getByTestId(`turn-summary-${runningTurn.id}`)).toBe(
      initialSummary
    )
  })

  it("keeps a native tool row mounted when command details arrive", () => {
    const itemId = "native-command-render-stability"
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation(
          [userMessage],
          [
            nativeCommandLifecycleEvent({
              id: "event-command-summary-only",
              itemId,
              sequence: 1,
              method: "item/started",
              status: "inProgress",
            }),
          ]
        )}
        onDownload={vi.fn()}
      />
    )
    const summary = screen.getByTestId(`turn-summary-${runningTurn.id}`)
    const initialActivity = summary.querySelector(".native-activity-item")
    expect(initialActivity).not.toBeNull()
    expect(within(summary).getByText("正在运行一个命令")).toBeVisible()
    expect(
      within(summary).queryByRole("button", {
        name: "展开“正在运行一个命令”的详情",
      })
    ).toBeNull()

    rerender(
      <ConversationThread
        conversation={createConversation(
          [userMessage],
          [
            nativeCommandLifecycleEvent({
              id: "event-command-with-details",
              itemId,
              sequence: 1,
              method: "item/started",
              status: "inProgress",
              command: "pnpm test",
            }),
          ]
        )}
        onDownload={vi.fn()}
      />
    )

    expect(summary.querySelector(".native-activity-item")).toBe(initialActivity)
    expect(
      within(summary).getByRole("button", {
        name: "展开“正在运行一个命令”的详情",
      })
    ).toBeVisible()
  })

  it("keeps a legacy tool row mounted when its lifecycle event id changes", () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation(
          [userMessage],
          [],
          [
            legacyToolActivity({
              id: "legacy-tool-running-event",
              type: "tool_started",
              status: "running",
            }),
          ]
        )}
        onDownload={vi.fn()}
      />
    )
    const initialActivity = screen
      .getByText("正在调用工具")
      .closest(".legacy-activity-item")
    expect(initialActivity).not.toBeNull()

    rerender(
      <ConversationThread
        conversation={createConversation(
          [userMessage],
          [],
          [
            legacyToolActivity({
              id: "legacy-tool-completed-event",
              type: "tool_completed",
              status: "completed",
            }),
          ]
        )}
        onDownload={vi.fn()}
      />
    )

    expect(
      screen.getByText("正在调用工具").closest(".legacy-activity-item")
    ).toBe(initialActivity)
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByText("正在思考").closest(".legacy-activity-item")).toBe(
      initialActivity
    )
  })

  it("keeps one empty activity shell from initial thinking through final completion", () => {
    const finalMessage: ConversationMessage = {
      id: "message-final-shell-stability",
      role: "assistant",
      turn_id: runningTurn.id,
      item_id: "item-final-shell-stability",
      phase: "final_answer",
      content: "最终答案开始输出",
      event_sequence_no: 2,
      created_at: "2026-08-02T08:00:02.000Z",
      streaming: true,
    }
    const { rerender } = render(
      <ConversationThread
        conversation={createConversation([userMessage])}
        onDownload={vi.fn()}
      />
    )
    const summary = screen.getByTestId(`turn-summary-${runningTurn.id}`)
    const shell = summary.querySelector('[data-slot="collapsible"]')
    const trigger = summary.querySelector('[data-slot="collapsible-trigger"]')
    const heading = summary.querySelector(".turn-summary-heading")
    expect(shell).not.toBeNull()
    expect(trigger).not.toBeNull()
    expect(heading).not.toBeNull()
    expect(summary.querySelector(".activity-panel")).toBeNull()

    rerender(
      <ConversationThread
        conversation={createConversation([userMessage, finalMessage])}
        onDownload={vi.fn()}
      />
    )

    expect(summary.querySelector('[data-slot="collapsible"]')).toBe(shell)
    expect(summary.querySelector('[data-slot="collapsible-trigger"]')).toBe(
      trigger
    )
    expect(summary.querySelector(".turn-summary-heading")).toBe(heading)
    expect(summary.querySelector(".activity-panel")).toBeNull()

    const completedTurn = {
      ...runningTurn,
      status: "completed" as const,
      completed_at: "2026-08-02T08:00:03.000Z",
    }
    rerender(
      <ConversationThread
        conversation={{
          ...createConversation([
            userMessage,
            { ...finalMessage, streaming: false },
          ]),
          turns: [completedTurn],
          running_turn: null,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(summary.querySelector('[data-slot="collapsible"]')).toBe(shell)
    expect(summary.querySelector('[data-slot="collapsible-trigger"]')).toBe(
      trigger
    )
    expect(summary.querySelector(".turn-summary-heading")).toBe(heading)
    expect(summary.querySelector(".activity-panel")).toBeNull()
  })

  it("keeps the assistant message mounted during a legacy persisted handoff", () => {
    const temporaryItemId = "legacy-stream-item-render-stability"
    const streamedMessages = appendStreamingMessageDelta(
      {},
      {
        itemId: temporaryItemId,
        messageId: temporaryItemId,
        turnId: runningTurn.id,
        phase: "final_answer",
        delta: "同一条完整回答",
        createdAt: "2026-08-02T08:00:02.000Z",
        sequence: 2,
      }
    )
    const streamingMessage = streamedMessages[temporaryItemId]
    expect(streamingMessage).toBeDefined()
    if (!streamingMessage) return

    const { rerender } = render(
      <ConversationThread
        conversation={createConversation([userMessage, streamingMessage])}
        onDownload={vi.fn()}
      />
    )
    const streamingArticle = screen.getByRole("article", { name: "助手回复" })

    const completedTurn = {
      ...runningTurn,
      status: "completed" as const,
      completed_at: "2026-08-02T08:00:03.000Z",
    }
    const persistedMessage: ConversationMessage = {
      ...streamingMessage,
      id: "persisted-message-render-stability",
      item_id: undefined,
      phase: undefined,
      client_render_key: `assistant-item-${temporaryItemId}`,
      streaming: false,
    }
    rerender(
      <ConversationThread
        conversation={{
          ...createConversation([userMessage, persistedMessage]),
          turns: [completedTurn],
          running_turn: null,
        }}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByRole("article", { name: "助手回复" })).toBe(
      streamingArticle
    )
  })

  it("uses a late final phase to place a native delta in the final reply slot", () => {
    const itemId = "native-late-phase-render-stability"
    const streamed = appendStreamingMessageDelta(
      {},
      {
        itemId,
        messageId: itemId,
        turnId: runningTurn.id,
        delta: "最终回复已开始",
        createdAt: "2026-08-02T08:00:03.000Z",
        sequence: 3,
      }
    )
    const repaired = applyStreamingMessageLifecycle(streamed, {
      itemId,
      messageId: "message-native-late-phase",
      turnId: runningTurn.id,
      phase: "final_answer",
      text: "",
      createdAt: "2026-08-02T08:00:02.000Z",
      sequence: 2,
      completed: false,
    })
    const message = repaired[itemId]
    expect(message).toBeDefined()
    if (!message) return

    render(
      <ConversationThread
        conversation={createConversation([userMessage, message])}
        onDownload={vi.fn()}
      />
    )

    const article = screen.getByRole("article", { name: "助手回复" })
    expect(within(article).getByText("最终回复已开始")).toBeVisible()
    const summary = screen.getByTestId(`turn-summary-${runningTurn.id}`)
    expect(summary.querySelector(".process-commentary")).toBeNull()
    expect(summary.querySelector(".activity-panel")).toBeNull()
  })

  it("keeps completed Markdown blocks mounted while the streaming tail grows", () => {
    const { container, rerender } = render(
      <AssistantMarkdown
        streaming
        content={"已经完成的第一段。\n\n正在生成第二段"}
      />
    )
    const initialFirstBlock = Array.from(
      container.querySelectorAll(".assistant-markdown > p")
    ).find((element) => element.textContent === "已经完成的第一段。")
    expect(initialFirstBlock).toBeDefined()

    rerender(
      <AssistantMarkdown
        streaming
        content={"已经完成的第一段。\n\n正在生成第二段，继续追加内容。"}
      />
    )

    const currentFirstBlock = Array.from(
      container.querySelectorAll(".assistant-markdown > p")
    ).find((element) => element.textContent === "已经完成的第一段。")
    expect(currentFirstBlock).toBe(initialFirstBlock)

    rerender(
      <AssistantMarkdown
        content={"已经完成的第一段。\n\n正在生成第二段，继续追加内容。"}
      />
    )

    expect(
      Array.from(container.querySelectorAll(".assistant-markdown > p")).find(
        (element) => element.textContent === "已经完成的第一段。"
      )
    ).toBe(initialFirstBlock)
  })

  it("renders incomplete emphasis without exposing raw syntax or replacing the tail", () => {
    const prefix = "已经稳定的第一段。"
    const { container, rerender } = render(
      <AssistantMarkdown streaming content={`${prefix}\n\n**正在生成的重点`} />
    )
    const markdownRoot = container.querySelector(".assistant-markdown")
    const stablePrefix = screen.getByText(prefix).closest("p")
    const streamingStrong = screen.getByText("正在生成的重点").closest("strong")
    expect(markdownRoot).not.toBeNull()
    expect(stablePrefix).not.toBeNull()
    expect(streamingStrong).not.toBeNull()
    expect(container).not.toHaveTextContent("**正在生成的重点")

    rerender(<AssistantMarkdown content={`${prefix}\n\n**正在生成的重点**`} />)

    expect(container.querySelector(".assistant-markdown")).toBe(markdownRoot)
    expect(screen.getByText(prefix).closest("p")).toBe(stablePrefix)
    expect(screen.getByText("正在生成的重点").closest("strong")).toBe(
      streamingStrong
    )
  })

  it("keeps previous commentary visible while an unconfirmed agent message streams", () => {
    const itemId = "item-tentative-final-render-stability"
    const started = applyStreamingMessageLifecycle(
      {},
      {
        itemId,
        turnId: runningTurn.id,
        phase: "final_answer",
        text: "",
        createdAt: "2026-08-02T08:00:02.000Z",
        sequence: 2,
        completed: false,
      }
    )
    const streaming = appendStreamingMessageDelta(started, {
      itemId,
      turnId: runningTurn.id,
      delta: "项目已复制。现在查询可用版式。",
      createdAt: "2026-08-02T08:00:03.000Z",
      sequence: 3,
    })
    const streamingMessage = streaming[itemId]
    expect(streamingMessage).toBeDefined()
    if (!streamingMessage) return

    const { rerender } = render(
      <ConversationThread
        conversation={createConversation(
          [userMessage, firstCommentary, streamingMessage],
          [tentativeFinalStartedEvent(itemId)]
        )}
        onDownload={vi.fn()}
      />
    )
    const previousCommentary = screen.getByText(firstCommentary.content)
    const activeCommentary = screen.getByText(streamingMessage.content)

    expect(previousCommentary).toBeVisible()
    expect(activeCommentary).toBeVisible()
    expect(screen.getByRole("article", { name: "助手回复" })).toContainElement(
      activeCommentary
    )

    const completed = applyStreamingMessageLifecycle(streaming, {
      itemId,
      messageId: "message-tentative-final-render-stability",
      turnId: runningTurn.id,
      phase: "commentary",
      text: streamingMessage.content,
      createdAt: "2026-08-02T08:00:04.000Z",
      sequence: 4,
      completed: true,
    })
    const completedMessage = completed[itemId]
    expect(completedMessage).toBeDefined()
    if (!completedMessage) return

    rerender(
      <ConversationThread
        conversation={createConversation(
          [userMessage, firstCommentary, completedMessage],
          [
            tentativeFinalStartedEvent(itemId),
            completedCommentaryEvent(itemId, completedMessage.content),
          ]
        )}
        onDownload={vi.fn()}
      />
    )

    expect(screen.getByText(firstCommentary.content)).toBe(previousCommentary)
    expect(screen.getByText(completedMessage.content)).toBeVisible()
    expect(screen.queryByRole("article", { name: "助手回复" })).toBeNull()
  })

  it("keeps the Markdown root and completed prefix mounted when code and images arrive", () => {
    const prefix = "已经稳定的说明。"
    const { container, rerender } = render(
      <AssistantMarkdown streaming content={prefix} />
    )
    const markdownRoot = container.querySelector(".assistant-markdown")
    const initialPrefix = screen.getByText(prefix).closest("p")
    expect(markdownRoot).not.toBeNull()
    expect(initialPrefix).not.toBeNull()

    const withCode = `${prefix}\n\n\`\`\`text\n新增代码\n\`\`\``
    rerender(<AssistantMarkdown streaming content={withCode} />)

    expect(container.querySelector(".assistant-markdown")).toBe(markdownRoot)
    expect(screen.getByText(prefix).closest("p")).toBe(initialPrefix)
    expect(screen.getByText("新增代码", { selector: "code" })).toBeVisible()

    const withImage = `${withCode}\n\n![新增图片](https://images.example.test/new.png)`
    rerender(<AssistantMarkdown content={withImage} />)

    expect(container.querySelector(".assistant-markdown")).toBe(markdownRoot)
    expect(screen.getByText(prefix).closest("p")).toBe(initialPrefix)
    expect(screen.getByRole("img", { name: "新增图片" })).toBeVisible()
  })

  it("keeps completed blocks mounted when structured citations arrive", () => {
    const content = "第一段。\n\n第二段。"
    const { rerender } = render(
      <MemoryRouter>
        <AssistantMarkdown streaming content={content} />
      </MemoryRouter>
    )
    const initialFirstBlock = screen.getByText("第一段。").closest("p")
    expect(initialFirstBlock).not.toBeNull()

    rerender(
      <MemoryRouter>
        <AssistantMarkdown
          content={content}
          citations={[
            {
              citation_id: "10000000-0000-4000-8000-000000000099",
              citation_no: 1,
              summary: {
                knowledge_base_name: "测试知识库",
                document_name: "测试文档.pdf",
                title_path: ["测试章节"],
                page_numbers: [1],
              },
              anchors: [
                {
                  occurrence_no: 1,
                  after_offset_utf16: "第一段。".length,
                },
                {
                  occurrence_no: 2,
                  after_offset_utf16: content.length,
                },
              ],
            },
          ]}
        />
      </MemoryRouter>
    )

    expect(screen.getByText("第一段。").closest("p")).toBe(initialFirstBlock)
    expect(
      screen.getAllByRole("link", { name: "打开知识库引用 1" })
    ).toHaveLength(2)
  })

  it("keeps structured citation offsets valid in an incomplete emphasis tail", () => {
    const prefix = "第一段。"
    const content = `${prefix}\n\n**第二段`

    render(
      <MemoryRouter>
        <AssistantMarkdown
          streaming
          content={content}
          citations={[
            {
              citation_id: "10000000-0000-4000-8000-000000000100",
              citation_no: 2,
              summary: {
                knowledge_base_name: "测试知识库",
                document_name: "测试文档.pdf",
                title_path: ["流式章节"],
                page_numbers: [2],
              },
              anchors: [
                { occurrence_no: 1, after_offset_utf16: prefix.length },
                { occurrence_no: 2, after_offset_utf16: content.length },
              ],
            },
          ]}
        />
      </MemoryRouter>
    )

    expect(screen.getByText("第二段").closest("strong")).not.toBeNull()
    expect(
      screen.getAllByRole("link", { name: "打开知识库引用 2" })
    ).toHaveLength(2)
  })

  it("re-renders Markdown when a referenced artifact becomes available", () => {
    const artifactId = "50000000-0000-4000-8000-000000000099"
    const content = `![结果](linksense-artifact:${artifactId})`
    const { container, rerender } = render(
      <AssistantMarkdown content={content} artifactFilesById={new Map()} />
    )
    const markdownRoot = container.querySelector(".assistant-markdown")
    expect(markdownRoot).not.toBeNull()
    expect(
      container.querySelector(".assistant-inline-image-error")
    ).not.toBeNull()
    const artifact: ConversationFile = {
      id: artifactId,
      name: "result.png",
      mime_type: "image/png",
      size: 1_024,
      kind: "artifact",
      status: "available",
      download_available: true,
    }
    const loadPreview = vi.fn(() => new Promise<never>(() => undefined))

    rerender(
      <AssistantMarkdown
        content={content}
        artifactFilesById={new Map([[artifactId, artifact]])}
        loadArtifactPreview={loadPreview}
      />
    )

    expect(container.querySelector(".assistant-markdown")).toBe(markdownRoot)
    expect(
      container.querySelector(".assistant-inline-image-thumbnail-placeholder")
    ).not.toBeNull()
    expect(loadPreview).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])(
    "renders reasoning currency as text alongside explicit formulas when streaming=%s",
    (streaming) => {
      const { container } = render(
        <ReasoningSummaryMarkdown
          content={
            "费用 $48，限额 $60。公式 \\(v = s / t\\)，另一个公式 $$x = y$$。"
          }
          streaming={streaming}
        />
      )

      expect(container).toHaveTextContent("费用 $48，限额 $60。")
      expect(
        [...container.querySelectorAll(".katex annotation")].map(
          (element) => element.textContent
        )
      ).toEqual(["v = s / t", "x = y"])
      expect(container.querySelector(".katex-display")).toBeNull()
    }
  )

  it("keeps a completed reasoning summary stable across parent renders", () => {
    const content = "已确认页面结构\n\n正在继续处理"
    const { rerender } = render(
      <ReasoningSummaryMarkdown content={content} streaming />
    )
    const initialBlock = screen.getByText("已确认页面结构").closest("p")
    expect(initialBlock).not.toBeNull()

    rerender(<ReasoningSummaryMarkdown content={content} />)

    expect(screen.getByText("已确认页面结构").closest("p")).toBe(initialBlock)

    rerender(<ReasoningSummaryMarkdown content={`${content}，继续追加内容`} />)

    expect(screen.getByText("已确认页面结构").closest("p")).toBe(initialBlock)
  })
})
