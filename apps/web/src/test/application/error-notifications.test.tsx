import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { notify } from "@/components/feedback/notification"
import {
  conversations,
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
