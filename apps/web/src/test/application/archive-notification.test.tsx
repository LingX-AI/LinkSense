import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import {
  setupApplicationTests,
  conversations,
  installApiMock,
  json,
  renderApp,
} from "./fixture"

function toastButton(toast: HTMLElement, name: string): HTMLElement {
  const button = within(toast).getByRole("button", { name })
  // jsdom does not implement the pointer capture API used by Sonner.
  button.setPointerCapture = vi.fn()
  return button
}

describe("task archive notification", () => {
  setupApplicationTests()
  afterEach(() => notify.dismiss())

  it.each([
    { origin: "sidebar", pinned: false },
    { origin: "header", pinned: false },
    { origin: "sidebar", pinned: true },
    { origin: "header", pinned: true },
  ])(
    "offers undo after archiving from $origin with pinned=$pinned",
    async ({ origin, pinned }) => {
      const { requests } = installApiMock()
      const interaction = userEvent.setup()
      renderApp()
      const sidebar = await screen.findByRole("complementary", {
        name: "LinkSense 导航",
      })
      await within(sidebar).findByText(conversations[1].title)
      const id = origin === "sidebar" ? "c2" : "c1"
      const title = conversations[origin === "sidebar" ? 1 : 0].title
      if (pinned) {
        await interaction.click(
          within(sidebar).getByRole("button", { name: `置顶任务“${title}”` })
        )
        await within(sidebar).findByRole("button", {
          name: `取消置顶任务“${title}”`,
        })
      }
      if (origin === "sidebar") {
        await interaction.click(
          within(sidebar).getByRole("button", {
            name: `归档任务“${conversations[1].title}”`,
          })
        )
      } else {
        await interaction.click(
          within(await screen.findByRole("banner")).getByRole("button", {
            name: "操作",
          })
        )
        await interaction.click(
          await screen.findByRole("menuitem", { name: "归档任务" })
        )
      }
      const label = await screen.findByText("已归档任务", {
        selector: "[data-title]",
      })
      const toast = label.closest<HTMLElement>("[data-sonner-toast]")!
      expect(toast.closest("[data-sonner-toaster]")).toHaveAttribute(
        "data-y-position",
        "top"
      )
      expect(toast.closest("[data-sonner-toaster]")).toHaveAttribute(
        "data-x-position",
        "center"
      )
      expect(within(toast).getByRole("button", { name: "查看" })).toHaveClass(
        "bg-secondary"
      )
      for (const name of ["查看", "撤销"]) {
        expect(within(toast).getByRole("button", { name })).toHaveClass(
          "h-6",
          "px-2.5",
          "text-xs"
        )
      }
      expect(within(toast).getByRole("button", { name: "关闭" })).toBeVisible()
      await interaction.click(toastButton(toast, "撤销"))
      await waitFor(() =>
        expect(requests).toContainEqual(
          expect.objectContaining({
            path: `/api/v1/conversations/${id}`,
            method: "PATCH",
            body: {
              archive_status: "active",
              ...(pinned ? { pinned: true } : {}),
            },
          })
        )
      )
      expect(await screen.findByText("已撤销归档")).toBeVisible()
      expect(
        await within(
          screen.getByRole("complementary", { name: "LinkSense 导航" })
        ).findByText(conversations[origin === "sidebar" ? 1 : 0].title)
      ).toBeVisible()
    }
  )

  it("opens the archived task page from View", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(
      await screen.findByRole("button", {
        name: `归档任务“${conversations[1].title}”`,
      })
    )
    const label = await screen.findByText("已归档任务", {
      selector: "[data-title]",
    })
    await interaction.click(
      toastButton(label.closest<HTMLElement>("[data-sonner-toast]")!, "查看")
    )
    expect(
      await screen.findByRole("heading", { name: "已归档任务" })
    ).toBeVisible()
    expect(await screen.findByText(conversations[1].title)).toBeVisible()
  })

  it("shows a failure if undo is denied and prevents duplicate restore requests", async () => {
    let finishUndo!: () => void
    const pendingUndo = new Promise<void>((resolve) => {
      finishUndo = resolve
    })
    const { requests } = installApiMock({
      conversationPatchResponse: async (id, body) => {
        if (body.archive_status === "active") {
          await pendingUndo
          return json(
            { success: false, error_code: "CONVERSATION_NOT_FOUND" },
            404
          )
        }
        return json({
          success: true,
          data: {
            ...conversations[1],
            id,
            archived: true,
            archive_status: "archived",
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(
      await screen.findByRole("button", {
        name: `归档任务“${conversations[1].title}”`,
      })
    )
    const label = await screen.findByText("已归档任务", {
      selector: "[data-title]",
    })
    const toast = label.closest<HTMLElement>("[data-sonner-toast]")!
    const undo = within(toast).getByRole("button", { name: "撤销" })
    fireEvent.click(undo)
    fireEvent.click(undo)
    expect(await screen.findByText("正在撤销归档…")).toBeVisible()
    expect(
      within(toast).queryByRole("button", { name: "撤销" })
    ).not.toBeInTheDocument()
    expect(
      requests.filter(
        (request) =>
          request.method === "PATCH" &&
          typeof request.body === "object" &&
          request.body !== null &&
          "archive_status" in request.body &&
          request.body.archive_status === "active"
      )
    ).toHaveLength(1)
    finishUndo()
    await waitFor(() => expect(toast).toHaveAttribute("data-type", "error"))
    expect(screen.queryByText("已撤销归档")).not.toBeInTheDocument()
  })

  it("does not offer undo when archiving fails", async () => {
    installApiMock({
      conversationPatchResponse: () =>
        json({ success: false, error_code: "CONVERSATION_NOT_FOUND" }, 404),
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(
      await screen.findByRole("button", {
        name: `归档任务“${conversations[1].title}”`,
      })
    )
    expect(
      await screen.findByText("请求的资源不存在或你无权访问。")
    ).toBeVisible()
    expect(
      screen.queryByText("已归档任务", { selector: "[data-title]" })
    ).not.toBeInTheDocument()
  })

  it("localizes archive feedback in Chinese and English and falls back to Chinese", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const [key, chinese, english] of [
      ["archivedNotification", "已归档任务", "Task archived"],
      ["undoArchive", "撤销", "Undo"],
      ["undoingArchive", "正在撤销归档…", "Undoing archive…"],
      ["archiveUndone", "已撤销归档", "Archive undone"],
    ]) {
      expect(i18n.t(`conversation.${key}`, { lng: "zh-CN" })).toBe(chinese)
      expect(i18n.t(`conversation.${key}`, { lng: "en-US" })).toBe(english)
      expect(fallback.t(`conversation.${key}`, { lng: "en-US" })).toBe(chinese)
    }
  })
})
