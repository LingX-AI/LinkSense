import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { sideChatSelectionSchema } from "@linksense/shared"
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
const answerId = "30000000-0000-4000-8000-000000000002"
const referenceId = "40000000-0000-4000-8000-000000000001"

describe("parallel side chat", () => {
  setupApplicationTests()

  it("keeps the running main task visible, preserves both drafts and returns a selection without sending it", async () => {
    seedLocalDraft(parentId, { input: "主任务原有草稿" })
    const { requests } = installApiMock({
      conversationDetailResponse: async (id) =>
        json({
          success: true,
          data:
            id === parentId
              ? {
                  ...conversation,
                  id,
                  title: "主任务",
                  messages: [
                    {
                      id: sourceId,
                      role: "assistant",
                      content: "主任务里的引用段落。",
                    },
                  ],
                }
              : {
                  ...conversation,
                  id,
                  title: "旁聊",
                  execution_status: "completed",
                  running_turn: null,
                  turns: [{ id: "turn-side", status: "completed" }],
                  messages: [
                    {
                      id: answerId,
                      role: "assistant",
                      content: "旁聊结论，可带回。",
                    },
                  ],
                },
        }),
    })
    const originalFetch = window.fetch
    const starts: unknown[] = []
    let selected: unknown
    let sideChat: unknown = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === `/api/v1/conversations/${parentId}/side-chat`) {
          if (init?.method === "POST") {
            selected = JSON.parse(String(init.body))
            const selection = sideChatSelectionSchema.parse(selected)
            sideChat = {
              conversation_id: childId,
              parent_conversation_id: parentId,
              reference: {
                ...selection,
                id: referenceId,
                source_conversation_id: parentId,
                source_title: "主任务",
                recent_messages: [],
              },
            }
          }
          return json({ success: true, data: sideChat })
        }
        if (
          url.pathname === `/api/v1/conversations/${childId}/turns` &&
          init?.method === "POST"
        ) {
          starts.push(JSON.parse(String(init.body)))
          return json(
            {
              success: true,
              data: {
                accepted: true,
                status: "starting",
                turn_id: referenceId,
              },
            },
            202
          )
        }
        return originalFetch(input, init)
      })
    )
    const interaction = userEvent.setup()
    renderApp(`/conversations/${parentId}`)
    const mainComposer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await waitFor(() => expect(mainComposer).toHaveValue("主任务原有草稿"))
    const quote = await screen.findByText("主任务里的引用段落。")
    act(() => {
      const range = document.createRange()
      range.selectNodeContents(quote)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await interaction.click(
      await screen.findByRole("button", { name: "旁边问这段" })
    )
    const panel = await screen.findByRole("complementary", { name: "旁聊" })
    expect(await within(panel).findByText("旁聊结论，可带回。")).toBeVisible()
    expect(
      within(panel).queryByRole("heading", { level: 1 })
    ).not.toBeInTheDocument()
    expect(
      within(panel).queryByRole("button", { name: "分支到新聊天" })
    ).not.toBeInTheDocument()
    expect(selected).toEqual({
      source_message_id: sourceId,
      selection_text: "主任务里的引用段落。",
      include_recent_messages: true,
    })
    expect(mainComposer).toHaveValue("主任务原有草稿")
    const sideComposer = within(panel).getByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(sideComposer, "旁聊未发送的草稿")
    await interaction.click(
      within(panel).getByRole("button", { name: "带回主任务输入框" })
    )
    expect(mainComposer).toHaveValue(
      "主任务原有草稿\n\n来自旁聊的引用\n> 旁聊结论，可带回。\n\n"
    )
    expect(starts).toEqual([])
    expect(
      requests.filter(
        (item) =>
          item.method === "POST" &&
          /\/(turns|pending-requests)$/u.test(item.path)
      )
    ).toEqual([])
    await interaction.click(
      within(panel).getByRole("button", { name: "收起旁聊" })
    )
    await interaction.click(screen.getByRole("button", { name: "打开旁聊" }))
    const reopened = await screen.findByRole("complementary", { name: "旁聊" })
    const restoredComposer = await within(reopened).findByRole("textbox", {
      name: "任务输入框",
    })
    await waitFor(() =>
      expect(restoredComposer).toHaveValue("旁聊未发送的草稿")
    )
    await interaction.click(restoredComposer)
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toMatchObject({
      message_display: {
        kind: "conversation_reference",
        reference_id: referenceId,
        request: "旁聊未发送的草稿",
      },
    })
    expect(mainComposer).toHaveValue(
      "主任务原有草稿\n\n来自旁聊的引用\n> 旁聊结论，可带回。\n\n"
    )
  })
})
