import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { ClawHubSkillRepositoryPanel } from "@/features/capabilities/clawhub-skill-repository-panel"
import i18n from "@/i18n"

const NOW = "2026-08-07T00:00:00.000Z"
const FIRST_SKILL_ID = "10000000-0000-4000-8000-000000000001"
const SECOND_SKILL_ID = "10000000-0000-4000-8000-000000000002"
const CAPABILITY_ID = "20000000-0000-4000-8000-000000000001"

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function catalogItem(
  overrides: Partial<{
    id: string
    display_name: string
    owner_handle: string
    owner_display_name: string | null
    latest_version: string | null
    installable: boolean
    installability_reason:
      "unavailable" | "missing_version" | "already_installed" | null
    security_status: "clean" | "suspicious" | "malicious" | "unverified"
    security_has_warnings: boolean
    is_suspicious: boolean
    is_malware_blocked: boolean
    installed_capability_id: string | null
    update_available: boolean
  }> = {}
) {
  return {
    id: FIRST_SKILL_ID,
    slug: "shared-browser-slug",
    display_name: "Alice Browser Skill",
    summary: "Automates browser workflows",
    topics: ["browser", "automation"],
    tags: {},
    latest_version: "1.2.3",
    latest_version_created_at: null,
    latest_version_changelog: null,
    latest_version_license: null,
    owner_handle: "alice",
    owner_display_name: null,
    metadata: null,
    stats: {
      downloads: 321,
      installs: 42,
      stars: 17,
      comments: 3,
      versions: 4,
    },
    security_status: "unverified" as const,
    security_has_warnings: false,
    is_suspicious: false,
    is_malware_blocked: false,
    source_created_at: NOW,
    source_updated_at: NOW,
    synced_at: NOW,
    canonical_url: "https://clawhub.ai/alice/shared-browser-slug",
    available: true,
    installable: true,
    installability_reason: null,
    installed_capability_id: null,
    installed_version: null,
    update_available: false,
    ...overrides,
  }
}

function renderPanel(options?: {
  search?: string
  onFeedback?: (message: string, isError?: boolean) => void
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const onFeedback = options?.onFeedback ?? vi.fn()
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ClawHubSkillRepositoryPanel
          search={options?.search ?? ""}
          onFeedback={onFeedback}
        />
      </QueryClientProvider>
      <NotificationCenter />
    </ThemeProvider>
  )
  return { ...result, onFeedback }
}

describe("ClawHubSkillRepositoryPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("clawhub-panel-test-token")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
  })

  it("searches the local catalog, preserves same-slug owners, and links to canonical pages", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      expect(url.pathname).toBe("/api/v1/clawhub/skills")
      expect(url.searchParams.get("search")).toBe("browser")
      expect(url.searchParams.get("sort")).toBe("downloads")
      expect(url.searchParams.get("limit")).toBe("24")
      return Promise.resolve(
        envelope({
          items: [
            catalogItem(),
            catalogItem({
              id: SECOND_SKILL_ID,
              display_name: "Bob Browser Skill",
              owner_handle: "bob",
              owner_display_name: "Bob",
              security_status: "suspicious",
              security_has_warnings: true,
              is_suspicious: true,
              installable: false,
              installability_reason: "unavailable",
            }),
          ],
          next_cursor: null,
          total_count: 2,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel({ search: " browser " })

    const alice = await screen.findByRole("article", {
      name: "Alice Browser Skill",
    })
    const bob = screen.getByRole("article", { name: "Bob Browser Skill" })
    expect(within(alice).getByText("作者：alice")).toBeVisible()
    expect(within(alice).queryByText("ClawHub")).not.toBeInTheDocument()
    expect(within(alice).queryByText("安装时检查")).not.toBeInTheDocument()
    expect(within(bob).getByText("作者：Bob")).toBeVisible()
    expect(within(bob).queryByText("ClawHub")).not.toBeInTheDocument()
    expect(within(bob).queryByText("已标记风险")).not.toBeInTheDocument()
    expect(within(bob).getByText("此技能当前已不可用。")).toBeVisible()
    expect(
      screen.getByText(/LinkSense 不代表 ClawHub 对这些技能进行审核或背书/u)
    ).toBeVisible()
    expect(screen.getByText("共 2 条")).toBeVisible()

    await interaction.click(
      within(alice).getByRole("button", {
        name: "查看Alice Browser Skill详情",
      })
    )
    const detail = await screen.findByRole("dialog", {
      name: "Alice Browser Skill",
    })
    expect(within(detail).getByText("ClawHub")).toBeVisible()
    expect(within(detail).getByText("安装时检查")).toBeVisible()
    for (const label of [
      "Skill",
      "ClawHub",
      "安装时检查",
      "browser",
      "automation",
    ]) {
      expect(within(detail).getByText(label)).toHaveClass(
        "rounded-2xl",
        "border",
        "border-divider"
      )
      expect(within(detail).getByText(label)).not.toHaveClass(
        "border-transparent",
        "border-border"
      )
    }
    const canonicalLink = within(detail).getByRole("link", {
      name: "在 ClawHub 查看",
    })
    expect(canonicalLink).toHaveAttribute(
      "href",
      "https://clawhub.ai/alice/shared-browser-slug"
    )
    expect(canonicalLink).toHaveAttribute("target", "_blank")
    expect(canonicalLink).toHaveAttribute("rel", "noreferrer noopener")
  })

  it("refreshes the local catalog while the panel is open so synced skills appear incrementally", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let requestCount = 0
      const fetchMock = vi.fn(() => {
        requestCount += 1
        return Promise.resolve(
          envelope({
            items:
              requestCount === 1
                ? [catalogItem()]
                : [
                    catalogItem(),
                    catalogItem({
                      id: SECOND_SKILL_ID,
                      display_name: "Newly Synced Skill",
                      owner_handle: "bob",
                    }),
                  ],
            next_cursor: null,
            total_count: requestCount === 1 ? 1 : 2,
          })
        )
      })
      vi.stubGlobal("fetch", fetchMock)
      renderPanel()

      expect(
        await screen.findByRole("article", { name: "Alice Browser Skill" })
      ).toBeVisible()
      expect(
        screen.queryByRole("article", { name: "Newly Synced Skill" })
      ).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(
        await screen.findByRole("article", { name: "Newly Synced Skill" })
      ).toBeVisible()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("defaults to download sorting and can switch to favorite sorting", async () => {
    const requestedSorts: Array<string | null> = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      const sort = url.searchParams.get("sort")
      expect(url.searchParams.get("search")).toBe("agent")
      requestedSorts.push(sort)
      return Promise.resolve(
        envelope({
          items: [
            catalogItem({
              display_name:
                sort === "stars" ? "Favorite First Skill" : "Popular Skill",
            }),
          ],
          next_cursor: null,
          total_count: 5_800,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel({ search: "agent" })

    expect(
      await screen.findByRole("article", { name: "Popular Skill" })
    ).toBeVisible()
    expect(screen.getByText("共 5,800 条")).toBeVisible()

    await interaction.click(screen.getByRole("combobox", { name: "技能排序" }))
    await interaction.click(
      await screen.findByRole("option", { name: "收藏次数" })
    )

    expect(
      await screen.findByRole("article", { name: "Favorite First Skill" })
    ).toBeVisible()
    expect(requestedSorts).toEqual(["downloads", "stars"])
  })

  it("renders the sort control and total count in English", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [catalogItem()],
            next_cursor: null,
            total_count: 5_800,
          })
        )
      )
    )

    renderPanel()

    expect(
      await screen.findByRole("combobox", { name: "Sort skills" })
    ).toHaveTextContent("Downloads")
    expect(screen.getByText("Total: 5,800")).toBeVisible()
  })

  it("shows a precise reason and no install action when no version exists", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        envelope({
          items: [
            catalogItem({
              installable: false,
              latest_version: null,
              installability_reason: "missing_version",
            }),
          ],
          next_cursor: null,
          total_count: 1,
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel()

    const item = await screen.findByRole("article", {
      name: "Alice Browser Skill",
    })
    expect(within(item).getByText(/没有可安装的版本/u)).toBeVisible()
    await interaction.click(within(item).getByRole("button", { name: "操作" }))
    const menu = await screen.findByRole("menu")
    expect(
      within(menu).queryByRole("menuitem", {
        name: "安装",
      })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(menu).getByRole("menuitem", { name: "查看" })
    )
    const detail = await screen.findByRole("dialog", {
      name: "Alice Browser Skill",
    })
    expect(within(detail).getByText("暂不可安装")).toBeVisible()
    expect(
      within(detail).queryByRole("button", { name: "安装" })
    ).not.toBeInTheDocument()
    expect(within(detail).queryByText("安全提示")).not.toBeInTheDocument()
  })

  it("does not offer or request updates for an already-installed catalog item", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const method = init?.method ?? "GET"
      if (url.pathname === "/api/v1/clawhub/skills" && method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              catalogItem({
                installed_capability_id: CAPABILITY_ID,
                installable: false,
                installability_reason: "already_installed",
                update_available: true,
              }),
            ],
            next_cursor: null,
            total_count: 1,
          })
        )
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel()

    const item = await screen.findByRole("article", {
      name: "Alice Browser Skill",
    })
    expect(within(item).getByText("已安装")).toBeVisible()
    await interaction.click(within(item).getByRole("button", { name: "操作" }))

    const menu = await screen.findByRole("menu")
    expect(
      within(menu).queryByRole("menuitem", { name: "安装" })
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole("menuitem", { name: "更新" })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(menu).getByRole("menuitem", { name: "查看" })
    )

    const detail = await screen.findByRole("dialog", {
      name: "Alice Browser Skill",
    })
    expect(within(detail).getByText("有更新")).toBeVisible()
    expect(
      within(detail).queryByRole("button", { name: "安装" })
    ).not.toBeInTheDocument()
    expect(within(detail).queryByText("安全提示")).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        new URL(String(input), window.location.origin).pathname.endsWith(
          "/install-preview"
        )
      )
    ).toBe(false)
  })

  it("moves forward and backward with opaque local cursors", async () => {
    const requestedCursors: Array<string | null> = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      const cursor = url.searchParams.get("cursor")
      requestedCursors.push(cursor)
      return Promise.resolve(
        envelope(
          cursor === "page-two"
            ? {
                items: [
                  catalogItem({
                    id: SECOND_SKILL_ID,
                    display_name: "Second Page Skill",
                  }),
                ],
                next_cursor: null,
                total_count: 2,
              }
            : {
                items: [catalogItem()],
                next_cursor: "page-two",
                total_count: 2,
              }
        )
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel()

    expect(
      await screen.findByRole("article", { name: "Alice Browser Skill" })
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "下一页" }))
    expect(
      await screen.findByRole("article", { name: "Second Page Skill" })
    ).toBeVisible()
    expect(screen.getByText("第 2 页")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "上一页" }))
    expect(
      await screen.findByRole("article", { name: "Alice Browser Skill" })
    ).toBeVisible()
    expect(requestedCursors).toEqual([null, "page-two", null])
  })

  it.each(["menu", "detail"])(
    "installs through the %s using the catalog id and risk confirmation",
    async (entry) => {
      let catalogInstalled = false
      let resolveConfirm: ((response: Response) => void) | undefined
      const confirmResponse = new Promise<Response>((resolve) => {
        resolveConfirm = resolve
      })
      const fetchMock = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin)
          const method = init?.method ?? "GET"
          if (url.pathname === "/api/v1/clawhub/skills" && method === "GET") {
            return Promise.resolve(
              envelope({
                items: [
                  catalogItem({
                    installed_capability_id: catalogInstalled
                      ? CAPABILITY_ID
                      : null,
                    installable: !catalogInstalled,
                    installability_reason: catalogInstalled
                      ? "already_installed"
                      : null,
                  }),
                ],
                next_cursor: null,
                total_count: 1,
              })
            )
          }
          if (
            url.pathname ===
              `/api/v1/clawhub/skills/${FIRST_SKILL_ID}/install-preview` &&
            method === "POST"
          ) {
            return Promise.resolve(
              envelope({
                preview_token: "clawhub-preview-token",
                expires_at: NOW,
                operation: "install",
                capability_id: null,
                source: {
                  source_type: "clawhub",
                  import_kind: "remote_files",
                  skill_id: FIRST_SKILL_ID,
                  owner_handle: "alice",
                  slug: "shared-browser-slug",
                  version: "1.2.3",
                  security_status: "clean",
                  security_has_warnings: true,
                  canonical_url: "https://clawhub.ai/alice/shared-browser-slug",
                },
                type: "skill",
                name: "Alice Browser Skill",
                description: "Automates browser workflows",
                manifest: {},
                declared_capabilities: ["network"],
                declared_environment_keys: [],
                risk_summary: { contains_scripts: true },
                has_logo: false,
                skill_content_preview: "# Alice Browser Skill",
                skill_content_truncated: false,
              })
            )
          }
          if (
            url.pathname ===
              "/api/v1/capabilities/imports/clawhub-preview-token/confirm" &&
            method === "POST"
          ) {
            catalogInstalled = true
            return confirmResponse
          }
          throw new Error(`Unexpected request: ${method} ${url.pathname}`)
        }
      )
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      renderPanel()

      const item = await screen.findByRole("article", {
        name: "Alice Browser Skill",
      })
      if (entry === "menu") {
        await interaction.click(
          within(item).getByRole("button", { name: "操作" })
        )
        await interaction.click(
          await screen.findByRole("menuitem", { name: "安装" })
        )
      } else {
        await interaction.click(
          within(item).getByRole("button", {
            name: "查看Alice Browser Skill详情",
          })
        )
        const detail = await screen.findByRole("dialog", {
          name: "Alice Browser Skill",
        })
        await interaction.click(
          within(detail).getByRole("button", { name: "安装" })
        )
      }

      const dialog = await screen.findByRole("dialog", {
        name: "安装“Alice Browser Skill”？",
      })
      expect(
        screen.queryByRole("dialog", { name: "Alice Browser Skill" })
      ).not.toBeInTheDocument()
      expect(within(dialog).getByText("技能来源")).toBeVisible()
      expect(
        within(dialog).getByText("@alice/shared-browser-slug")
      ).toBeVisible()
      expect(within(dialog).getByText("安装版本")).toBeVisible()
      expect(within(dialog).getByText("1.2.3")).toBeVisible()
      expect(within(dialog).getByText("包含可执行脚本")).toBeVisible()
      const securityWarning = within(dialog)
        .getByText("存在安全警告")
        .closest('[data-slot="alert"]')
      expect(securityWarning).toHaveClass("border-[color:var(--app-border)]")
      expect(within(dialog).getByText("# Alice Browser Skill")).toBeVisible()
      const confirm = within(dialog).getByRole("button", { name: "确认安装" })
      expect(
        document.querySelector(
          "label[for='clawhub-risk-confirm'] span.text-destructive[aria-hidden='true']"
        )
      ).toHaveTextContent("*")
      expect(confirm).toBeDisabled()
      await interaction.click(
        within(dialog).getByRole("checkbox", {
          name: "我已阅读来源与风险提示",
        })
      )
      expect(confirm).toBeEnabled()
      await interaction.click(confirm)

      await waitFor(() => {
        expect(
          screen.queryByRole("dialog", {
            name: "安装“Alice Browser Skill”？",
          })
        ).not.toBeInTheDocument()
      })
      const loadingToast = await screen.findByText("正在安装技能…")
      expect(loadingToast.closest("[data-sonner-toast]")).not.toBeNull()
      await interaction.click(
        within(item).getByRole("button", {
          name: "查看Alice Browser Skill详情",
        })
      )
      const detail = await screen.findByRole("dialog", {
        name: "Alice Browser Skill",
      })
      expect(
        within(detail).getByRole("button", { name: "安装" })
      ).toBeDisabled()
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname ===
              `/api/v1/clawhub/skills/${FIRST_SKILL_ID}/install-preview` &&
            init?.method === "POST"
          )
        })
      ).toBe(true)
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname ===
              "/api/v1/capabilities/imports/clawhub-preview-token/confirm" &&
            init?.method === "POST"
          )
        })
      ).toBe(true)
      resolveConfirm?.(
        envelope({
          id: CAPABILITY_ID,
          name: "Alice Browser Skill",
          slug: "shared-browser-slug",
          type: "skill",
          description: "Automates browser workflows",
          status: "active",
          source_type: "clawhub",
          builtin_key: null,
          is_builtin: false,
          marketplace_listing_id: null,
          marketplace_release_id: null,
          logo_url: null,
          is_owner: true,
          can_manage: true,
          can_govern: false,
          can_select: true,
          can_delete: true,
          has_logo: false,
          preference_status: "enabled",
          manifest: {},
          risk_summary: { contains_scripts: true },
          created_at: NOW,
          updated_at: NOW,
        })
      )
      const installedToast =
        await screen.findByText("已从技能仓库安装到你的个人技能")
      expect(installedToast.closest("[data-sonner-toast]")).not.toBeNull()
      expect(await within(detail).findByText("已安装")).toBeVisible()
      expect(
        within(detail).queryByRole("button", { name: "安装" })
      ).not.toBeInTheDocument()
    }
  )

  it.each(["zh-CN", "en-US"])(
    "prevents duplicate detail installation requests and allows retry after failure in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      let rejectPreview: ((error: Error) => void) | undefined
      const previewResponse = new Promise<Response>((_, reject) => {
        rejectPreview = reject
      })
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname.endsWith("/install-preview")) return previewResponse
        return Promise.resolve(
          envelope({
            items: [catalogItem()],
            next_cursor: null,
            total_count: 1,
          })
        )
      })
      vi.stubGlobal("fetch", fetchMock)
      const interaction = userEvent.setup()
      const { onFeedback } = renderPanel()
      await interaction.click(
        await screen.findByRole("button", {
          name: i18n.t("clawHub.viewDetails", { name: "Alice Browser Skill" }),
        })
      )
      const detail = await screen.findByRole("dialog", {
        name: "Alice Browser Skill",
      })
      await interaction.click(
        within(detail).getByRole("button", {
          name: language === "en-US" ? "Install" : "安装",
        })
      )
      const preparing = within(detail).getByRole("button", {
        name: i18n.t("clawHub.preparing"),
      })
      expect(preparing).toBeDisabled()
      expect(preparing).toHaveAttribute("aria-busy", "true")
      await interaction.click(preparing)
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          String(input).endsWith("/install-preview")
        )
      ).toHaveLength(1)
      await act(async () => rejectPreview?.(new Error("Network unavailable")))
      await waitFor(() =>
        expect(onFeedback).toHaveBeenCalledWith(
          i18n.t("errors.networkUnavailable"),
          true
        )
      )
      expect(
        within(detail).getByRole("button", {
          name: i18n.t("marketplace.install"),
        })
      ).toBeEnabled()
    }
  )

  it("shows local empty and error states and supports retry", async () => {
    let attempt = 0
    const fetchMock = vi.fn(() => {
      attempt += 1
      if (attempt === 1) return Promise.reject(new Error("catalog unavailable"))
      return Promise.resolve(
        envelope({ items: [], next_cursor: null, total_count: 0 })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderPanel({ search: "missing" })

    await interaction.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByText("未找到匹配技能")).toBeVisible()
    expect(screen.getByText("没有与“missing”匹配的技能。")).toBeVisible()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
