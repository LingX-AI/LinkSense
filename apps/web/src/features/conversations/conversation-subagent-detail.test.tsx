import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import { ConversationSubAgentDetail } from "@/features/conversations/conversation-subagent-detail"
import {
  reconcileSubAgentDetailStatus,
  subAgentDetailRefetchInterval,
} from "@/features/conversations/subagent-query-refresh"
import i18n from "@/i18n"

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
}))

const conversationId = "20000000-0000-4000-8000-000000000001"
const turnId = "30000000-0000-4000-8000-000000000001"
const agentId = `agent_${"a".repeat(24)}`

describe("ConversationSubAgentDetail", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  function renderDetail(
    onClose = vi.fn(),
    agentStatus: "running" | "completed" = "completed",
    runtimeStatus?: "running" | "completed"
  ) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const result = render(
      <QueryClientProvider client={queryClient}>
        <ConversationSubAgentDetail
          selection={{
            conversationId,
            turnId,
            agentId,
          }}
          agent={{
            id: agentId,
            ordinal: 2,
            label: "配置审计",
            status: agentStatus,
          }}
          runtimeStatus={runtimeStatus}
          onClose={onClose}
        />
      </QueryClientProvider>
    )
    return { ...result, onClose }
  }

  it("keeps recovering without detail data while the projected agent is active", () => {
    expect(subAgentDetailRefetchInterval(undefined, "running")).toBe(1_500)
    expect(subAgentDetailRefetchInterval(undefined, "started")).toBe(1_500)
    expect(subAgentDetailRefetchInterval(undefined, "completed")).toBe(false)
  })

  it("uses the detail runtime status once it is available", () => {
    expect(subAgentDetailRefetchInterval("running", "completed")).toBe(1_500)
    expect(subAgentDetailRefetchInterval("completed", "running")).toBe(1_500)
    expect(subAgentDetailRefetchInterval("completed", "completed")).toBe(false)
    expect(reconcileSubAgentDetailStatus("running", "completed")).toBe(
      "running"
    )
    expect(reconcileSubAgentDetailStatus("completed", "running")).toBe(
      "running"
    )
    expect(reconcileSubAgentDetailStatus("completed", "completed")).toBe(
      "completed"
    )
  })

  it("resumes a cached terminal detail when the current projection becomes active", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      agentKey: agentId,
      agentLabel: "配置审计",
      status: "completed",
      turns: [
        {
          status: "completed",
          durationMs: 1_000,
          items: [],
        },
      ],
    })

    renderDetail(vi.fn(), "running", "running")

    expect(await screen.findByText("正在工作中")).toBeVisible()
    expect(screen.queryByText("已完成")).toBeNull()
  })

  it("does not let a weak persisted activity override terminal thread detail", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      agentKey: agentId,
      agentLabel: "配置审计",
      status: "completed",
      turns: [
        {
          status: "completed",
          durationMs: 1_000,
          items: [],
        },
      ],
    })

    renderDetail(vi.fn(), "running")

    expect(await screen.findByText("已完成")).toBeVisible()
    expect(screen.queryByText("正在工作中")).toBeNull()
  })

  it("uses the shared file-preview loading state without a spinner or ellipsis", () => {
    vi.mocked(apiRequest).mockReturnValue(new Promise<never>(() => undefined))

    const { container } = renderDetail(vi.fn(), "running")
    const loadingState = screen.getByRole("status")

    expect(loadingState).toHaveClass("office-preview-state")
    expect(loadingState).toHaveAttribute("aria-busy", "true")
    expect(loadingState).toHaveAttribute("aria-live", "polite")
    expect(screen.getByText("正在加载子智能体活动")).toHaveClass("shimmer")
    expect(loadingState.querySelector("svg")).toBeNull()
    expect(loadingState.querySelector(".animate-spin")).toBeNull()
    expect(loadingState.textContent).not.toContain("…")
    expect(loadingState.textContent).not.toContain("...")
    expect(container.querySelector(".page-state")).toBeNull()
  })

  it("renders multiple native turns as one continuous agent conversation", async () => {
    const intervalSpy = vi.spyOn(window, "setInterval")
    vi.mocked(apiRequest).mockResolvedValueOnce({
      agentKey: agentId,
      agentLabel: "纽约城市概览",
      status: "completed",
      turns: [
        {
          status: "interrupted",
          durationMs: 700,
          items: [
            {
              type: "agentMessage",
              id: "detail-1",
              phase: "commentary",
              text: "开始检查配置。",
            },
            {
              type: "commandExecution",
              id: "detail-2",
              status: "inProgress",
              commandActions: [{ type: "read", command: "读取配置" }],
              command: "读取配置",
            },
          ],
        },
        {
          status: "completed",
          durationMs: 2_300,
          items: [
            {
              type: "commandExecution",
              id: "detail-1",
              status: "completed",
              commandActions: [{ type: "read", command: "读取协议" }],
              command: "读取协议",
            },
            {
              type: "commandExecution",
              id: "detail-2",
              status: "completed",
              commandActions: [{ type: "search", command: "搜索事件" }],
              command: "搜索事件",
            },
            {
              type: "agentMessage",
              id: "detail-3",
              phase: "final_answer",
              text: "协议审计完成。",
            },
          ],
        },
      ],
    })

    const { container, onClose } = renderDetail()

    expect(await screen.findByText("协议审计完成。")).toBeVisible()
    expect(screen.getByText("开始检查配置。")).toBeVisible()
    expect(screen.getByText("子智能体曾中断，随后继续。")).toBeVisible()
    expect(screen.getAllByText("已读取文件")).toHaveLength(2)
    expect(screen.getByText("纽约城市概览")).toBeVisible()
    expect(screen.queryByText("配置审计")).toBeNull()
    expect(screen.getAllByText("已完成")).toHaveLength(1)
    expect(screen.getByText("用时")).toBeVisible()
    expect(screen.getByText("3s")).toBeVisible()
    expect(
      intervalSpy.mock.calls.some(([, intervalMs]) => intervalMs === 1_000)
    ).toBe(false)
    expect(screen.queryByText("执行 1")).not.toBeInTheDocument()
    expect(screen.queryByText("执行 2")).not.toBeInTheDocument()
    expect(screen.getByRole("log")).toHaveClass("conversation-scroll-embedded")
    expect(container.querySelector(".subagent-detail-pane")).toBeTruthy()
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${conversationId}/turns/${turnId}/subagents/${agentId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    const closeButton = screen.getByRole("button", {
      name: "关闭子智能体详情",
    })

    expect(closeButton).toHaveClass(
      "office-preview-control-button",
      "office-preview-close-button",
      "size-6"
    )
    expect(closeButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )

    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledOnce()
    intervalSpy.mockRestore()
  })

  it("shows the shared thinking marker before the agent produces activity", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({
      agentKey: agentId,
      status: "running",
      turns: [
        {
          status: "inProgress",
          durationMs: 0,
          items: [],
        },
      ],
    })

    const { container } = renderDetail()

    expect(await screen.findByText("正在思考")).toBeVisible()
    expect(screen.queryByText("已处理")).not.toBeInTheDocument()
    expect(
      container.querySelector(".turn-summary-marker-content.shimmer")
    ).toBeTruthy()
  })

  it("localizes an interrupted continuation without exposing run numbers", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockResolvedValueOnce({
      agentKey: agentId,
      status: "completed",
      turns: [
        {
          status: "interrupted",
          durationMs: 1_000,
          items: [
            {
              type: "agentMessage",
              id: "detail-1",
              phase: "commentary",
              text: "Checking.",
            },
          ],
        },
        {
          status: "completed",
          durationMs: 1_000,
          items: [
            {
              type: "agentMessage",
              id: "detail-1",
              phase: "final_answer",
              text: "Done.",
            },
          ],
        },
      ],
    })

    renderDetail()

    expect(
      await screen.findByText(
        "The subagent was interrupted and then continued."
      )
    ).toBeVisible()
    expect(screen.queryByText("Run 1")).not.toBeInTheDocument()
    expect(screen.queryByText("Run 2")).not.toBeInTheDocument()
  })
})
