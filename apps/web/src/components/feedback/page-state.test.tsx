import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import { EmptyState, LoadingState } from "@/components/feedback/page-state"

afterEach(cleanup)

describe("LoadingState", () => {
  it("centers full-page shimmer feedback across the viewport height", () => {
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
    expect(screen.getByText("正在加载")).toHaveClass("shimmer")
    expect(status.querySelector("svg")).not.toBeInTheDocument()
    expect(status.querySelector(".animate-spin")).not.toBeInTheDocument()
    expect(status.textContent).not.toContain("…")
    expect(status.textContent).not.toContain("...")
    expect(container.querySelector(".page-state-loading")).toBe(status)
  })

  it("keeps embedded loading feedback at its local content height", () => {
    render(<LoadingState label="正在加载" />)

    const status = screen.getByRole("status")
    expect(status).toHaveClass("page-state-loading")
    expect(status).not.toHaveClass("page-state-loading-fullscreen", "fixed")
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
