import { act, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  conversation,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

describe("task source overview integration", () => {
  setupApplicationTests()
  it("shows historical sources absent from loaded messages and appends sources after a reply completes", async () => {
    let release: (() => void) | undefined
    const streamStart = new Promise<void>((resolve) => {
      release = resolve
    })
    let completed = false
    let sourceReads = 0
    installApiMock({
      eventStreamStart: streamStart,
      eventStreamBody: `id: 20000000-0000-4000-8000-000000000001:900\nevent: conversation.message.completed\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000900",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          event_type: "conversation.message.completed",
          turn_id: "30000000-0000-4000-8000-000000000001",
          visibility: "user_visible",
          sse_event_id: "20000000-0000-4000-8000-000000000001:900",
          sequence_no: 900,
          created_at: "2026-09-07T10:00:00.000Z",
          payload: {
            schema_version: 1,
            role: "assistant",
            message_id: "50000000-0000-4000-8000-000000000001",
          },
        }
      )}\n\n`,
      conversationGetResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            messages: [],
            last_event_id: "20000000-0000-4000-8000-000000000001:899",
          },
        }),
      conversationSourcesResponse: () => {
        sourceReads += 1
        return json({
          success: true,
          data: {
            items: [
              { url: "https://historical.test/guide", title: "历史参考资料" },
              ...(completed
                ? [{ url: "https://new.test/report", title: "最新报告" }]
                : []),
            ],
          },
        })
      },
    })
    renderApp()
    const overview = await screen.findByRole("region", { name: "任务概览" })
    expect(
      await within(overview).findByRole("link", { name: "历史参考资料" })
    ).toHaveAttribute("href", "https://historical.test/guide")
    expect(
      within(overview).queryByRole("link", { name: "最新报告" })
    ).not.toBeInTheDocument()
    completed = true
    await act(async () => release?.())
    await waitFor(() =>
      expect(
        within(overview).getByRole("link", { name: "最新报告" })
      ).toBeVisible()
    )
    expect(sourceReads).toBeGreaterThan(1)
    expect(within(overview).getAllByRole("link")).toHaveLength(2)
  })
})
