import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  conversation,
  installApiMock,
  json,
  renderApp,
  seedLocalDraft,
  setupApplicationTests,
} from "./fixture"

const parentId = "20000000-0000-4000-8000-000000000001"
const childId = "20000000-0000-4000-8000-000000000002"
const sourceId = "30000000-0000-4000-8000-000000000001"
const referenceId = "40000000-0000-4000-8000-000000000001"

describe("unavailable side conversations", () => {
  setupApplicationTests()

  it.each([
    { status: 403, code: "FORBIDDEN" },
    { status: 404, code: "CONVERSATION_NOT_FOUND" },
  ])(
    "keeps the main task and draft when the embedded conversation returns $status",
    async ({ status, code }) => {
      seedLocalDraft(parentId, { input: "主任务草稿应保留" })
      let childAvailable = false
      installApiMock({
        conversationDetailResponse: async (id) => {
          if (id === childId && !childAvailable)
            return json({ success: false, error_code: code }, status)
          return json({
            success: true,
            data: {
              ...conversation,
              id,
              title: id === parentId ? "主任务" : "旁聊",
              ...(id === childId
                ? {
                    execution_status: "completed",
                    running_turn: null,
                    turns: [],
                  }
                : {}),
              messages: [
                {
                  id: sourceId,
                  role: "assistant",
                  content:
                    id === parentId ? "主任务继续运行。" : "旁聊已恢复。",
                },
              ],
            },
          })
        },
      })
      const originalFetch = window.fetch
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname
          if (path === `/api/v1/conversations/${parentId}/side-chat`) {
            return json({
              success: true,
              data: {
                conversation_id: childId,
                parent_conversation_id: parentId,
                reference: {
                  id: referenceId,
                  source_conversation_id: parentId,
                  source_message_id: sourceId,
                  source_title: "主任务",
                  selection_text: "引用片段",
                  include_recent_messages: true,
                  recent_messages: [],
                },
              },
            })
          }
          return originalFetch(input, init)
        })
      )
      const interaction = userEvent.setup()
      renderApp(`/conversations/${parentId}`)
      const mainComposer = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      await waitFor(() => expect(mainComposer).toHaveValue("主任务草稿应保留"))
      await interaction.click(
        await screen.findByRole("button", { name: "打开旁聊" })
      )
      const panel = await screen.findByRole("complementary", { name: "旁聊" })
      const retry = await within(panel).findByRole("button", { name: "重试" })
      expect(
        screen.getByRole("heading", { name: "主任务", level: 1 })
      ).toBeVisible()
      expect(mainComposer).toHaveValue("主任务草稿应保留")
      childAvailable = true
      await interaction.click(retry)
      expect(await within(panel).findByText("旁聊已恢复。")).toBeVisible()
      expect(mainComposer).toHaveValue("主任务草稿应保留")
    }
  )
})
