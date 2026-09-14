import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { MyFeedbackPage } from "./my-feedback-page"
import { AdminFeedbackPage } from "./admin-feedback-page"

const pendingFeedback = {
  id: "10000000-0000-4000-8000-000000000010",
  content: "希望优化图片预览",
  created_at: "2026-09-09T00:00:00.000Z",
  images: [],
  reply_count: 0,
}
const answeredFeedback = {
  ...pendingFeedback,
  id: "10000000-0000-4000-8000-000000000020",
  content: "登录问题",
  reply_count: 1,
}
const replyImage = {
  id: "10000000-0000-4000-8000-000000000012",
  filename: "reply.png",
  mime_type: "image/png",
  size_bytes: 3,
  sort_order: 0,
}
const reply = {
  id: "10000000-0000-4000-8000-000000000011",
  content: "已经处理，请查看说明",
  created_at: "2026-09-09T01:00:00.000Z",
  images: [replyImage],
}
const submitter = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "用户",
  email: "user@example.com",
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  setAccessToken("feedback-test-token")
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reply")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setAccessToken(null)
})

describe("feedback action column alignment", () => {
  it.each([false, true])(
    "centers the action heading and view button even with deletion available (admin: %s)",
    async (admin) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          envelope({
            items: [
              admin ? { ...pendingFeedback, submitter } : pendingFeedback,
            ],
            next_cursor: null,
          })
        )
      )
      renderPage(admin)
      const view = await screen.findByRole("button", { name: "查看" })
      expect(screen.getByRole("columnheader", { name: "操作" })).toHaveClass(
        "text-center"
      )
      expect(view.closest("td")).toHaveClass("text-center")
      if (admin) {
        expect(view.parentElement).toHaveClass(
          "inline-grid",
          "grid-cols-[1.75rem_auto_1.75rem]"
        )
        expect(view).toHaveClass("col-start-2")
        expect(within(view.closest("td")!).getAllByRole("button")).toHaveLength(
          2
        )
      }
    }
  )
})

describe("feedback page refresh", () => {
  it.each([false, true])(
    "uses an icon-only hover button to reload feedback (admin: %s)",
    async (admin) => {
      const fetchMock = vi.fn(async () =>
        envelope({
          items: [admin ? { ...pendingFeedback, submitter } : pendingFeedback],
          next_cursor: null,
        })
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderPage(admin)
      await screen.findByText(pendingFeedback.content)
      const refresh = screen.getByRole("button", { name: "刷新" })
      expect(refresh).toHaveTextContent(/^$/)
      expect(refresh).toHaveClass("hover:bg-hover", "size-7")
      expect(refresh).not.toHaveClass("bg-secondary")
      await interaction.click(refresh)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    }
  )
})

describe("feedback dialog scrolling", () => {
  it.each([false, true])(
    "keeps the header and actions outside the scroll area (admin: %s)",
    async (admin) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).endsWith(pendingFeedback.id))
            return envelope({
              ...pendingFeedback,
              replies: [{ ...reply, images: [] }],
            })
          return envelope({
            items: [
              admin ? { ...pendingFeedback, submitter } : pendingFeedback,
            ],
            next_cursor: null,
          })
        })
      )
      const interaction = userEvent.setup()
      renderPage(admin)
      await interaction.click(
        await screen.findByRole("button", { name: "查看" })
      )
      const dialog = await screen.findByRole("dialog", { name: "反馈详情" })
      const replyText = await within(dialog).findByText(reply.content)
      const body = replyText.closest<HTMLDivElement>(
        '[data-slot="feedback-dialog-body"]'
      )
      expect(dialog).toHaveClass(
        "flex",
        "flex-col",
        "overflow-hidden",
        "max-h-[calc(100dvh-2rem)]"
      )
      expect(dialog).not.toHaveClass("overflow-y-auto")
      expect(body).toHaveClass("min-h-0", "overflow-y-auto")
      expect(body).not.toContainElement(
        within(dialog).getByRole("heading", { name: "反馈详情" })
      )
      const footer = dialog.querySelector<HTMLDivElement>(
        '[data-slot="dialog-footer"]'
      )
      if (admin) {
        expect(footer).toHaveClass("shrink-0")
        expect(body).not.toContainElement(footer)
        const send = within(dialog).getByRole("button", { name: "发送回复" })
        expect(footer).toContainElement(send)
        expect(body).toContainElement(
          within(dialog).getByRole("textbox", { name: "回复用户" })
        )
        expect(send.closest("form")).toContainElement(body)
      } else {
        expect(footer).toBeNull()
      }
      const closeButtons = within(dialog).getAllByRole("button", {
        name: "关闭",
      })
      expect(closeButtons).toHaveLength(1)
      const close = within(dialog).getByRole("button", { name: "关闭" })
      expect(body).not.toContainElement(close)
      expect(footer?.contains(close)).not.toBe(true)
      await interaction.click(close)
      expect(
        screen.queryByRole("dialog", { name: "反馈详情" })
      ).not.toBeInTheDocument()
    }
  )
})

