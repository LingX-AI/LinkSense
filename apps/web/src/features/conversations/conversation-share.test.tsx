import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
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

  it("disables sharing when there are no shareable messages", () => {
    renderShareDialog({ ...conversation(), messages: [] })
    expect(screen.getByRole("button", { name: "复制链接" })).toBeDisabled()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it("does not copy a stale link when its request finishes after the dialog closes", async () => {
    let resolveShare: (value: unknown) => void = () => {
      throw new Error("request not started")
    }
    vi.mocked(apiRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveShare = resolve
        })
    )
    const user = userEvent.setup()
    const copy = vi.spyOn(navigator.clipboard, "writeText")
    const { unmount } = renderShareDialog()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    unmount()
    await act(async () => resolveShare({ url_path: `/share/${SHARE_ID}` }))
    expect(copy).not.toHaveBeenCalled()
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "explains immutable sharing in %s with Chinese fallback",
    async (language) => {
      await i18n.changeLanguage(language)
      renderShareDialog()
      expect(
        screen.getByText(
          language === "en-US"
            ? "Only the content previewed below is shared, without your name. Later messages or new shares won't change this link's content."
            : "仅分享下方预览中的内容，不显示你的姓名。后续聊天或再次分享不会改变此链接的内容。"
        )
      ).toBeVisible()
    }
  )

  it("reuses the same link on repeated copies but starts a new snapshot after an external close", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    const view = (open: boolean, value = conversation()) => (
      <QueryClientProvider client={queryClient}>
        <ConversationShareDialog
          conversation={value}
          open={open}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(view(true))
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    await user.click(await screen.findByRole("button", { name: "已复制" }))
    expect(apiRequest).toHaveBeenCalledTimes(1)
    rerender(view(false))
    const updated = { ...conversation(), title: "新分享标题" }
    rerender(view(true, updated))
    expect(
      screen.getByRole("heading", { name: "分享 新分享标题" })
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(apiRequest).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: {
          snapshot: expect.objectContaining({
            conversation: expect.objectContaining({ title: "新分享标题" }),
          }),
        },
      })
    )
  })

  it("retries copying the existing snapshot after clipboard failure", async () => {
    const user = userEvent.setup()
    const copy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("denied"))
    renderShareDialog()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(
      await screen.findByText(i18n.t("conversation.share.copyFailed"))
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible()
    expect(apiRequest).toHaveBeenCalledTimes(1)
    expect(copy).toHaveBeenCalledTimes(2)
  })

  it("shows request errors and allows retrying the same frozen preview", async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("unavailable"))
    const user = userEvent.setup()
    renderShareDialog()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(screen.getByRole("button", { name: "复制链接" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible()
    expect(vi.mocked(apiRequest).mock.calls[0]).toEqual(
      vi.mocked(apiRequest).mock.calls[1]
    )
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

  it("freezes the preview and submitted messages when the source task changes", async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient()
    const source = conversation()
    const view = (value: Conversation) => (
      <QueryClientProvider client={queryClient}>
        <ConversationShareDialog
          conversation={value}
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>
    )
    const { rerender } = render(view(source))
    rerender(
      view({
        ...source,
        title: "之后修改的标题",
        messages: [
          ...(source.messages ?? []),
          {
            id: "40000000-0000-4000-8000-000000000004",
            role: "user",
            content: "之后新增的私密消息",
            content_text: "之后新增的私密消息",
          },
        ],
      })
    )

    expect(screen.queryByText("之后新增的私密消息")).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "分享 修复页面闪烁" })
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "复制链接" }))
    expect(apiRequest).toHaveBeenCalledWith(
      `/conversations/${CONVERSATION_ID}/share`,
      expect.objectContaining({
        body: {
          snapshot: expect.objectContaining({
            messages: [
              expect.objectContaining({ content_text: "请修复页面闪烁" }),
              expect.objectContaining({ content_text: "已完成最终回答" }),
            ],
          }),
        },
      })
    )
  })
})

function renderShareDialog(value = conversation()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationShareDialog
        conversation={value}
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
    category_id: null,
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
