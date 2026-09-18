import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  conversation,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

describe("regeneration start failure", () => {
  setupApplicationTests()

  it.each(["before-receipt", "after-receipt", "stored-event"])(
    "stops thinking and preserves the original history when starting fails via %s",
    async (timing) => {
      const turnId = "30000000-0000-4000-8000-000000000088"
      let releaseReceipt!: () => void
      let releaseError!: () => void
      const receiptReady = new Promise<void>((resolve) => {
        releaseReceipt = resolve
      })
      const errorReady = new Promise<void>((resolve) => {
        releaseError = resolve
      })
      let failed = false
      const options = {
        eventStreamBody: "",
        eventStreamStart: errorReady,
        conversationGetResponse: async () =>
          json({
            success: true,
            data: {
              ...conversation,
              execution_status: "completed",
              messages: [
                {
                  id: "m1",
                  role: "user",
                  turn_id: "turn-1",
                  content: "请帮我更换应用图标",
                },
                {
                  id: "m2",
                  role: "assistant",
                  turn_id: "turn-1",
                  phase: "final_answer",
                  content: "原始应用开发记录",
                },
              ],
              turns: [{ id: "turn-1", status: "completed" }],
              running_turn: null,
              pending_requests: [],
              activities: [],
              events:
                failed && timing === "stored-event" ? [failureEvent()] : [],
            },
          }),
        regenerateResponse: async () => {
          await receiptReady
          return json(
            {
              success: true,
              data: { turn_id: turnId, accepted: true, status: "starting" },
            },
            202
          )
        },
      }
      const { requests } = installApiMock(options)
      const regenerationRequests = () =>
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/messages/m1/regenerate"
        )
      const failureEvent = () => ({
        id: "60000000-0000-4000-8000-000000000019",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: null,
        sequence_no: 19,
        event_type: "conversation.error",
        visibility: "user_visible",
        sse_event_id: "c1:19",
        created_at: "2026-09-18T01:52:03.000Z",
        payload: {
          schema_version: 1,
          error_code: "RUNNER_UNAVAILABLE",
          message_key: "errors.runnerUnavailable",
          retryable: true,
          start_failure: {
            turn_id: turnId,
            idempotency_key: `regenerate:m1:${z.object({ idempotency_key: z.string() }).parse(regenerationRequests()[0]?.body).idempotency_key}`,
          },
        },
      })
      renderApp()
      const interaction = userEvent.setup()
      const message = await screen.findByRole("article", { name: "用户消息" })
      await interaction.click(
        within(message).getByRole("button", { name: "编辑消息" })
      )
      await interaction.click(
        within(message).getByRole("button", { name: "发送" })
      )
      await waitFor(() => expect(regenerationRequests()).toHaveLength(1))
      if (timing === "after-receipt") {
        await act(async () => releaseReceipt())
        expect(await screen.findByText("正在思考")).toBeVisible()
      }
      await act(async () => {
        failed = true
        options.eventStreamBody =
          timing === "stored-event"
            ? ""
            : `id: c1:19\nevent: conversation.error\ndata: ${JSON.stringify(failureEvent())}\n\n`
        releaseError()
      })
      if (timing === "before-receipt") {
        expect(
          await screen.findByText(/执行服务暂不可用，请稍后重试/u)
        ).toBeVisible()
      }
      await act(async () => releaseReceipt())
      await waitFor(() => {
        expect(screen.queryByText("正在思考")).not.toBeInTheDocument()
        expect(
          screen.queryByRole("button", { name: "停止" })
        ).not.toBeInTheDocument()
      })
      expect(
        await screen.findByText(/执行服务暂不可用，请稍后重试/u)
      ).toBeVisible()
      expect(screen.getByText("原始应用开发记录")).toBeVisible()
      expect(regenerationRequests()).toHaveLength(1)
    }
  )
})
