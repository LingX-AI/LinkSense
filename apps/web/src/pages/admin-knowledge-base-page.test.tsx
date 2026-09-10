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
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { AdminKnowledgeBasePage } from "@/pages/admin-knowledge-base-page"

const activeKnowledgeBase = {
  id: "knowledge-active",
  name: "活跃知识库",
  owner: { id: "owner-active", name: "张三", status: "active" },
  lifecycle_status: "active",
  availability_status: "enabled",
  document_counts: { total: 8, processing: 1, ready: 6, failed: 1 },
  storage_used_bytes: 2_048,
  storage_reserved_bytes: 1_024,
  share_count: 1,
  active_grants: [
    {
      id: "grant-support",
      target_type: "user_group",
      target_id: "group-support",
      target_name: "售后组",
    },
  ],
  stable_error_codes: ["KNOWLEDGE_DOCUMENT_PROCESSING_FAILED"],
  cleanup_status: null,
  disabled_reason: null,
  created_at: "2026-07-22T00:00:00.000Z",
  updated_at: "2026-07-22T01:00:00.000Z",
}

const archivedKnowledgeBase = {
  ...activeKnowledgeBase,
  id: "knowledge-archived",
  name: "已归档知识库",
  lifecycle_status: "archived",
  availability_status: "disabled",
  active_grants: [],
  share_count: 0,
  stable_error_codes: [],
  cleanup_status: "failed",
  disabled_reason: "管理员停用",
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AdminKnowledgeBasePage />
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function createFetchMock() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin)
    if (
      url.pathname === "/api/v1/admin/knowledge-bases" &&
      (init?.method ?? "GET") === "GET"
    ) {
      return Promise.resolve(
        envelope({
          items: [activeKnowledgeBase, archivedKnowledgeBase],
          next_cursor: null,
        })
      )
    }
    if (url.pathname === "/api/v1/admin/users") {
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    }
    if (url.pathname.endsWith("/cleanup/retry")) {
      return Promise.resolve(envelope({ retried_count: 1 }))
    }
    return Promise.resolve(envelope(null))
  })
}

describe("administrator knowledge-base governance", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("knowledge-governance-token")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows only governance metadata and allows deletion only for archived knowledge bases", async () => {
    vi.stubGlobal("fetch", createFetchMock())
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByRole("heading", { name: "知识库" })).toBeVisible()
    const tabs = screen.getByRole("tablist", { name: "知识库分类" })
    expect(tabs).toHaveClass("max-w-full", "justify-start", "overflow-x-auto")
    expect(within(tabs).getByRole("tab", { name: "知识库" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(
      within(tabs).getByRole("tab", { name: "知识库数据源" })
    ).toHaveAttribute("aria-selected", "false")
    expect(await screen.findByText("活跃知识库")).toBeVisible()
    expect(screen.getAllByText("共 8 个 · 可检索 6 个")).toHaveLength(2)
    expect(screen.getByText("售后组")).toBeVisible()
    expect(screen.queryByText("knowledge-active")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /预览|下载/ })
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "治理知识库 活跃知识库" })
    )
    expect(await screen.findByRole("menuitem", { name: "归档" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "永久删除" })
    ).not.toBeInTheDocument()

    await interaction.keyboard("{Escape}")
    await interaction.click(
      screen.getByRole("button", { name: "治理知识库 已归档知识库" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "永久删除" })
    ).toBeVisible()
  })

  it("requires an audit reason before disabling a knowledge base", async () => {
    const fetchMock = createFetchMock()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", { name: "治理知识库 活跃知识库" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "停用" })
    )

    const confirm = screen.getByRole("button", { name: "确认停用" })
    expect(confirm).toBeDisabled()
    await interaction.type(screen.getByLabelText("操作原因"), "内容需要复核")
    expect(confirm).toBeEnabled()
    await interaction.click(confirm)

    await waitFor(() => {
      const command = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname ===
            "/api/v1/admin/knowledge-bases/knowledge-active/disable" &&
          init?.method === "POST"
        )
      })
      expect(command).toBeDefined()
      expect(JSON.parse(String(command?.[1]?.body))).toEqual({
        reason: "内容需要复核",
      })
    })
    const notification = await screen.findByText("知识库已停用")
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
  })

  it("requires a separate confirmation to revoke an active grant", async () => {
    const fetchMock = createFetchMock()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", {
        name: "撤销对 售后组 的共享授权",
      })
    )
    await interaction.type(screen.getByLabelText("操作原因"), "授权范围调整")
    await interaction.click(screen.getByRole("button", { name: "确认撤销" }))

    await waitFor(() => {
      const command = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname ===
            "/api/v1/admin/knowledge-bases/knowledge-active/grants/grant-support" &&
          init?.method === "DELETE"
        )
      })
      expect(command).toBeDefined()
      expect(JSON.parse(String(command?.[1]?.body))).toEqual({
        reason: "授权范围调整",
      })
    })
  })

  it("retries all failed cleanup resources without exposing internal target ids", async () => {
    const fetchMock = createFetchMock()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", {
        name: "治理知识库 已归档知识库",
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "重试清理" })
    )
    await interaction.type(screen.getByLabelText("操作原因"), "修复清理任务")
    await interaction.click(screen.getByRole("button", { name: "确认重试" }))

    await waitFor(() => {
      const command = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname ===
            "/api/v1/admin/knowledge-bases/knowledge-archived/cleanup/retry" &&
          init?.method === "POST"
        )
      })
      expect(command).toBeDefined()
      expect(JSON.parse(String(command?.[1]?.body))).toEqual({
        reason: "修复清理任务",
      })
    })
  })

  it("navigates knowledge bases with cursor pagination", async () => {
    const nextCursor = "00000000-0000-4000-8000-000000000099"
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/admin/knowledge-bases") {
        const cursor = url.searchParams.get("cursor")
        return Promise.resolve(
          envelope({
            items: cursor ? [archivedKnowledgeBase] : [activeKnowledgeBase],
            next_cursor: cursor ? null : nextCursor,
          })
        )
      }
      return Promise.resolve(envelope({ items: [], next_cursor: null }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("活跃知识库")).toBeVisible()
    expect(
      screen.getByRole("navigation", { name: "知识库列表分页" })
    ).toBeVisible()
    expect(screen.getByText("第 1 页")).toBeVisible()

    const firstRequest = fetchMock.mock.calls.find(([input]) => {
      const url = new URL(String(input), window.location.origin)
      return url.pathname === "/api/v1/admin/knowledge-bases"
    })
    expect(
      new URL(
        String(firstRequest?.[0]),
        window.location.origin
      ).searchParams.get("limit")
    ).toBe("20")

    await interaction.click(screen.getByRole("button", { name: "下一页" }))
    expect(await screen.findByText("已归档知识库")).toBeVisible()
    expect(screen.queryByText("活跃知识库")).not.toBeInTheDocument()
    expect(screen.getByText("第 2 页")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "上一页" }))
    expect(await screen.findByText("活跃知识库")).toBeVisible()
    expect(screen.getByText("第 1 页")).toBeVisible()
  })

  it("uses the concise knowledge-base title in English", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal("fetch", createFetchMock())
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "Knowledge bases" })
    ).toBeVisible()
  })
})
