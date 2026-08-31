import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { LoadingState } from "@/components/feedback/page-state"

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
      "inset-0",
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
    expect(status).not.toHaveClass(
      "page-state-loading-fullscreen",
      "fixed"
    )
  })
})
