import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
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
import { AdminFeedbackPage } from "@/pages/admin-feedback-page"

const feedback = {
  id: "10000000-0000-4000-8000-000000000010",
  content: "上传图片后预览区域偶尔会显示空白。",
  created_at: "2026-08-03T05:06:07.000Z",
  submitter: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "林晓",
    email: "lin@example.com",
  },
  images: [
    {
      id: "10000000-0000-4000-8000-000000000011",
      filename: "问题截图.png",
      mime_type: "image/png",
      size_bytes: 128,
      sort_order: 0,
    },
  ],
}

describe("administrator feedback page", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("admin-feedback-token")
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:admin-feedback")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    setAccessToken(null)
  })

  it("lists feedback and opens full text with authenticated image previews", async () => {
    const requestedPaths: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        requestedPaths.push(url.pathname)
        if (url.pathname.endsWith(`/images/${feedback.images[0]?.id}`)) {
          return new Response(new Blob(["png"], { type: "image/png" }), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        }
        return envelope({ items: [feedback], next_cursor: null })
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "用户反馈" })
    ).toBeVisible()
    expect(await screen.findByText("林晓")).toBeVisible()
    expect(screen.getByText("lin@example.com")).toBeVisible()
    expect(screen.getByText("1 张")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "查看" }))
    const dialog = await screen.findByRole("dialog", { name: "反馈详情" })
    expect(
      within(dialog).getByText("上传图片后预览区域偶尔会显示空白。")
    ).toBeVisible()
    expect(
      await within(dialog).findByAltText("反馈图片 问题截图.png")
    ).toBeVisible()
    expect(requestedPaths).toContain(
      `/api/v1/admin/feedback/${feedback.id}/images/${feedback.images[0]?.id}`
    )

    await interaction.click(
      within(dialog).getByRole("button", {
        name: "放大查看图片 问题截图.png",
      })
    )
    expect(
      await screen.findByRole("dialog", { name: "图片预览" })
    ).toBeVisible()
  })

  it("uses stable cursor pagination for older feedback", async () => {
    const cursor = "10000000-0000-4000-8000-000000000099"
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      return envelope({
        items: url.searchParams.get("cursor") ? [] : [feedback],
        next_cursor: url.searchParams.get("cursor") ? null : cursor,
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("林晓")
    await interaction.click(screen.getByRole("button", { name: "下一页" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`cursor=${cursor}`),
        expect.anything()
      )
    })
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled()
  })

  it("deletes feedback from the right-side icon after confirmation", async () => {
    let deleted = false
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin)
        if (
          init?.method === "DELETE" &&
          url.pathname.endsWith(`/admin/feedback/${feedback.id}`)
        ) {
          deleted = true
          return new Response(null, { status: 204 })
        }
        return envelope({
          items: deleted ? [] : [feedback],
          next_cursor: null,
        })
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("林晓")
    await interaction.click(
      screen.getByRole("button", { name: "删除 林晓 提交的反馈" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "删除这条反馈？",
    })
    expect(
      within(dialog).getByText(
        "将删除 林晓 提交的反馈内容及全部图片。此操作无法撤销。"
      )
    ).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining(feedback.id),
      expect.objectContaining({ method: "DELETE" })
    )

    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/admin/feedback/${feedback.id}`),
        expect.objectContaining({ method: "DELETE" })
      )
    })
    await waitFor(() =>
      expect(screen.queryByText("林晓")).not.toBeInTheDocument()
    )
  })

  it("keeps the feedback and confirmation open when deletion fails", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return new Response(
            JSON.stringify({
              success: false,
              error_code: "INTERNAL_ERROR",
              message_key: "errors.internal",
            }),
            {
              status: 500,
              headers: { "content-type": "application/json" },
            }
          )
        }
        return envelope({ items: [feedback], next_cursor: null })
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await screen.findByText("林晓")
    await interaction.click(
      screen.getByRole("button", { name: "删除 林晓 提交的反馈" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "删除这条反馈？",
    })
    await interaction.click(
      within(dialog).getByRole("button", { name: "删除" })
    )

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/admin/feedback/${feedback.id}`),
        expect.objectContaining({ method: "DELETE" })
      )
    )
    expect(screen.getByText("林晓")).toBeVisible()
    expect(dialog).toBeVisible()
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminFeedbackPage />
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
