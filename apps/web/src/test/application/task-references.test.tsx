import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
  conversation,
  conversations,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

const currentId = "20000000-0000-4000-8000-000000000001"
const sourceId = "20000000-0000-4000-8000-000000000002"
describe("explicit cross-task references in the chat page", () => {
  setupApplicationTests()
  it.each([
    { fails: false, entry: "picker" },
    { fails: true, entry: "picker" },
    { fails: false, entry: "mention" },
    { fails: true, entry: "mention" },
  ])(
    "sends references through $entry and preserves focus and recovery (failure: $fails)",
    async ({ fails, entry }) => {
      installApiMock({
        conversationListResponse: () =>
          json({
            success: true,
            data: {
              items: [
                { ...conversations[0], id: currentId, title: "当前任务" },
                { ...conversations[1], id: sourceId, title: "产品调研" },
              ],
              next_cursor: null,
            },
          }),
        conversationDetailResponse: async () =>
          json({
            success: true,
            data: {
              ...conversation,
              id: currentId,
              execution_status: "completed",
              running_turn: null,
              turns: [],
              messages: [],
            },
          }),
      })
      const originalFetch = window.fetch
      const starts: Record<string, unknown>[] = []
      let finishSubmission: () => void = () => undefined
      const submissionGate = new Promise<void>((resolve) => {
        finishSubmission = resolve
      })
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          if (
            url.pathname === `/api/v1/conversations/${currentId}/turns` &&
            init?.method === "POST"
          ) {
            starts.push(JSON.parse(String(init.body)))
            await submissionGate
            if (fails)
              return json(
                {
                  success: false,
                  error_code: "RUNNER_UNAVAILABLE",
                  message: "Runner unavailable",
                },
                503
              )
            return json(
              {
                success: true,
                data: {
                  accepted: true,
                  status: "starting",
                  turn_id: "30000000-0000-4000-8000-000000000001",
                },
              },
              202
            )
          }
          return originalFetch(input, init)
        })
      )
      const interaction = userEvent.setup()
      renderApp(`/conversations/${currentId}`)
      const composer = await screen.findByRole("textbox", {
        name: "任务输入框",
      })
      if (entry === "mention") {
        await interaction.type(composer, "@产")
        let candidate = await screen.findByRole("option", { name: "产品调研" })
        await waitFor(() =>
          expect(candidate).toHaveAttribute("data-selected", "true")
        )
        expect(composer).toHaveFocus()
        if (!fails) {
          await interaction.keyboard("{Escape}")
          expect(
            screen.queryByRole("option", { name: "产品调研" })
          ).not.toBeInTheDocument()
          expect(composer).toHaveValue("@产")
          expect(composer).toHaveFocus()
          await interaction.keyboard("品")
          candidate = await screen.findByRole("option", { name: "产品调研" })
          await waitFor(() =>
            expect(candidate).toHaveAttribute("data-selected", "true")
          )
        }
        if (fails) await interaction.click(candidate)
        else await interaction.keyboard("{ArrowDown}{ArrowUp}{Enter}")
        expect(starts).toHaveLength(0)
        await waitFor(() => expect(composer).toHaveValue(""))
      } else {
        await interaction.click(
          await screen.findByRole("button", { name: "附件" })
        )
        await interaction.click(await screen.findByText("引用其他任务"))
        await interaction.click(
          await screen.findByRole("checkbox", { name: "产品调研" })
        )
        await interaction.keyboard("{Escape}")
      }
      await waitFor(() => expect(composer).toHaveFocus())
      await interaction.type(composer, "结合调研结论做个比较")
      const form = composer.closest("form")!
      await interaction.click(
        within(form).getByRole("button", { name: "发送" })
      )
      await waitFor(() => expect(starts).toHaveLength(1))
      expect(starts[0]?.message_display).toEqual({
        kind: "task_references",
        request: "结合调研结论做个比较",
        conversation_ids: [sourceId],
      })
      try {
        if (!fails) {
          const message = await screen.findByRole("article", {
            name: "用户消息",
          })
          expect(
            within(message).getByRole("link", { name: "产品调研" })
          ).toHaveAttribute("href", `/conversations/${sourceId}`)
        }
      } finally {
        finishSubmission()
      }
      await waitFor(() => expect(composer).toHaveFocus())
      if (fails) {
        await waitFor(() =>
          expect(composer).toHaveValue("结合调研结论做个比较")
        )
        expect(
          screen.getByRole("button", { name: "移除引用：产品调研" })
        ).toBeInTheDocument()
      }
    }
  )
})
