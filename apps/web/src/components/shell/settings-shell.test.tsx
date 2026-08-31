import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { SettingsShell } from "@/components/shell/settings-shell"
import i18n from "@/i18n"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({
    user: { role: "admin", status: "active" },
  }),
}))

describe("SettingsShell administrator navigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
  })

  it("places usage analytics at the end of the management group", () => {
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <SettingsShell />
      </MemoryRouter>
    )

    const navigation = screen.getByRole("navigation", { name: "管理" })
    const links = within(navigation).getAllByRole("link")

    expect(links.at(-1)).toHaveAttribute("href", "/admin/usage")
    expect(links.at(-1)).toHaveTextContent("用量统计")
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
