import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"

import App from "@/App"
import { AppProviders } from "@/app/providers"
import { createInteractiveApplicationSubmitter } from "@/features/applications/interactive-application-submission"
import {
  conversation,
  installApiMock,
  json,
  setupApplicationTests,
} from "./fixture"

const applicationId = "20000000-0000-4000-8000-000000000001"
const turnId = "30000000-0000-4000-8000-000000000088"
const prompt = "通过交互式应用提交的完整研究要求"

function ApplicationSubmissionTrigger() {
  const queryClient = useQueryClient()
  const submit = useMemo(
    () =>
      createInteractiveApplicationSubmitter({
        queryClient,
        applicationId,
        conversationId: "c1",
      }),
    [queryClient]
  )
  return (
    <button
      onClick={() =>
        void submit({ prompt, capability_ids: [], knowledge_base_ids: [] })
      }
    >
      应用提交
    </button>
  )
}

describe("interactive submissions in native chat", () => {
  setupApplicationTests()

  it.each([false, true])(
    "renders immediately and reconciles the message once, with a pending stop request of %s",
    async (stop) => {
      let release: (() => void) | undefined
      const ready = new Promise<void>((resolve) => {
        release = resolve
      })
      let accepted = false
      let interrupted = false
      const detail = () => ({
        ...conversation,
        execution_status: accepted && !interrupted ? "running" : "completed",
        turns: accepted
          ? [{ id: turnId, status: interrupted ? "interrupted" : "running" }]
          : [],
        running_turn:
          accepted && !interrupted ? { id: turnId, status: "running" } : null,
        messages: accepted
          ? [
              {
                id: "persisted-app-message",
                role: "user",
                turn_id: turnId,
                content: prompt,
                display: {
                  kind: "interactive_application",
                  application_id: applicationId,
                },
              },
            ]
          : [],
        pending_requests: [],
        activities: [],
      })
      const { requests } = installApiMock({
        conversationGetResponse: async () =>
          json({ success: true, data: detail() }),
        eventStreamBody: "",
        turnStartResponse: async () => {
          await ready
          accepted = true
          return json(
            {
              success: true,
              data: { turn_id: turnId, accepted: true, status: "starting" },
            },
            202
          )
        },
        interruptResponse: () => {
          interrupted = true
          return json({ success: true, data: {} })
        },
      })
      const interaction = userEvent.setup()
      render(
        <MemoryRouter initialEntries={["/conversations/c1"]}>
          <AppProviders>
            <ApplicationSubmissionTrigger />
            <App />
          </AppProviders>
        </MemoryRouter>
      )
      await screen.findByRole("textbox", { name: "任务输入框" })
      await interaction.click(screen.getByRole("button", { name: "应用提交" }))
      expect(await screen.findByText(prompt)).toBeVisible()
      expect(screen.getByText("正在发送…")).toBeVisible()
      if (stop)
        await interaction.click(screen.getByRole("button", { name: "停止" }))
      await act(async () => release?.())
      await waitFor(() =>
        expect(screen.queryByText("正在发送…")).not.toBeInTheDocument()
      )
      expect(screen.getAllByText(prompt)).toHaveLength(1)
      expect(
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/turns"
        )
      ).toHaveLength(1)
      if (stop) {
        await waitFor(() =>
          expect(
            requests.filter(
              (request) =>
                request.path ===
                `/api/v1/conversations/c1/turns/${turnId}/interrupt`
            )
          ).toHaveLength(1)
        )
      }
    }
  )
})