describe("feedback table frame", () => {
  it.each([false, true])(
    "uses the shared rounded border and keeps pagination outside (admin: %s)",
    async (admin) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          envelope({
            items: [pendingFeedback, answeredFeedback].map((feedback) =>
              admin ? { ...feedback, submitter } : feedback
            ),
            next_cursor: null,
          })
        )
      )
      renderPage(admin)

      const table = await screen.findByRole("table")
      const frame = table.closest('[data-slot="table-container"]')
      expect(frame).toHaveClass(
        "rounded-card",
        "border",
        "border-[color:var(--app-border)]",
        "overflow-x-auto"
      )
      expect(within(table).getAllByRole("row")).toHaveLength(3)
      expect(frame).not.toContainElement(
        screen.getByRole("button", { name: "下一页" })
      )
    }
  )
})

describe("personal feedback", () => {
  it.each([
    ["zh-CN", "我的反馈", "待回复", "已回复"],
    ["en-US", "My feedback", "Awaiting reply", "Replied"],
    ["fr-FR", "我的反馈", "待回复", "已回复"],
  ])(
    "clearly identifies replied and awaiting feedback in %s",
    async (language, title, waiting, replied) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          envelope({
            items: [pendingFeedback, answeredFeedback],
            next_cursor: null,
          })
        )
      )
      renderPage()
      expect(await screen.findByRole("heading", { name: title })).toBeVisible()
      expect(await screen.findByText(waiting)).toBeVisible()
      expect(screen.getByText(replied)).toBeVisible()
      expectRepliedStatus(screen.getByText(replied))
    }
  )

  it("opens reply details and downloads reply images through the personal API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path.includes("/images/"))
        return new Response(new Blob(["png"]), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      if (path.endsWith(answeredFeedback.id))
        return envelope({ ...answeredFeedback, replies: [reply] })
      return envelope({ items: [answeredFeedback], next_cursor: null })
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()
    await interaction.click(await screen.findByRole("button", { name: "查看" }))
    const dialog = await screen.findByRole("dialog", { name: "反馈详情" })
    expect(await within(dialog).findByText(reply.content)).toBeVisible()
    expectRepliedStatus(within(dialog).getByText("已回复"))
    expect(
      within(dialog).queryByRole("button", { name: "发送回复" })
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "放大查看图片 reply.png" })
      ).toBeEnabled()
    )
    const replyImageButton = within(dialog).getByRole("button", {
      name: "放大查看图片 reply.png",
    })
    expect(replyImageButton.parentElement).toHaveClass("h-32")
    expect(replyImageButton.parentElement).not.toHaveClass("aspect-square")
    await interaction.click(replyImageButton)
    expect(
      await screen.findByRole("dialog", { name: "图片预览" })
    ).toBeVisible()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        `/feedback/${answeredFeedback.id}/replies/${reply.id}/images/${replyImage.id}`
      ),
      expect.anything()
    )
  })

  it("handles loading, errors, retry, and empty results", async () => {
    let finish: ((response: Response) => void) | undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          })
      )
      .mockResolvedValue(envelope({ items: [], next_cursor: null }))
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()
    expect(screen.getByRole("status")).toBeVisible()
    await waitFor(() => expect(finish).toBeDefined())
    finish?.(failure())
    await interaction.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByText("暂无反馈")).toBeVisible()
  })

  it("navigates to older personal feedback using cursors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      return envelope({
        items: url.searchParams.has("cursor")
          ? [answeredFeedback]
          : [pendingFeedback],
        next_cursor: url.searchParams.has("cursor") ? null : pendingFeedback.id,
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()
    await screen.findByText(pendingFeedback.content)
    await interaction.click(screen.getByRole("button", { name: "下一页" }))
    expect(await screen.findByText(answeredFeedback.content)).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "上一页" }))
    expect(await screen.findByText(pendingFeedback.content)).toBeVisible()
  })
})

