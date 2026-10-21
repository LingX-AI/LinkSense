import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  conversation,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

describe("side-chat submissions across panel remounts", () => {
  setupApplicationTests()

  it("keeps a newer unsent draft when an earlier submission finishes after reopening", async () => {
    const parentId = "20000000-0000-4000-8000-000000000001"
    const childId = "20000000-0000-4000-8000-000000000002"
    const messageId = "30000000-0000-4000-8000-000000000001"
    const referenceId = "40000000-0000-4000-8000-000000000001"
    let detailReads = 0
    installApiMock({
      conversationDetailResponse: async (id) => {
        if (id === childId) detailReads += 1
        return json({
          success: true,
          data: {
            ...conversation,
            id,
            execution_status: "completed",
            running_turn: null,
            turns: [],
            messages:
              id === parentId
                ? [{ id: messageId, role: "user", content: "Source message" }]
                : [],
          },
        })
      },
    })
    const originalFetch = window.fetch
    let finishSubmission: (() => void) | undefined
    const pendingResponse = new Promise<void>((resolve) => {
      finishSubmission = resolve
    })
    let submissions = 0
    const sideChat = {
      conversation_id: childId,
      parent_conversation_id: parentId,
      reference: {
        id: referenceId,
        source_conversation_id: parentId,
        source_message_id: messageId,
        source_title: "Parent",
        selection_text: "Source message",
        include_recent_messages: true,
        recent_messages: [],
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        if (path === `/api/v1/conversations/${parentId}/side-chat`)
          return json({
            success: true,
            data: init?.method === "POST" ? sideChat : null,
          })
        if (
          path === `/api/v1/conversations/${childId}/turns` &&
          init?.method === "POST"
        ) {
          submissions += 1
          await pendingResponse
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
    await interaction.click(
      await screen.findByRole("button", { name: "旁边问这段" })
    )
    let panel = await screen.findByRole("complementary", { name: "旁聊" })
    let input = await within(panel).findByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(input, "First question{Enter}")
    await waitFor(() => expect(submissions).toBe(1))
    await interaction.click(
      within(panel).getByRole("button", { name: "收起旁聊" })
    )
    await interaction.click(screen.getByRole("button", { name: "打开旁聊" }))
    panel = await screen.findByRole("complementary", { name: "旁聊" })
    input = await within(panel).findByRole("textbox", { name: "任务输入框" })
    await interaction.clear(input)
    await interaction.type(input, "New draft written while waiting")
    const readsBefore = detailReads
    await act(async () => {
      finishSubmission?.()
    })
    await waitFor(() => expect(detailReads).toBeGreaterThan(readsBefore))
    await interaction.click(
      within(panel).getByRole("button", { name: "收起旁聊" })
    )
    await interaction.click(screen.getByRole("button", { name: "打开旁聊" }))
    panel = await screen.findByRole("complementary", { name: "旁聊" })
    input = await within(panel).findByRole("textbox", { name: "任务输入框" })
    await waitFor(() =>
      expect(input).toHaveValue("New draft written while waiting")
    )
  })
})
