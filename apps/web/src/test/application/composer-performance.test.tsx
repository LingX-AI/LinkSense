import type { ComponentProps } from "react"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  setupApplicationTests,
  installApiMock,
  renderApp,
  user,
} from "./fixture"
import { readLocalConversationDraft } from "@/features/conversations/conversation-local-draft"

const renderHistory = vi.hoisted(() => vi.fn())
vi.mock(
  "@/features/conversations/conversation-thread",
  async (importOriginal) => {
    const { ConversationThread } =
      await importOriginal<
        typeof import("@/features/conversations/conversation-thread")
      >()
    return {
      ConversationThread: (
        props: ComponentProps<typeof ConversationThread>
      ) => {
        renderHistory()
        return <ConversationThread {...props} />
      },
    }
  }
)

describe("composer typing performance", () => {
  setupApplicationTests()

  it("does not render a long task history for each input edit while preserving the current text", async () => {
    installApiMock({
      eventStreamBody: "",
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [{ id: "turn-1", status: "completed" }],
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            content: "开发调研报告应用",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            content:
              "应用已完成。\n\n" +
              Array.from(
                { length: 100 },
                (_, index) =>
                  `- 调研报告第 ${index + 1} 项：支持实时预览和结果展示。`
              ).join("\n"),
          },
        ],
      },
    })
    renderApp()
    const input = await screen.findByRole("textbox", { name: "任务输入框" })
    await screen.findByText("开发调研报告应用")
    await waitFor(() =>
      expect(screen.queryByText("正在加载…")).not.toBeInTheDocument()
    )
    fireEvent.focus(input)
    const beforeTyping = renderHistory.mock.calls.length
    const text = "界面不好看，优化一下"
    for (let length = 1; length <= text.length; length++) {
      fireEvent.change(input, { target: { value: text.slice(0, length) } })
      expect(input).toHaveValue(text.slice(0, length))
    }
    expect(renderHistory).toHaveBeenCalledTimes(beforeTyping)
    expect(
      readLocalConversationDraft(window.localStorage, user.id, "c1").input
    ).toBe(text)
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
  })
})
