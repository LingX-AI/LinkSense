import { act, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { notify } from "@/components/feedback/notification"
import {
  conversations,
  conversation,
  installApiMock,
  json,
  renderApp,
  setupApplicationTests,
} from "./fixture"

describe("conversation error notifications", () => {
  setupApplicationTests()

  afterEach(() => {
    notify.dismiss()
  })

  it.each([null, "80000000-0000-4000-8000-000000000001"])(
    "waits for task detail when its read receipt arrives first without replaying an old runner error, category=%s",
    async (categoryId) => {
      const target = {
        ...conversations[0],
        category_id: categoryId,
        execution_status: "completed",
        has_unread_completion: true,
      }
      let releaseDetail!: () => void
      const detailReady = new Promise<void>((resolve) => {
        releaseDetail = resolve
      })
      let markedRead = false
      const { requests } = installApiMock({
        conversationListResponse: () =>
          json({
            success: true,
            data: {
              items: [
                { ...target, has_unread_completion: !markedRead },
                conversations[1],
              ],
              next_cursor: null,
            },
          }),
        conversationGetResponse: async () => {
          await detailReady
          return json({
            success: true,
            data: {
              ...conversation,
              ...target,
              has_unread_completion: !markedRead,
              execution_status: "completed",
              running_turn: null,
              turns: [],
              last_event_id: "c1:182",
            },
          })
        },
        conversationPatchResponse: async () => {
          markedRead = true
          return json({
            success: true,
            data: { ...target, has_unread_completion: false },
          })
        },
      })
      const baseFetch = window.fetch
      const cursors: Array<string | null> = []
      let streamController:
        ReadableStreamDefaultController<Uint8Array> | undefined
      const errorFrame = (sequence: number) =>
        new TextEncoder().encode(
          `id: c1:${sequence}\nevent: conversation.error\ndata: ${JSON.stringify(
            {
              id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
              conversation_id: "20000000-0000-4000-8000-000000000001",
              turn_id: null,
              sequence_no: sequence,
              event_type: "conversation.error",
              visibility: "user_visible",
              sse_event_id: `c1:${sequence}`,
              payload: {
                schema_version: 1,
                error_code: "RUNNER_UNAVAILABLE",
                message_key: "errors.runnerUnavailable",
                retryable: true,
              },
              created_at: "2026-09-09T06:14:12.541Z",
            }
          )}\n\n`
        )
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          if (url.pathname === "/api/v1/task-categories" && categoryId)
            return json({
              success: true,
              data: [
                {
                  id: categoryId,
                  name: "日常工作",
                  sort_order: 0,
                  created_at: "2026-09-09T00:00:00.000Z",
                  updated_at: "2026-09-09T00:00:00.000Z",
                },
              ],
            })
          if (url.pathname === "/api/v1/conversations/c1/events") {
            const cursor = new Headers(init?.headers).get("Last-Event-ID")
            cursors.push(cursor)
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  streamController = controller
                  if (!cursor) controller.enqueue(errorFrame(2))
                },
              }),
              { headers: { "content-type": "text/event-stream" } }
            )
          }
          return baseFetch(input, init)
        })
      )
      const interaction = userEvent.setup()
      renderApp("/conversations/new")
      const sidebar = await screen.findByRole("complementary", {
        name: "LinkSense 导航",
      })
      await interaction.click(
        await within(sidebar).findByRole("link", {
          name: new RegExp(target.title),
        })
      )
      await waitFor(() =>
        expect(requests).toContainEqual(
          expect.objectContaining({
            method: "PATCH",
            path: "/api/v1/conversations/c1",
            body: { completion_read: true },
          })
        )
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(cursors).toEqual([])
      await act(async () => releaseDetail())
      await waitFor(() => expect(cursors).toEqual(["c1:182"]))
      expect(
        screen.queryByText(/执行服务暂不可用，请稍后重试/u)
      ).not.toBeInTheDocument()
      // A new failure after the snapshot is still delivered normally.
      await act(async () => streamController?.enqueue(errorFrame(183)))
      expect(
        await screen.findByText(/执行服务暂不可用，请稍后重试/u)
      ).toBeVisible()
    }
  )

  it("shows admission errors at the global top, expires them, and shows the same error on retry", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        turns: [],
        running_turn: null,
        pending_requests: [],
      },
      turnStartResponse: async () =>
        json(
          {
            success: false,
            error_code: "APPLICATION_NOT_FOUND",
            message_key: "errors.application.notFound",
          },
          404
        ),
    })
    const interaction = userEvent.setup()
    renderApp()
    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "你好呀")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const message = "应用不存在或你无权访问"
    const error = await screen.findByText(message)
    expect(error.closest("[data-sonner-toast]")).toHaveAttribute(
      "data-type",
      "error"
    )
    expect(error.closest("[data-sonner-toaster]")).toHaveAttribute(
      "data-y-position",
      "top"
    )
    expect(error.closest("[data-sonner-toaster]")).toHaveAttribute(
      "data-x-position",
      "center"
    )
    expect(error.closest(".conversation-workspace")).toBeNull()
    expect(error.closest('[aria-live="polite"]')).not.toBeNull()
    expect(document.querySelector(".conversation-banner-stack")).toBeNull()
    expect(composer).toHaveValue("你好呀")

    await waitFor(() => expect(screen.queryByText(message)).toBeNull())
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const repeatedError = await screen.findByText(message)
    const toast = repeatedError.closest("[data-sonner-toast]")
    if (!(toast instanceof HTMLElement)) throw new Error("Expected error toast")
    within(toast).getByRole("button", { name: "关闭" }).focus()
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(screen.queryByText(message)).toBeNull())
    expect(composer).toHaveValue("你好呀")

    await interaction.click(screen.getByRole("button", { name: "发送" }))
    expect(await screen.findByText(message)).toBeVisible()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toHaveLength(3)
  })

  it("shows archive action errors globally while preserving the task row", async () => {
    installApiMock({
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items:
              query.get("archived") === "true"
                ? [{ ...conversations[1], archived: true }]
                : conversations,
            next_cursor: null,
          },
        }),
      conversationPatchResponse: () =>
        json({ success: false, error_code: "NOT_FOUND" }, 404),
    })
    const interaction = userEvent.setup()
    renderApp("/archived")
    const restore = await screen.findByRole("button", {
      name: "取消归档任务“整理项目会议纪要”",
    })
    await interaction.click(restore)

    const error = await screen.findByText("请求的资源不存在或你无权访问")
    expect(error.closest("[data-sonner-toast]")).toHaveAttribute(
      "data-type",
      "error"
    )
    expect(error.closest("main")).toBeNull()
    expect(restore).toBeEnabled()
    expect(document.querySelector(".status-banner-error")).toBeNull()
  })
})