describe("administrator replies", () => {
  it.each(["text", "image", "both"])(
    "closes after a successful %s reply, refreshes the list and shows history when reopened",
    async (kind) => {
      let replied = false
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname
          if (init?.method === "POST") {
            replied = true
            return envelope({
              id: reply.id,
              created_at: reply.created_at,
              image_count: kind === "text" ? 0 : 1,
            })
          }
          if (path.endsWith(pendingFeedback.id))
            return envelope({
              ...pendingFeedback,
              reply_count: replied ? 1 : 0,
              replies: replied
                ? [
                    {
                      ...reply,
                      content: kind === "image" ? "" : reply.content,
                      images: kind === "text" ? [] : [replyImage],
                    },
                  ]
                : [],
            })
          if (path.includes("/images/")) return new Response(new Blob(["png"]))
          return envelope({
            items: [
              { ...pendingFeedback, submitter, reply_count: replied ? 1 : 0 },
            ],
            next_cursor: null,
          })
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderPage(true)
      await interaction.click(
        await screen.findByRole("button", { name: "查看" })
      )
      const dialog = await screen.findByRole("dialog", { name: "反馈详情" })
      const submit = await within(dialog).findByRole("button", {
        name: "发送回复",
      })
      expect(submit).toBeDisabled()
      if (kind !== "image")
        await interaction.type(
          within(dialog).getByRole("textbox", { name: "回复用户" }),
          reply.content
        )
      if (kind !== "text")
        await interaction.upload(
          within(dialog).getByLabelText("回复图片"),
          new File(["png"], "reply.png", { type: "image/png" })
        )
      await interaction.click(submit)
      await waitFor(() =>
        expect(
          screen.queryByRole("dialog", { name: "反馈详情" })
        ).not.toBeInTheDocument()
      )
      expect(screen.getByText("已回复")).toBeVisible()
      expectRepliedStatus(screen.getByText("已回复"))
      const post = fetchMock.mock.calls.find(
        (call) => call[1]?.method === "POST"
      )
      expect(post?.[0]).toContain(
        `/admin/feedback/${pendingFeedback.id}/replies`
      )
      const body = post?.[1]?.body
      expect(body).toBeInstanceOf(FormData)
      if (body instanceof FormData) {
        expect(body.get("content")).toBe(kind === "image" ? "" : reply.content)
        expect(body.getAll("images")).toHaveLength(kind === "text" ? 0 : 1)
      }
      await interaction.click(screen.getByRole("button", { name: "查看" }))
      const reopenedDialog = await screen.findByRole("dialog", {
        name: "反馈详情",
      })
      expect(
        await within(reopenedDialog).findByRole("textbox", { name: "回复用户" })
      ).toHaveValue("")
      expectRepliedStatus(within(reopenedDialog).getByText("已回复"))
      expect(
        within(reopenedDialog).getByRole("button", { name: "发送回复" })
      ).toBeDisabled()
      if (kind !== "image")
        expect(
          await within(reopenedDialog).findByText(reply.content)
        ).toBeVisible()
      if (kind !== "text")
        expect(
          await within(reopenedDialog).findByAltText("反馈图片 reply.png")
        ).toBeVisible()
    }
  )

  it("preserves the reply draft and images after failure and blocks duplicate submissions", async () => {
    let finish: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST")
          return new Promise<Response>((resolve) => {
            finish = resolve
          })
        if (String(input).endsWith(pendingFeedback.id))
          return envelope({ ...pendingFeedback, replies: [] })
        return envelope({
          items: [{ ...pendingFeedback, submitter }],
          next_cursor: null,
        })
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage(true)
    await interaction.click(await screen.findByRole("button", { name: "查看" }))
    const text = await screen.findByRole("textbox", { name: "回复用户" })
    await interaction.type(text, "请保留草稿")
    await interaction.upload(
      screen.getByLabelText("回复图片"),
      new File(["png"], "reply.png", { type: "image/png" })
    )
    await interaction.click(screen.getByRole("button", { name: "发送回复" }))
    expect(screen.getByRole("button", { name: "发送中…" })).toBeDisabled()
    const form = text.closest("form")
    if (form) fireEvent.submit(form)
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")
    ).toHaveLength(1)
    finish?.(failure())
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(screen.getByRole("dialog", { name: "反馈详情" })).toBeVisible()
    expect(text).toHaveValue("请保留草稿")
    expect(screen.getByAltText("reply.png")).toBeVisible()
    expect(screen.getByRole("button", { name: "发送回复" })).toBeEnabled()
  })
})

function renderPage(admin = false) {
  return render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        {admin ? <AdminFeedbackPage /> : <MyFeedbackPage />}
      </QueryClientProvider>
    </MemoryRouter>
  )
}
function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
function failure() {
  return new Response(
    JSON.stringify({
      success: false,
      error_code: "INTERNAL_ERROR",
      message_key: "errors.internal",
    }),
    { status: 500, headers: { "content-type": "application/json" } }
  )
}

function expectRepliedStatus(status: HTMLElement) {
  expect(status).toHaveClass("text-foreground")
  expect(status.className).not.toMatch(/(?:^|\s|:)bg-/u)
  expect(status.querySelector("svg")).toHaveClass("text-success")
}
