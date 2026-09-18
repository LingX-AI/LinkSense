import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it } from "vitest"
import { z } from "zod"

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
        void submit({
          prompt,
          capability_ids: [],
          knowledge_base_ids: [],
          file_ids: [],
        })
      }
    >
      应用提交
    </button>
  )
}

describe("interactive submissions in native chat", () => {
  setupApplicationTests()

  it("restores the accepted request after a page refresh and reuses its receipt", async () => {
    const { requests } = installApiMock({
      eventStreamBody: "",
      conversationGetResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            execution_status: "running",
            turns: [],
            running_turn: null,
            messages: [],
            pending_requests: [],
            activities: [],
            events: [],
            starting_turn: {
              turn_id: turnId,
              task_kind: "turn",
              idempotency_key: "before-refresh",
              input_text: prompt,
              created_at: "2026-09-18T00:00:00Z",
              message_display: {
                kind: "interactive_application",
                application_id: applicationId,
              },
              attachments: [],
            },
          },
        }),
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
    expect(await screen.findByText(prompt)).toBeVisible()
    expect(await screen.findByText("正在思考")).toBeVisible()
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "应用提交" }))
    expect(
      requests.filter(
        (request) => request.path === "/api/v1/conversations/c1/turns"
      )
    ).toHaveLength(0)
    expect(
      screen.queryByText("还没有任务。可以直接从输入框开始")
    ).not.toBeInTheDocument()
  })

  it.each(["before-receipt", "after-receipt", "detail"])(
    "ends thinking when an accepted start fails via %s before a native turn exists",
    async (timing) => {
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
              execution_status: "idle",
              turns: [],
              running_turn: null,
              messages: [],
              pending_requests: [],
              activities: [],
              events: failed && timing === "detail" ? [failureEvent()] : [],
            },
          }),
        turnStartResponse: async () => {
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
      const failureEvent = () => ({
        id: "60000000-0000-4000-8000-000000000019",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: null,
        sequence_no: 19,
        event_type: "conversation.error",
        visibility: "user_visible",
        sse_event_id: "c1:19",
        created_at: "2026-09-17T13:15:00.000Z",
        payload: {
          schema_version: 1,
          error_code: "RUNNER_UNAVAILABLE",
          message_key: "errors.runnerUnavailable",
          retryable: true,
          start_failure: {
            turn_id: turnId,
            idempotency_key: z
              .object({ idempotency_key: z.string() })
              .parse(
                requests.find(
                  (request) =>
                    request.method === "POST" &&
                    request.path === "/api/v1/conversations/c1/turns"
                )?.body
              ).idempotency_key,
          },
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
      await waitFor(() =>
        expect(
          requests.some(
            (request) => request.path === "/api/v1/conversations/c1/turns"
          )
        ).toBe(true)
      )
      if (timing === "after-receipt") {
        await act(async () => releaseReceipt())
        expect(await screen.findByText("正在思考")).toBeVisible()
      }
      await act(async () => {
        failed = true
        options.eventStreamBody =
          timing === "detail"
            ? ""
            : `id: c1:19\nevent: conversation.error\ndata: ${JSON.stringify(failureEvent())}\n\n`
        releaseError()
      })
      if (timing === "before-receipt") {
        await waitFor(() =>
          expect(
            screen.queryByRole("button", { name: "停止" })
          ).not.toBeInTheDocument()
        )
      }
      await act(async () => releaseReceipt())
      await waitFor(() => {
        expect(screen.queryByText("正在思考")).not.toBeInTheDocument()
        expect(screen.queryByText("正在发送…")).not.toBeInTheDocument()
        expect(
          screen.queryByRole("button", { name: "停止" })
        ).not.toBeInTheDocument()
      })
      expect(
        await screen.findByText(/执行服务暂不可用，请稍后重试/u)
      ).toBeVisible()
      expect(
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/turns"
        )
      ).toHaveLength(1)
      await interaction.click(screen.getByRole("button", { name: "应用提交" }))
      expect(await screen.findByText("正在思考")).toBeVisible()
      expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
      expect(
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/turns"
        )
      ).toHaveLength(2)
    }
  )

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
