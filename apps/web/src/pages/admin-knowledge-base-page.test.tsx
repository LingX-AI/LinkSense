import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
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
import { supportedLocales } from "@linksense/shared"

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
  describe.each([...supportedLocales, "de-DE"])(
    "required governance fields (%s)",
    (locale) => {
      it.each([
        {
          knowledgeBase: activeKnowledgeBase,
          menuAction: "disable",
          action: "disable",
        },
        {
          knowledgeBase: archivedKnowledgeBase,
          menuAction: "enable",
          action: "enable",
        },
        {
          knowledgeBase: activeKnowledgeBase,
          menuAction: "archive",
          action: "archive",
        },
        {
          knowledgeBase: archivedKnowledgeBase,
          menuAction: "delete",
          action: "delete",
        },
        {
          knowledgeBase: archivedKnowledgeBase,
          menuAction: "retryCleanup",
          action: "cleanup_retry",
        },
      ] as const)(
        "marks the audit reason for $action as required",
        async ({ knowledgeBase, menuAction, action }) => {
          await i18n.changeLanguage(locale)
          vi.stubGlobal("fetch", createFetchMock())
          renderPage()
          const user = userEvent.setup()
          await user.click(
            await screen.findByRole("button", {
              name: i18n.t("adminKnowledge.actionsFor", {
                name: knowledgeBase.name,
              }),
            })
          )
          await user.click(
            await screen.findByRole("menuitem", {
              name: i18n.t(`adminKnowledge.actions.${menuAction}`),
            })
          )
          const reason = screen.getByRole("textbox", {
            name: i18n.t("adminKnowledge.reason"),
          })
          const indicator = reason
            .closest('[data-slot="field"]')
            ?.querySelector(
              '[data-slot="field-label"] span[aria-hidden="true"]'
            )
          expect(indicator).toHaveTextContent("*")
          expect(indicator).toHaveClass("text-destructive")
          expect(reason).toBeRequired()
          expect(
            screen.getByRole("button", {
              name: i18n.t(`adminKnowledge.confirm.${action}.action`),
            })
          ).toBeDisabled()
        }
      )

      it("marks the new owner and reason as required without making the owner search mandatory", async () => {
        await i18n.changeLanguage(locale)
        const baseFetch = createFetchMock()
        vi.stubGlobal(
          "fetch",
          vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input), window.location.origin)
            if (url.pathname === "/api/v1/admin/users") {
              return Promise.resolve(
                envelope({
                  items: [
                    {
                      id: "10000000-0000-4000-8000-000000000101",
                      name: "New owner",
                      email: "owner@example.test",
                      role: "user",
                      status: "active",
                      registration_source: "organization_invitation",
                    },
                  ],
                  next_cursor: null,
                })
              )
            }
            return baseFetch(input, init)
          })
        )
        renderPage()
        const user = userEvent.setup()
        await user.click(
          await screen.findByRole("button", {
            name: i18n.t("adminKnowledge.actionsFor", {
              name: activeKnowledgeBase.name,
            }),
          })
        )
        await user.click(
          await screen.findByRole("menuitem", {
            name: i18n.t("adminKnowledge.actions.transferOwner"),
          })
        )
        const dialog = screen.getByRole("dialog")
        const owner = await within(dialog).findByRole("combobox", {
          name: i18n.t("adminKnowledge.transfer.owner"),
        })
        const ownerIndicator = owner
          .closest('[data-slot="field"]')
          ?.querySelector('[data-slot="field-label"] span[aria-hidden="true"]')
        expect(ownerIndicator).toHaveTextContent("*")
        expect(ownerIndicator).toHaveClass("text-destructive")
        expect(owner).toHaveAttribute("aria-required", "true")
        const search = within(dialog).getByRole("textbox", {
          name: i18n.t("adminKnowledge.transfer.search"),
        })
        expect(search).not.toBeRequired()
        expect(search).not.toHaveAttribute("aria-required", "true")
        const reason = within(dialog).getByRole("textbox", {
          name: i18n.t("adminKnowledge.reason"),
        })
        expect(
          reason
            .closest('[data-slot="field"]')
            ?.querySelector(
              '[data-slot="field-label"] span[aria-hidden="true"]'
            )
        ).toHaveTextContent("*")
        const confirm = within(dialog).getByRole("button", {
          name: i18n.t("adminKnowledge.transfer.action"),
        })
        expect(confirm).toBeDisabled()
        await user.type(reason, "Transfer responsibility")
        expect(confirm).toBeDisabled()
        await user.click(owner)
        await user.click(
          await screen.findByRole("option", { name: "New owner" })
        )
        expect(confirm).toBeEnabled()
      })
    }
  )

  it("waits for Chinese composition before searching knowledge bases", async () => {
    const fetchMock = createFetchMock()
    vi.stubGlobal("fetch", fetchMock)
    renderPage()
    await screen.findByText(activeKnowledgeBase.name)
    const input = screen.getByRole("textbox", {
      name: i18n.t("adminKnowledge.search"),
    })
    fetchMock.mockClear()
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: "zhi" }, isComposing: true })
    expect(input).toHaveValue("zhi")
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.input(input, { target: { value: "知识" }, isComposing: true })
    fireEvent.compositionEnd(input, { data: "知识" })
    expect(input).toHaveValue("知识")
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("search=%E7%9F%A5%E8%AF%86"),
        expect.anything()
      )
    )
  })

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("knowledge-governance-token")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows semantic icons before both knowledge-base filter labels", async () => {
    vi.stubGlobal("fetch", createFetchMock())
    renderPage()

    await screen.findByText(activeKnowledgeBase.name)
    const lifecycleFilter = screen.getByRole("combobox", {
      name: i18n.t("adminKnowledge.lifecycle.label"),
    })
    const availabilityFilter = screen.getByRole("combobox", {
      name: i18n.t("adminKnowledge.availability.label"),
    })

    expect(lifecycleFilter.querySelector(".lucide-workflow")).not.toBeNull()
    expect(availabilityFilter.querySelector(".lucide-power")).not.toBeNull()
  })

  it("gives knowledge-base names more width and allows two lines", async () => {
    vi.stubGlobal("fetch", createFetchMock())
    renderPage()
    const name = await screen.findByText(activeKnowledgeBase.name)
    expect(screen.getByRole("columnheader", { name: "知识库" })).toHaveClass(
      "w-[300px]"
    )
    expect(name).toHaveClass(
      "line-clamp-2",
      "whitespace-normal",
      "wrap-anywhere"
    )
    expect(name).not.toHaveAttribute("title")
  })

  it.each(["hover", "focus"] as const)(
    "shows the full clipped name in the global tooltip on %s",
    async (interactionType) => {
      const longName =
        "Acme Company Knowledge Base — Employee Policies and Procedures"
      const fetchMock = createFetchMock()
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          envelope({
            items: [{ ...activeKnowledgeBase, name: longName }],
            next_cursor: null,
          })
        )
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderPage()
      const name = await screen.findByText(longName)
      Object.defineProperties(name, {
        clientHeight: { configurable: true, value: 44 },
        scrollHeight: { configurable: true, value: 66 },
        clientWidth: { configurable: true, value: 276 },
        scrollWidth: { configurable: true, value: 276 },
      })
      if (interactionType === "hover") await interaction.hover(name)
      else {
        for (
          let count = 0;
          count < 10 && document.activeElement !== name;
          count++
        )
          await interaction.tab()
        expect(name).toHaveFocus()
      }
      const tooltip = await screen.findByRole("tooltip")
      expect(tooltip).toHaveTextContent(longName)
      expect(tooltip).toHaveClass(
        "rounded-md",
        "bg-[var(--app-popover)]",
        "text-[var(--app-text)]",
        "whitespace-normal",
        "wrap-anywhere"
      )
      expect(tooltip.children).toHaveLength(0)
      await interaction.keyboard("{Escape}")
      await waitFor(() =>
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
      )
    }
  )

  it("does not show a tooltip for an unclipped name and checks the current size on each hover", async () => {
    vi.stubGlobal("fetch", createFetchMock())
    const interaction = userEvent.setup()
    renderPage()
    const name = await screen.findByText(activeKnowledgeBase.name)
    let scrollHeight = 44
    const measureScrollHeight = vi.fn(() => scrollHeight)
    Object.defineProperties(name, {
      clientHeight: { configurable: true, value: 44 },
      scrollHeight: { configurable: true, get: measureScrollHeight },
      clientWidth: { configurable: true, value: 276 },
      scrollWidth: { configurable: true, value: 276 },
    })
    await interaction.hover(name)
    await waitFor(() => expect(measureScrollHeight).toHaveBeenCalled())
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    await interaction.unhover(name)
    scrollHeight = 66
    await interaction.hover(name)
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      activeKnowledgeBase.name
    )
    await interaction.unhover(name)
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )
    scrollHeight = 44
    measureScrollHeight.mockClear()
    await interaction.hover(name)
    await waitFor(() => expect(measureScrollHeight).toHaveBeenCalled())
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
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
    const archiveItem = await screen.findByRole("menuitem", {
      name: "归档",
    })
    expect(archiveItem).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "永久删除" })
    ).not.toBeInTheDocument()

    await interaction.click(archiveItem)
    expect(screen.getByRole("button", { name: "确认归档" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.click(screen.getByRole("button", { name: "取消" }))
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
    expect(confirm).toHaveClass("bg-destructive", "text-destructive-foreground")
    expect(confirm).toBeDisabled()
    await interaction.type(
      screen.getByRole("textbox", { name: "操作原因" }),
      "内容需要复核"
    )
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
    expect(screen.getByRole("button", { name: "确认撤销" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "操作原因" }),
      "授权范围调整"
    )
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
    expect(screen.getByRole("button", { name: "确认重试" })).not.toHaveClass(
      "bg-destructive"
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "操作原因" }),
      "修复清理任务"
    )
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
    const tableContainer = screen.getByRole("table").parentElement
    expect(tableContainer).toHaveClass("rounded-card", "border")
    expect(tableContainer).not.toContainElement(
      screen.getByRole("navigation", { name: "知识库列表分页" })
    )
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
