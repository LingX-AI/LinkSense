import { act, fireEvent, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { installApiMock, renderApp, setupApplicationTests } from "./fixture"

describe("personal reasoning visibility in conversations", () => {
  setupApplicationTests()

  it("shows thinking after persisted reasoning is followed by completed commentary in a running task", async () => {
    const turnId = "30000000-0000-4000-8000-000000000099"
    const thought = "Previous reasoning about the requested document."
    const commentary = "The document is still being prepared."
    installApiMock({
      showReasoning: true,
      eventStreamBody: "",
      conversationOverride: {
        execution_status: "running",
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
        messages: [
          {
            id: "commentary-after-reasoning",
            role: "assistant",
            turn_id: turnId,
            phase: "commentary",
            content: commentary,
            event_sequence_no: 2,
            created_at: "2026-10-20T00:00:02.000Z",
          },
        ],
        activities: [],
        events: [
          {
            id: "reasoning-before-commentary",
            type: "item/completed",
            turn_id: turnId,
            sequence_no: 1,
            created_at: "2026-10-20T00:00:01.000Z",
            payload: {
              schema_version: 2,
              source: "codex_app_server",
              method: "item/completed",
              params: {
                threadId: "native-thread",
                turnId,
                item: {
                  id: "reasoning-before-commentary",
                  type: "reasoning",
                  content: [thought],
                },
              },
            },
          },
        ],
      },
    })
    renderApp("/conversations/c1")

    expect(await screen.findByText(thought)).toBeVisible()
    expect(screen.getByText(commentary)).toBeVisible()
    expect(await screen.findByText("正在思考", { exact: true })).toBeVisible()
    expect(screen.getByText(thought)).not.toHaveClass("shimmer")
  })

  it("keeps full reasoning received after a terminal snapshot until history has caught up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const turnId = "30000000-0000-4000-8000-000000000099"
    const body = "Complete reasoning still awaiting the history snapshot."
    const event = {
      id: "60000000-0000-4000-8000-000000000020",
      conversation_id: "20000000-0000-4000-8000-000000000001",
      turn_id: turnId,
      sequence_no: 20,
      event_type: "item/completed",
      visibility: "user_collapsed",
      sse_event_id: "c1:20",
      created_at: "2026-10-19T00:00:00.000Z",
      payload: {
        schema_version: 2,
        source: "codex_app_server",
        method: "item/completed",
        params: {
          threadId: "native-thread",
          turnId: "native-turn",
          item: {
            type: "reasoning",
            id: "reasoning-test",
            summary: ["Brief summary"],
            content: [body],
          },
        },
      },
    }
    installApiMock({
      showReasoning: true,
      conversationOverride: {
        execution_status: "completed",
        turns: [{ id: turnId, status: "completed" }],
        running_turn: null,
        messages: [
          {
            id: "final-test",
            role: "assistant",
            turn_id: turnId,
            phase: "final_answer",
            content: "Task finished.",
          },
        ],
        activities: [],
        events: [],
      },
      eventStreamBody: `id: c1:20\nevent: item/completed\ndata: ${JSON.stringify(event)}\n\n`,
    })
    renderApp("/conversations/c1")
    expect(await screen.findByText("Task finished.")).toBeVisible()
    fireEvent.click(await screen.findByRole("button", { name: "展开中间过程" }))
    expect(await screen.findByText(body)).toBeVisible()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(screen.getByText(body)).toBeVisible()
  })

  it.each([false, true])(
    "uses the saved display preference on page load: %s",
    async (showReasoning) => {
      const turnId = "30000000-0000-4000-8000-000000000099"
      installApiMock({
        showReasoning,
        conversationOverride: {
          turns: [{ id: turnId, status: "completed" }],
          running_turn: null,
          messages: [
            {
              id: "final-reasoning-test",
              role: "assistant",
              turn_id: turnId,
              phase: "final_answer",
              content: "Task finished.",
            },
          ],
          activities: [],
          events: [
            {
              id: "reasoning-snapshot",
              type: "item/completed",
              turn_id: turnId,
              sequence_no: 1,
              created_at: "2026-10-19T00:00:00.000Z",
              payload: {
                schema_version: 2,
                source: "codex_app_server",
                method: "item/completed",
                params: {
                  threadId: "native-thread",
                  turnId,
                  item: {
                    id: "reasoning-test",
                    type: "reasoning",
                    summary: ["Short summary stays independent."],
                    content: ["Full reasoning from the saved preference."],
                  },
                },
              },
            },
          ],
        },
      })
      renderApp("/conversations/c1")
      expect(await screen.findByText("Task finished.")).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: "展开中间过程" }))
      if (showReasoning)
        expect(
          await screen.findByText("Full reasoning from the saved preference.")
        ).toBeVisible()
      else
        expect(
          screen.queryByText("Full reasoning from the saved preference.")
        ).toBeNull()
    }
  )
})
