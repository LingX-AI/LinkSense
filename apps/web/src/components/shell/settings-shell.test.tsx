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
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { SettingsShell } from "@/components/shell/settings-shell"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import i18n, { supportedLanguages } from "@/i18n"
import { desktopViewportQuery } from "@/lib/responsive"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({
    user: { role: "admin", status: "active" },
  }),
}))

vi.mock("@/features/admin/system-update-notice", () => ({
  SystemUpdateNotice: () => null,
}))

describe("SettingsShell administrator navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders a page dialog backdrop independently of the closed mobile navigation sheet", () => {
    render(
      <MemoryRouter initialEntries={["/admin/models"]}>
        <Routes>
          <Route element={<SettingsShell />}>
            <Route
              path="*"
              element={
                <Dialog open>
                  <DialogContent closeLabel="关闭">
                    <DialogTitle>添加模型</DialogTitle>
                    <DialogDescription>配置模型</DialogDescription>
                  </DialogContent>
                </Dialog>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeVisible()
    expect(
      screen.getByRole("dialog", { name: "添加模型" })
    ).not.toHaveAttribute("data-nested")
    expect(
      document.querySelector('[data-slot="sheet-overlay"]')
    ).not.toBeInTheDocument()
  })

  it.each([
    "/settings/general",
    "/settings/profile",
    "/settings/quota",
    "/settings/personalization",
    "/settings/appearance",
    "/settings/security",
    "/settings/credentials",
    "/settings/mcp",
    "/settings/weixin",
    "/archived",
    "/settings/feedback",
    "/admin/users",
    "/admin/groups",
    "/admin/roles",
    "/admin/capabilities",
    "/admin/knowledge-bases",
    "/admin/knowledge-sources",
    "/admin/models",
    "/admin/quotas",
    "/admin/settings",
    "/admin/health",
    "/admin/feedback",
    "/admin/audit",
    "/admin/usage",
    "/admin/system-update",
  ])("marks administration routes for page-specific width at %s", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<SettingsShell />}>
            <Route
              path="*"
              element={<div data-testid="settings-page-content" />}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByRole("main")).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("contentinfo")).toHaveClass(
      "h-12",
      "shrink-0",
      "justify-center",
      "md:h-16",
      "md:justify-end",
      "md:px-7"
    )
    const content = screen
      .getByTestId("settings-page-content")
      .closest(".settings-content")
    expect(content).toHaveClass("settings-content")
    expect(content?.classList.contains("settings-content-administration")).toBe(
      path.startsWith("/admin/")
    )
  })

  it("keeps attribution in a bottom footer outside the settings scroll area", () => {
    render(
      <MemoryRouter initialEntries={["/admin/system-update"]}>
        <Routes>
          <Route element={<SettingsShell />}>
            <Route path="*" element={<div>System update content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    const main = screen.getByRole("main")
    const footer = screen.getByRole("contentinfo")
    const attribution = screen.getByRole("link", {
      name: "由 LinkSense 提供支持",
    })

    expect(main).toHaveClass("min-h-0", "flex-1")
    expect(main.parentElement).toHaveClass("flex", "min-h-0", "flex-col")
    expect(main.nextElementSibling).toBe(footer)
    expect(main).not.toContainElement(footer)
    expect(main).toContainElement(screen.getByText("System update content"))
    expect(footer).toContainElement(attribution)
    expect(footer).toHaveClass("h-12", "shrink-0", "md:h-16")
    expect(attribution).not.toHaveClass("fixed")
  })

  it("places personal quota immediately after the profile", () => {
    render(
      <MemoryRouter initialEntries={["/settings/quota"]}>
        <SettingsShell />
      </MemoryRouter>
    )
    const links = within(
      screen.getByRole("navigation", { name: "个人" })
    ).getAllByRole("link")
    const profile = links.findIndex(
      (link) => link.getAttribute("href") === "/settings/profile"
    )
    expect(links[profile + 1]).toHaveAttribute("href", "/settings/quota")
    expect(links[profile + 1]).toHaveAccessibleName("额度使用")
    expect(links[profile + 1]?.querySelector("svg")).toHaveClass("lucide-gauge")
  })

  it("keeps the return link and search outside the scrolling navigation", () => {
    render(
      <MemoryRouter initialEntries={["/settings/general"]}>
        <SettingsShell />
      </MemoryRouter>
    )

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    const header = sidebar.querySelector(".settings-navigation-header")
    const scroll = sidebar.querySelector(".settings-navigation-scroll")
    const backLink = screen.getByRole("link", { name: "返回 LinkSense" })
    const search = screen.getByRole("textbox", { name: "搜索设置" })
    const personalNavigation = screen.getByRole("navigation", { name: "个人" })

    expect(header).toContainElement(backLink)
    expect(header).toContainElement(search)
    expect(scroll).not.toContainElement(backLink)
    expect(scroll).not.toContainElement(search)
    expect(scroll).toContainElement(personalNavigation)
  })

  it("places personal feedback immediately after archived tasks", () => {
    render(
      <MemoryRouter initialEntries={["/settings/feedback"]}>
        <SettingsShell />
      </MemoryRouter>
    )
    const links = within(
      screen.getByRole("navigation", { name: "个人" })
    ).getAllByRole("link")
    const archivedIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/archived"
    )
    expect(links[archivedIndex + 1]).toHaveAttribute(
      "href",
      "/settings/feedback"
    )
    expect(links[archivedIndex + 1]).toHaveTextContent("我的反馈")
    expect(links[archivedIndex + 1]).toHaveClass(
      "settings-navigation-link-active"
    )
  })

  it("updates the administration container marker when navigating between sections", async () => {
    const interaction = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <SettingsShell />
      </MemoryRouter>
    )
    const main = screen.getByRole("main")
    const content = main.querySelector(".settings-content")
    expect(content).toHaveClass("settings-content-administration")
    await interaction.click(screen.getByRole("link", { name: "常规" }))
    expect(content).not.toHaveClass("settings-content-administration")
    await interaction.click(screen.getByRole("link", { name: "用户与用户组" }))
    expect(content).toHaveClass("settings-content-administration")
  })

  it.each([
    ["zh-CN", "管理", "额度管理"],
    ["en-US", "Administration", "Quota management"],
  ])(
    "places quota management below model settings followed by usage statistics in %s",
    async (language, navigationLabel, quotaLabel) => {
      await i18n.changeLanguage(language)
      render(
        <MemoryRouter initialEntries={["/admin/quotas"]}>
          <SettingsShell />
        </MemoryRouter>
      )
      const links = within(
        screen.getByRole("navigation", { name: navigationLabel })
      ).getAllByRole("link")
      const modelIndex = links.findIndex(
        (link) => link.getAttribute("href") === "/admin/models"
      )
      expect(modelIndex).toBeGreaterThan(-1)
      expect(links[modelIndex + 1]).toHaveAttribute("href", "/admin/quotas")
      expect(links[modelIndex + 1]).toHaveTextContent(quotaLabel)
      expect(links[modelIndex + 1]?.querySelector("svg")).toHaveClass(
        "lucide-gauge"
      )
      expect(links[modelIndex + 1]).toHaveClass(
        "settings-navigation-link-active"
      )
      expect(links[modelIndex + 2]).toHaveAttribute("href", "/admin/usage")
      expect(links[modelIndex + 3]).toHaveAttribute("href", "/admin/settings")
    }
  )

  it("places system update at the end of the management group", () => {
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <SettingsShell />
      </MemoryRouter>
    )

    const navigation = screen.getByRole("navigation", { name: "管理" })
    const links = within(navigation).getAllByRole("link")

    expect(
      within(navigation).getByRole("link", { name: "额度管理" })
    ).toHaveAttribute("href", "/admin/quotas")
    expect(links.at(-1)).toHaveAttribute("href", "/admin/system-update")
    expect(links.at(-1)).toHaveTextContent("系统更新")
    expect(
      within(navigation).getByRole("link", { name: "用量统计" })
    ).toHaveAttribute("href", "/admin/usage")
    expect(
      within(navigation).getByRole("link", { name: "审计日志" })
    ).toHaveAttribute("href", "/admin/audit")
    expect(
      within(navigation).getByRole("link", { name: "用户反馈" })
    ).toHaveAttribute("href", "/admin/feedback")
    expect(
      within(navigation).queryByRole("link", { name: "公共凭据" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "帮助中心" })
    ).not.toBeInTheDocument()
  })

  it("keeps MCP management active and preserves its Plugin Center return target", async () => {
    const interaction = userEvent.setup()
    const settingsReturnTo =
      "/capabilities?section=mcp&scope=personal&search=%E6%9C%AC%E5%9C%B0"
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/settings/mcp",
            state: { settingsReturnTo },
          },
        ]}
      >
        <SettingsShell />
      </MemoryRouter>
    )

    const navigation = screen.getByRole("navigation", { name: "个人" })
    const mcpLink = within(navigation).getByRole("link", { name: "MCP" })

    expect(mcpLink).toHaveAttribute("href", "/settings/mcp")
    expect(mcpLink).toHaveClass("settings-navigation-link-active")
    expect(mcpLink.querySelector("svg")).toBeVisible()
    expect(
      mcpLink.querySelector('img[data-default-capability-icon="mcp"]')
    ).toBeNull()
    expect(
      within(navigation).getByRole("link", { name: "插件凭据" })
    ).toHaveAttribute("href", "/settings/credentials")
    expect(
      within(navigation).getByRole("link", { name: "消息渠道" })
    ).toHaveAttribute("href", "/settings/weixin")
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", settingsReturnTo)

    await interaction.click(
      within(navigation).getByRole("link", { name: "常规" })
    )
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", settingsReturnTo)
  })

  it("preserves the open task return target while navigating settings sections", async () => {
    const interaction = userEvent.setup()
    const settingsReturnTo = "/conversations/c1"
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/settings/general",
            state: { settingsReturnTo },
          },
        ]}
      >
        <SettingsShell />
      </MemoryRouter>
    )

    const navigation = screen.getByRole("navigation", { name: "个人" })

    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", settingsReturnTo)

    await interaction.click(
      within(navigation).getByRole("link", { name: "个人资料" })
    )
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", settingsReturnTo)
  })

  it("merges user groups and users into one active navigation item", () => {
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <SettingsShell />
      </MemoryRouter>
    )

    const navigation = screen.getByRole("navigation", { name: "管理" })
    const mergedLink = within(navigation).getByRole("link", {
      name: "用户与用户组",
    })

    expect(mergedLink).toHaveAttribute("href", "/admin/users")
    expect(mergedLink).toHaveClass("settings-navigation-link-active")
    expect(
      within(navigation).queryByRole("link", { name: "用户组" })
    ).not.toBeInTheDocument()
    expect(
      within(navigation).queryByRole("link", { name: "用户" })
    ).not.toBeInTheDocument()
  })

  describe("mobile navigation", () => {
    function renderSettingsPages() {
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/settings/general",
              state: { settingsReturnTo: "/conversations/c1" },
            },
          ]}
        >
          <Routes>
            <Route element={<SettingsShell />}>
              <Route
                path="/settings/general"
                element={<h1>General page content</h1>}
              />
              <Route
                path="/settings/profile"
                element={<h1>Profile page content</h1>}
              />
            </Route>
          </Routes>
        </MemoryRouter>
      )
    }

    it("opens a left drawer outside the page layout and closes after changing sections", async () => {
      const interaction = userEvent.setup()
      renderSettingsPages()
      const main = screen.getByRole("main")
      const trigger = screen.getByRole("button", { name: "设置导航" })
      const sidebar = screen.getByRole("complementary", {
        name: "LinkSense 设置导航",
      })

      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(
        sidebar.querySelector(".settings-navigation-body")?.parentElement
      ).toHaveClass("hidden", "md:block")

      await interaction.click(trigger)

      const drawer = await screen.findByRole("dialog", {
        name: "LinkSense 设置导航",
      })
      expect(drawer).toHaveAttribute("data-side", "left")
      expect(drawer.closest(".settings-shell")).toBeNull()
      expect(drawer.closest(".settings-sidebar")).toBeNull()
      expect(trigger).toHaveAttribute("aria-controls", drawer.id)
      expect(trigger).toHaveAttribute("aria-expanded", "true")
      expect(main).toContainElement(screen.getByText("General page content"))
      expect(
        within(drawer).getByRole("textbox", { name: "搜索设置" })
      ).toBeVisible()
      expect(
        within(drawer).getByRole("link", { name: "常规" })
      ).toHaveAttribute("aria-current", "page")
      expect(
        within(drawer).getByRole("link", { name: "返回 LinkSense" })
      ).toHaveAttribute("href", "/conversations/c1")

      await interaction.click(
        within(drawer).getByRole("link", { name: "个人资料" })
      )

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      expect(main).toContainElement(
        screen.getByRole("heading", { name: "Profile page content" })
      )

      await interaction.click(trigger)
      const reopenedDrawer = await screen.findByRole("dialog")
      expect(
        within(reopenedDrawer).getByRole("link", { name: "个人资料" })
      ).toHaveAttribute("aria-current", "page")
      expect(
        within(reopenedDrawer).getByRole("link", { name: "返回 LinkSense" })
      ).toHaveAttribute("href", "/conversations/c1")
    })

    it("filters drawer links and shows an empty state without changing the page", async () => {
      const interaction = userEvent.setup()
      renderSettingsPages()
      await interaction.click(screen.getByRole("button", { name: "设置导航" }))
      const drawer = await screen.findByRole("dialog")
      const search = within(drawer).getByRole("textbox", { name: "搜索设置" })

      await interaction.type(search, "个人资料")
      expect(
        within(drawer).getByRole("link", { name: "个人资料" })
      ).toBeVisible()
      expect(
        within(drawer).queryByRole("link", { name: "常规" })
      ).not.toBeInTheDocument()
      expect(
        within(drawer).queryByRole("navigation", { name: "管理" })
      ).not.toBeInTheDocument()

      await interaction.clear(search)
      await interaction.type(search, "no-matching-setting")
      expect(
        within(drawer).getByText(i18n.t("settings.noResults"))
      ).toBeVisible()
      expect(within(drawer).queryByRole("navigation")).not.toBeInTheDocument()
      expect(screen.getByText("General page content")).toBeInTheDocument()

      await interaction.clear(search)
      expect(
        within(drawer).getByRole("navigation", { name: "个人" })
      ).toBeVisible()
      expect(
        within(drawer).getByRole("navigation", { name: "管理" })
      ).toBeVisible()
    })

    it.each(["escape", "close button", "backdrop"])(
      "closes with %s and restores focus to the menu trigger",
      async (dismissal) => {
        const interaction = userEvent.setup()
        renderSettingsPages()
        const trigger = screen.getByRole("button", { name: "设置导航" })
        await interaction.click(trigger)
        const drawer = await screen.findByRole("dialog")

        if (dismissal === "escape") {
          await interaction.keyboard("{Escape}")
        } else if (dismissal === "close button") {
          await interaction.click(
            within(drawer).getByRole("button", { name: "关闭" })
          )
        } else {
          // JSDOM does not read preventScroll when focusing an element.
          const nativeFocus = HTMLElement.prototype.focus
          vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
            this: HTMLElement,
            options
          ) {
            void options?.preventScroll
            nativeFocus.call(this, options)
          })
          const backdrop = document.querySelector('[data-slot="sheet-overlay"]')
          expect(backdrop).toBeInTheDocument()
          if (!backdrop)
            throw new Error("The navigation drawer backdrop is missing")
          await interaction.click(backdrop)
        }

        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
        expect(trigger).toHaveAttribute("aria-expanded", "false")
        await waitFor(() => expect(trigger).toHaveFocus())
      }
    )

    it("dismisses the drawer when the viewport changes to desktop", async () => {
      type ViewportListener =
        | EventListenerOrEventListenerObject
        | ((event: MediaQueryListEvent) => void)
      const viewportListeners = new Set<ViewportListener>()
      let desktopMatches = false
      vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
        matches: query === desktopViewportQuery && desktopMatches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(
          (_type: string, listener: ViewportListener | null) => {
            if (query === desktopViewportQuery && listener)
              viewportListeners.add(listener)
          }
        ),
        removeEventListener: vi.fn(
          (_type: string, listener: ViewportListener | null) => {
            if (query === desktopViewportQuery && listener)
              viewportListeners.delete(listener)
          }
        ),
        dispatchEvent: vi.fn(),
      }))
      const interaction = userEvent.setup()
      renderSettingsPages()
      const trigger = screen.getByRole("button", { name: "设置导航" })
      await interaction.click(trigger)
      expect(await screen.findByRole("dialog")).toBeVisible()
      expect(window.matchMedia).toHaveBeenCalledWith(desktopViewportQuery)

      act(() => {
        desktopMatches = true
        const event = Object.assign(new Event("change"), {
          matches: true,
          media: desktopViewportQuery,
        })
        for (const listener of viewportListeners) {
          if (typeof listener === "function") listener(event)
          else listener.handleEvent(event)
        }
      })

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(trigger).toHaveAttribute("aria-expanded", "false")
      await waitFor(() => expect(screen.getByRole("main")).toHaveFocus())
      expect(viewportListeners.size).toBe(0)
    })

    it.each(supportedLanguages)(
      "localizes the drawer controls in %s",
      async (locale) => {
        await i18n.changeLanguage(locale)
        const interaction = userEvent.setup()
        renderSettingsPages()
        await interaction.click(
          screen.getByRole("button", { name: i18n.t("settings.navigation") })
        )
        const drawer = await screen.findByRole("dialog", {
          name: i18n.t("settings.navigationLabel", {
            productName: "LinkSense",
          }),
        })
        expect(
          within(drawer).getByRole("textbox", {
            name: i18n.t("settings.search"),
          })
        ).toBeVisible()
        expect(
          within(drawer).getByRole("button", { name: i18n.t("common.close") })
        ).toBeVisible()
      }
    )
  })
})
