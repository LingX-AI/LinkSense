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

  it("groups General preferences in one rounded card separated by two lines", async () => {
    installApiMock()
    renderApp("/settings/general")
    const language = await screen.findByRole("combobox", { name: "界面语言" })
    const card = language.closest('[data-slot="card"]')
    expect(card).toHaveClass("rounded-card", "border", "gap-0", "py-0")
    expect(card).toContainElement(
      screen.getByRole("combobox", { name: "执行中发送新消息" })
    )
    expect(card).toContainElement(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )
    expect(card?.querySelectorAll(".settings-panel")).toHaveLength(0)
    expect(card?.querySelectorAll('[data-slot="card"]')).toHaveLength(0)
    expect(
      Array.from(card?.children ?? [], (child) =>
        child.matches("section")
          ? child.getAttribute("aria-labelledby")
          : child.getAttribute("data-slot")
      )
    ).toEqual([
      "interface-language-heading",
      "separator",
      "running-message-action-heading",
      "separator",
      "browser-notifications-heading",
    ])
  })

  it("places the running-message selector on the right with only option names", async () => {
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
    expect(header).toHaveClass("flex-row", "justify-between")
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
  it("places the language selector beside its description and the notification switch in its title row", async () => {
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
    expect(
      toggle.closest('[data-slot="settings-section-title-row"]')
    ).toContainElement(screen.getByRole("heading", { name: "浏览器通知" }))
    expect(
      toggle.closest('[data-slot="settings-section-title-action"]')
    ).not.toBeNull()
  })
})
