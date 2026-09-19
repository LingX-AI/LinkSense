import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/feedback/page-state"
import i18n from "@/i18n"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  document.documentElement.classList.remove("dark")
  delete document.documentElement.dataset.theme
})

afterEach(async () => {
  cleanup()
  document.documentElement.classList.remove("dark")
  delete document.documentElement.dataset.theme
  await i18n.changeLanguage("zh-CN")
})

describe("LoadingState", () => {
  it("centers the product logo across the viewport and keeps the loading label accessible", () => {
    const { container } = render(<LoadingState label="正在加载" fullScreen />)

    const status = screen.getByRole("status")
    expect(status).toHaveClass(
      "page-state",
      "page-state-loading",
      "page-state-loading-fullscreen",
      "fixed",
      "inset-0"
    )
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveAttribute("aria-live", "polite")
    const logo = screen.getByRole("img", { name: "LinkSense" })
    expect(logo).toBeVisible()
    expect(logo).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-primary.svg")
    )
    expect(logo).toHaveClass("h-6", "sm:h-7", "motion-safe:animate-pulse")
    expect(screen.getByText("正在加载")).toHaveClass("sr-only")
    expect(status.querySelector(".shimmer")).not.toBeInTheDocument()
    expect(status.querySelector("svg")).not.toBeInTheDocument()
    expect(status.querySelector(".animate-spin")).not.toBeInTheDocument()
    expect(status.textContent).not.toContain("…")
    expect(status.textContent).not.toContain("...")
    expect(container.querySelector(".page-state-loading")).toBe(status)
  })

  it("uses the dark-theme product logo for full-screen loading", () => {
    document.documentElement.dataset.theme = "dark"
    document.documentElement.classList.add("dark")

    render(<LoadingState fullScreen />)

    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-on-dark.svg")
    )
  })

  it.each([
    ["zh-CN", "正在加载…"],
    ["en-US", "Loading…"],
    ["fr-FR", "正在加载…"],
  ])(
    "keeps the full-screen loading announcement localized for %s",
    async (language, expected) => {
      await i18n.changeLanguage(language)

      render(<LoadingState fullScreen />)

      expect(screen.getByRole("status")).toHaveTextContent(expected)
      expect(screen.getByText(expected)).toHaveClass("sr-only")
      expect(screen.getByRole("img", { name: "LinkSense" })).toBeVisible()
    }
  )

  it("can fill the content area while preserving embedded loading feedback", () => {
    const { rerender } = render(<LoadingState label="正在加载" />)

    const status = screen.getByRole("status")
    expect(status).toHaveClass("page-state-loading")
    expect(status).not.toHaveClass("size-full")
    expect(status).not.toHaveClass("page-state-loading-fullscreen", "fixed")
    expect(screen.getByText("正在加载")).toHaveClass("shimmer")
    expect(screen.getByText("正在加载")).not.toHaveClass("sr-only")
    expect(screen.queryByRole("img")).not.toBeInTheDocument()

    rerender(<LoadingState label="正在加载" fill />)

    expect(screen.getByRole("status")).toBe(status)
    expect(status).toHaveClass("size-full")
    expect(status).not.toHaveClass("page-state-loading-fullscreen", "fixed")
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(screen.getByText("正在加载")).toBeVisible()
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
})

describe("EmptyState", () => {
  it("uses the shared empty-state structure and typography", () => {
    render(
      <EmptyState
        title="暂无自动化"
        description="创建后会显示在这里。"
        action={<Button type="button">新建自动化</Button>}
      />
    )

    const empty = screen.getByText("暂无自动化").closest("[data-slot='empty']")

    expect(empty).toHaveClass("empty-state", "min-h-24", "text-center")
    expect(screen.getByText("暂无自动化")).toHaveClass(
      "text-[length:var(--app-font-13)]",
      "font-normal",
      "text-muted-foreground"
    )
    expect(screen.getByText("创建后会显示在这里。")).toHaveClass(
      "text-[length:var(--app-font-12)]",
      "text-muted-foreground"
    )
    expect(screen.getByRole("button", { name: "新建自动化" })).toBeVisible()
  })

  it.each([
    ["中文句号", "暂无数据。", "暂无数据"],
    ["英文句号", "No data.", "No data"],
  ])("removes the trailing %s from the title", (_name, title, expected) => {
    render(<EmptyState title={title} />)

    expect(screen.getByText(expected)).toBeVisible()
    expect(screen.queryByText(title)).not.toBeInTheDocument()
  })
})
