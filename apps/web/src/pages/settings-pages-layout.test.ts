import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import {
  installApiMock,
  renderApp,
  setupApplicationTests,
} from "@/test/application/fixture"

describe("settings page layout", () => {
  setupApplicationTests()
  it("places the change-password button at the bottom right of its form", async () => {
    installApiMock()
    renderApp("/settings/security")
    const button = await screen.findByRole("button", { name: "修改密码" })
    const actions = button.parentElement
    expect(actions).toHaveClass("flex", "justify-end")
    expect(button.closest("form")?.lastElementChild).toBe(actions)
    expect(button).toHaveAttribute("type", "submit")
    expect(button).toBeDisabled()
  })

  it("groups interface preferences in a card and keeps notifications in a separate section", async () => {
    installApiMock()
    renderApp("/settings/general")
    const language = await screen.findByRole("combobox", { name: "界面语言" })
    const card = language.closest('[data-slot="card"]')
    expect(card).toHaveClass("rounded-card", "border", "py-4", "sm:py-5")
    expect(card).toContainElement(
      screen.getByRole("combobox", { name: "执行中发送新消息" })
    )
    const notifications = screen.getByRole("switch", { name: "启用浏览器通知" })
    expect(card).not.toContainElement(notifications)
    expect(
      notifications.closest('[data-slot="settings-card"]')
    ).toContainElement(screen.getByRole("heading", { name: "浏览器通知" }))
    expect(card?.querySelectorAll(".settings-panel")).toHaveLength(0)
    expect(card?.querySelectorAll('[data-slot="card"]')).toHaveLength(0)
    expect(
      Array.from(
        card?.querySelector('[data-slot="card-content"]')?.children ?? [],
        (child) =>
          child.matches("section")
            ? child.getAttribute("aria-labelledby")
            : child.getAttribute("data-slot")
      )
    ).toEqual([
      "interface-language-heading",
      "separator",
      "running-message-action-heading",
    ])
  })

  it("stacks the running-message selector in narrow containers with only option names", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/general")
    const selector = await screen.findByRole("combobox", {
      name: "执行中发送新消息",
    })
    const header = screen
      .getByRole("heading", { name: "执行中发送新消息" })
      .closest('[data-slot="settings-section-header"]')
    expect(header).toContainElement(selector)
    expect(header?.firstElementChild).toHaveClass(
      "flex-col",
      "@2xl/settings-section:flex-row",
      "@2xl/settings-section:items-center"
    )
    expect(header?.firstElementChild).not.toHaveClass("flex-row")
    expect(selector).toHaveClass("w-full", "@2xl/settings-section:w-56")
    expect(
      selector.closest('[data-slot="settings-section-action"]')
    ).not.toBeNull()
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    selector.focus()
    await interaction.keyboard("{ArrowDown}")
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent)
    ).toEqual(["引导当前执行", "排队为下一条请求"])
  })
  it("places the language selector beside its description and notifications beside their section heading", async () => {
    installApiMock()
    renderApp("/settings/general")
    const language = await screen.findByRole("combobox", { name: "界面语言" })
    const heading = screen.getByRole("heading", { name: "界面语言" })
    const header = heading.closest('[data-slot="settings-section-header"]')
    expect(header).toContainElement(language)
    expect(
      language.closest('[data-slot="settings-section-action"]')
    ).not.toBeNull()
    expect(
      language.closest('[data-slot="settings-section-title-row"]')
    ).toBeNull()
    expect(screen.queryByText("语言", { exact: true })).not.toBeInTheDocument()
    expect(language).toHaveAccessibleDescription("应用UI语言")
    const toggle = screen.getByRole("switch", { name: "启用浏览器通知" })
    expect(toggle.closest('[data-slot="settings-card"]')).toContainElement(
      screen.getByRole("heading", { name: "浏览器通知" })
    )
    expect(toggle).toHaveAccessibleDescription(/通过当前浏览器通知/u)
  })
})
