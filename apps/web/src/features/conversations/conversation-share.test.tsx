import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import type { Conversation } from "@/api/contracts"
import { ConversationShareDialog } from "@/features/conversations/conversation-share"
import i18n from "@/i18n"

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>()
  return { ...original, apiRequest: vi.fn() }
})

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const SHARE_ID = "30000000-0000-4000-8000-000000000001"

describe("ConversationShareDialog", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({
      id: SHARE_ID,
      conversation_id: CONVERSATION_ID,
      title: "修复页面闪烁",
      url_path: `/share/${SHARE_ID}`,
      created_at: "2026-09-03T04:00:00.000Z",
      updated_at: "2026-09-03T04:00:00.000Z",
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("matches the confirmed share flow without a learn-more entry", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText")
    renderShareDialog()

    expect(
      screen.getByRole("heading", { name: "分享 修复页面闪烁" })
    ).toBeInTheDocument()
    expect(screen.queryByText("了解更多")).not.toBeInTheDocument()
    expect(screen.getByText("任何拥有此链接的人都可以查看此任务")).toBeVisible()
    const preview = screen.getByLabelText("共享任务预览")
    expect(preview).toBeVisible()
    expect(preview.querySelector("time")).toBeNull()
    expect(within(preview).queryByLabelText("消息操作")).not.toBeInTheDocument()
    expect(screen.getByText("已完成最终回答")).toBeVisible()
    expect(screen.queryByText("正在分析内部实现")).not.toBeInTheDocument()
    expect(screen.queryByText("内部工具调用")).not.toBeInTheDocument()
    expect(screen.queryByText("gpt-share-preview")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "复制链接" }).querySelector("svg")
    ).toHaveClass("size-3")

    await user.click(screen.getByRole("button", { name: "复制链接" }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/share/${SHARE_ID}`
      )
    })
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${CONVERSATION_ID}/share`,
      expect.objectContaining({ method: "POST" })
    )
    expect(screen.getByRole("button", { name: "已复制" })).toBeVisible()
    expect(screen.queryByText("正在创建链接")).not.toBeInTheDocument()
  })

  it("keeps the copy button content stable while creating the share", async () => {
    vi.mocked(apiRequest).mockImplementationOnce(
      () => new Promise(() => undefined)
    )
    const user = userEvent.setup()
    renderShareDialog()

    await user.click(screen.getByRole("button", { name: "复制链接" }))

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1))
    expect(screen.getByRole("button", { name: "复制链接" })).toBeDisabled()
    expect(screen.queryByText("正在创建链接")).not.toBeInTheDocument()
  })
})

function renderShareDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationShareDialog
        conversation={conversation()}
        open
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>
  )
}

function conversation(): Conversation {
  const turnId = "50000000-0000-4000-8000-000000000001"
  return {
    id: CONVERSATION_ID,
    title: "修复页面闪烁",
    updated_at: "2026-09-03T04:00:00.000Z",
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: "default",
    archived: false,
    messages: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        role: "user",
        content: "请修复页面闪烁",
        content_text: "请修复页面闪烁",
        turn_id: turnId,
        created_at: "2026-09-03T03:59:48.000Z",
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        role: "assistant",
        content: "正在分析内部实现",
        content_text: "正在分析内部实现",
        turn_id: turnId,
        phase: "commentary",
      },
      {
        id: "40000000-0000-4000-8000-000000000003",
        role: "assistant",
        content: "已完成最终回答",
        content_text: "已完成最终回答",
        turn_id: turnId,
        phase: "final_answer",
        created_at: "2026-09-03T04:00:00.000Z",
      },
    ],
    turns: [
      {
        id: turnId,
        status: "completed",
        model: "gpt-share-preview",
        started_at: "2026-09-03T03:59:48.000Z",
        completed_at: "2026-09-03T04:00:00.000Z",
      },
    ],
    activities: [
      {
        id: "activity-secret",
        turn_id: turnId,
        type: "tool_completed",
        label: "内部工具调用",
      },
    ],
    user_input_requests: [],
  }
}
