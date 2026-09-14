import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { SettingsShell } from "@/components/shell/settings-shell"
import i18n from "@/i18n"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({
    user: { role: "admin", status: "active" },
  }),
}))

vi.mock("@/features/admin/system-update", () => ({
  SystemUpdateNotice: () => null,
}))

describe("SettingsShell administrator navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it.each([
    "/settings/general",
    "/settings/profile",
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
  ])("widens only administration content at %s", (path) => {
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
    const content = screen
      .getByTestId("settings-page-content")
      .closest(".settings-content")
    expect(content).toHaveClass("settings-content")
    expect(content?.classList.contains("settings-content-administration")).toBe(
      path.startsWith("/admin/")
    )
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

  it("restores personal width when navigating out of administration", async () => {
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

  it("exposes personal MCP and preserves its Plugin Center return target", async () => {
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
})
