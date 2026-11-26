import type { SensitiveDataTaskStatus } from "@linksense/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { compile } from "tailwindcss"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { TaskLocalModel } from "./task-local-model"

const ownerId = "owner-a"
const idleStatus = { status: "idle" } as const
const model = { id: "local-a", name: "Local A" }
const localStatus = {
  status: "local",
  model,
  local_models: [model],
} satisfies SensitiveDataTaskStatus
const noticeTitle = "检测到当前任务需要处理敏感数据"
const noticeDescription = "已切换到本地模型 Local A"
const hideNoticeLabel = "以后不再提示"
const preferenceKey = `linksense.sensitive-data.local-switch-notice.${ownerId}`

describe("local model switch notification", () => {
  beforeEach(async () => {
    window.localStorage.removeItem(preferenceKey)
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    notify.dismiss()
    window.localStorage.removeItem(preferenceKey)
  })

  it.each([
    ["a loaded task", idleStatus],
    ["a task still loading its first status", undefined],
  ] as const)(
    "shows one dismissible top-right notice when %s switches",
    async (_label, initialStatus) => {
      const { rerender } = render(<Task status={initialStatus} active />)
      rerender(<Task status={localStatus} />)

      const title = await screen.findByText(noticeTitle, {
        selector: "[data-title]",
      })
      const description = screen.getByText(noticeDescription, {
        selector: "[data-description]",
      })
      expect(description.closest("[data-sonner-toast]")).toBe(
        title.closest("[data-sonner-toast]")
      )
      expect(title.closest("[data-sonner-toaster]")).toHaveAttribute(
        "data-x-position",
        "right"
      )
      expect(title.closest("[data-sonner-toaster]")).toHaveAttribute(
        "data-y-position",
        "top"
      )
      const action = screen.getByRole("button", { name: hideNoticeLabel })
      const close = screen.getByRole("button", { name: "关闭" })
      expect(action).toBeVisible()
      expect(close).toBeVisible()

      const toast = title.closest("[data-sonner-toast]")
      const content = title.closest("[data-content]")
      if (!toast || !content) throw new Error("Expected the notice and its content")
      const compiler = await compile("@tailwind utilities;")
      const classes = [toast, ...toast.querySelectorAll("[class]")].flatMap(
        (element) => [...element.classList]
      )
      const stylesheet = document.createElement("style")
      stylesheet.textContent = compiler.build(classes)
      document.head.append(stylesheet)
      try {
        expect(getComputedStyle(toast).display).toBe("grid")
        const contentStyle = getComputedStyle(content)
        expect(contentStyle.gridRowStart).toBe("1")
        expect(contentStyle.gridColumn.replace(/\s/g, "")).toBe("2/-1")
        expect(getComputedStyle(action)).toMatchObject({
          gridColumnStart: "2",
          gridRowStart: "2",
        })
        expect(getComputedStyle(action).justifySelf).toMatch(/^(?:flex-)?end$/)
        expect(getComputedStyle(close)).toMatchObject({
          gridColumnStart: "3",
          gridRowStart: "2",
        })
      } finally {
        stylesheet.remove()
      }

      rerender(<Task status={{ ...localStatus }} active />)
      expect(
        screen.getAllByText(noticeTitle, { selector: "[data-title]" })
      ).toHaveLength(1)
    }
  )

  it("remembers the opt-out for future tasks by this account and still shows the active local model", async () => {
    const first = render(<Task status={idleStatus} active />)
    first.rerender(<Task status={localStatus} />)
    fireEvent.click(
      await screen.findByRole("button", { name: hideNoticeLabel })
    )
    expect(window.localStorage.getItem(preferenceKey)).toBe("dismissed")
    first.unmount()

    const second = render(
      <Task conversationId="task-b" status={idleStatus} active />
    )
    second.rerender(<Task conversationId="task-b" status={localStatus} />)
    expect(screen.getByRole("status")).toHaveTextContent("敏感 · Local A")
    expect(
      screen.queryByText(noticeTitle, { selector: "[data-title]" })
    ).not.toBeInTheDocument()

    second.rerender(
      <Task
        userId="owner-b"
        conversationId="task-c"
        status={idleStatus}
        active
      />
    )
    second.rerender(
      <Task userId="owner-b" conversationId="task-c" status={localStatus} />
    )
    // The dismissed toast keeps a hidden node in the DOM until its exit
    // transition ends, and it carries the same title text. Wait for the new
    // owner's mounted toast instead of matching the removed one.
    await waitFor(() => {
      const current = screen
        .queryAllByText(noticeTitle, { selector: "[data-title]" })
        .find(
          (title) =>
            title.closest("[data-sonner-toast]")?.getAttribute("data-removed") !==
            "true"
        )
      expect(current).toBeVisible()
    })
  })

  it("shows the local model without announcing an already switched task when opened", () => {
    const { rerender } = render(<Task status={localStatus} />)
    rerender(<Task status={localStatus} active />)
    expect(screen.getByRole("status")).toHaveTextContent("敏感 · Local A")
    expect(
      screen.queryByText(noticeTitle, { selector: "[data-title]" })
    ).not.toBeInTheDocument()
  })
})

function Task({
  status,
  userId = ownerId,
  conversationId = "task-a",
  active = false,
}: {
  status: SensitiveDataTaskStatus | undefined
  userId?: string
  conversationId?: string
  active?: boolean
}) {
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationCenter />
        <TaskLocalModel
          ownerId={userId}
          conversationId={conversationId}
          status={status}
          active={active}
          showBadge
        />
      </ThemeProvider>
    </QueryClientProvider>
  )
}
