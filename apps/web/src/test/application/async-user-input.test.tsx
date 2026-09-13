import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  setupApplicationTests,
  conversation,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

const requestId = "30000000-0000-4000-8000-000000000021"
const turnId = "30000000-0000-4000-8000-000000000022"

describe("asynchronous questions in the conversation page", () => {
  setupApplicationTests()
  it.each([
    ["running", false],
    ["completed", false],
    ["completed", true],
  ] as const)(
    "allows answering while the source turn is %s with uncertain delivery=%s and keeps the composer available",
    async (status, uncertainFirst) => {
      let submitted = false
      let attempts = 0
      const question = () => ({
        id: requestId,
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: turnId,
        item_id: "native-async-question",
        kind: "async_questions",
        status: submitted ? "answered" : attempts > 0 ? "answering" : "pending",
        questions: [
          {
            id: "question-1",
            header: "1",
            question: "请选择这次升级的范围。",
            is_other: true,
            is_secret: false,
            options: [
              { label: "完整接入", description: "" },
              { label: "基本升级", description: "" },
            ],
          },
        ],
        response_content: attempts > 0 ? { "question-1": "完整接入" } : null,
        auto_resolve_at: null,
        resolved_at: submitted ? "2026-09-13T00:00:01.000Z" : null,
        resolved_action: submitted ? "accept" : null,
        created_at: "2026-09-13T00:00:00.000Z",
        updated_at: "2026-09-13T00:00:00.000Z",
      })
      const { requests } = installApiMock({
        eventStreamBody: "",
        conversationGetResponse: async () =>
          json({
            success: true,
            data: {
              ...conversation,
              execution_status: status,
              turns: [{ id: turnId, status }],
              running_turn:
                status === "running" ? { id: turnId, status } : null,
              user_input_requests: [question()],
              pending_requests: [],
            },
          }),
        userInputResponse: (body) => {
          expect(body).toEqual({
            action: "accept",
            content: { "question-1": "完整接入" },
          })
          attempts++
          if (uncertainFirst && attempts === 1) {
            return json(
              { success: false, error_code: "TURN_STEER_REQUEST_UNCERTAIN" },
              503
            )
          }
          submitted = true
          return json({ success: true, data: question() })
        },
      })
      const interaction = userEvent.setup()
      renderApp()
      expect(await screen.findByText("请选择这次升级的范围。")).toBeVisible()
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeVisible()
      expect(
        requests.filter(
          (request) =>
            request.path.includes("/user-input-requests/") &&
            request.method === "POST"
        )
      ).toHaveLength(0)
      await interaction.click(screen.getByRole("button", { name: "提交回答" }))
      await waitFor(() =>
        expect(
          requests.filter(
            (request) =>
              request.path.includes("/user-input-requests/") &&
              request.method === "POST"
          )
        ).toHaveLength(1)
      )
      if (uncertainFirst) {
        await waitFor(() =>
          expect(
            screen.getByRole("radio", { name: "基本升级" })
          ).toHaveAttribute("aria-disabled", "true")
        )
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "提交回答" })).toBeEnabled()
        )
        await interaction.click(
          screen.getByRole("button", { name: "提交回答" })
        )
        await waitFor(() =>
          expect(
            requests.filter(
              (request) =>
                request.path.includes("/user-input-requests/") &&
                request.method === "POST"
            )
          ).toHaveLength(2)
        )
      }
      await waitFor(() => {
        expect(
          screen
            .queryAllByTestId("conversation-user-input-request")
            .filter((card) =>
              ["pending", "submitting"].includes(
                card.dataset.requestStatus ?? ""
              )
            )
        ).toHaveLength(0)
      })
      if (status === "completed") {
        await interaction.click(
          within(screen.getByTestId(`turn-summary-${turnId}`)).getByRole(
            "button",
            { name: "展开中间过程" }
          )
        )
        expect(
          screen.getByTestId("conversation-user-input-request")
        ).toHaveAttribute("data-request-status", "submitted")
        expect(screen.getByRole("radio", { name: "完整接入" })).toBeChecked()
        expect(screen.getByRole("button", { name: "提交回答" })).toBeDisabled()
      }
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeVisible()
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toHaveLength(0)
    }
  )
})
