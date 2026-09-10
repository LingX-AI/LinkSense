import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  installApiMock,
  renderApp,
  setupApplicationTests,
} from "@/test/application/fixture"

describe("settings page layout", () => {
  setupApplicationTests()
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
