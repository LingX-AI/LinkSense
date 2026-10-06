import { screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  installApiMock,
  renderApp,
  setupApplicationTests,
} from "@/test/application/fixture"

const sections = [
  { path: "/automations", label: "自动化" },
  { path: "/capabilities", label: "插件中心" },
  { path: "/knowledge-bases", label: "资料库" },
]

describe("application attribution footer", () => {
  setupApplicationTests()

  it.each(sections)(
    "reserves a bottom footer outside the scrolling content at $path",
    async ({ path, label }) => {
      installApiMock()
      renderApp(path)

      const main = await screen.findByRole("main")
      const footer = screen.getByRole("contentinfo")
      const attribution = screen.getByRole("link", {
        name: "由 LinkSense 提供支持",
      })
      const sidebar = screen.getByRole("complementary", {
        name: "LinkSense 导航",
      })

      expect(
        within(sidebar).getByRole("link", { name: label })
      ).toHaveAttribute("aria-current", "page")
      expect(main).toHaveClass("min-h-0", "flex-1")
      expect(main.parentElement).toHaveClass("flex", "min-h-0", "flex-col")
      expect(main.nextElementSibling).toBe(footer)
      expect(main).not.toContainElement(attribution)
      expect(footer).toContainElement(attribution)
      expect(footer).toHaveClass(
        "h-12",
        "shrink-0",
        "justify-center",
        "md:h-16",
        "md:justify-end"
      )
      expect(attribution).not.toHaveClass("fixed")
    }
  )

  it.each(["/conversations/new", "/conversations/c1"])(
    "uses workspace-relative attribution without reserving a shell footer at %s",
    async (path) => {
      installApiMock()
      renderApp(path)

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      const attribution = screen.getByRole("link", {
        name: "由 LinkSense 提供支持",
      })
      const bottomStack = input.closest(".conversation-bottom-stack")

      expect(bottomStack).not.toBeNull()
      expect(attribution.parentElement).toBe(bottomStack)
      expect(attribution).toHaveClass(
        "hidden",
        "md:inline-flex",
        "@min-[76rem]/conversation-workspace:absolute"
      )
      expect(attribution).not.toHaveClass("absolute", "fixed")
      expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument()
    }
  )

  it("keeps the footer when navigating between sections and removes it for chat", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/capabilities")
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const footer = screen.getByRole("contentinfo")

    for (const { label } of sections) {
      await interaction.click(
        within(sidebar).getByRole("link", { name: label })
      )
      expect(screen.getByRole("contentinfo")).toBe(footer)
      expect(screen.getByRole("main").nextElementSibling).toBe(footer)
    }

    await interaction.click(
      within(sidebar).getByRole("link", { name: "新任务" })
    )
    expect(
      await screen.findByRole("textbox", { name: "任务输入框" })
    ).toBeVisible()
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("main")).getByRole("link", {
        name: "由 LinkSense 提供支持",
      })
    ).toHaveClass("hidden", "md:inline-flex")
  })
})
