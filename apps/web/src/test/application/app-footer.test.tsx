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
    "shares the content width with compact attribution outside the scrolling content at $path",
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
      expect(main.parentElement).toHaveClass(
        "shell-content",
        "@container/shell-content",
        "relative",
        "flex",
        "min-h-0",
        "flex-col"
      )
      expect(main.nextElementSibling).toBe(footer)
      expect(main).not.toContainElement(attribution)
      expect(footer).toContainElement(attribution)
      expect(footer).toHaveClass(
        "shell-attribution",
        "shrink-0",
        "justify-end",
        "[--attribution-inset:18px]",
        "absolute",
        "w-max",
        "rounded-sm",
        "bg-[var(--app-canvas)]",
        "p-1",
        "pointer-events-none",
        "right-[var(--attribution-inset)]",
        "bottom-[var(--attribution-inset)]"
      )
      expect(attribution).toHaveClass("pointer-events-auto")
      expect(footer).not.toHaveClass("h-8", "h-12", "md:h-16", "fixed")
      expect(attribution).not.toHaveClass("fixed")
    }
  )

  it("omits the attribution mark from the new task entry page", async () => {
    installApiMock()
    renderApp("/conversations/new")
    await screen.findByRole("textbox", { name: "任务输入框" })
    expect(
      screen.queryByRole("link", { name: "由 LinkSense 提供支持" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument()
  })

  it.each(["/conversations/c1"])(
    "omits attribution without reserving a footer at %s",
    async (path) => {
      installApiMock()
      renderApp(path)

      const input = await screen.findByRole("textbox", { name: "任务输入框" })
      expect(input.closest(".conversation-bottom-stack")).not.toBeNull()
      expect(
        screen.queryByRole("link", { name: "由 LinkSense 提供支持" })
      ).not.toBeInTheDocument()
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
      within(screen.getByRole("main")).queryByRole("link", {
        name: "由 LinkSense 提供支持",
      })
    ).not.toBeInTheDocument()
  })

  it("keeps attribution absent when the task overview is toggled", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/conversations/c1")

    const composer = await screen.findByRole("form", { name: "任务输入框" })
    const workspace = composer.closest(".conversation-workspace")
    const expectNoAttribution = () => {
      expect(
        screen.queryByRole("link", { name: "由 LinkSense 提供支持" })
      ).not.toBeInTheDocument()
    }

    await screen.findByRole("region", { name: "任务概览" })
    expect(workspace).toHaveAttribute("data-task-overview-open", "true")
    expectNoAttribution()

    await interaction.click(
      screen.getByRole("button", { name: "关闭任务概览" })
    )
    expect(workspace).not.toHaveAttribute("data-task-overview-open")
    expectNoAttribution()

    await interaction.click(
      screen.getByRole("button", { name: "打开任务概览" })
    )
    await screen.findByRole("region", { name: "任务概览" })
    expect(workspace).toHaveAttribute("data-task-overview-open", "true")
    expectNoAttribution()
  })
})
