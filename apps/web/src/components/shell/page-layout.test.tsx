import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PageLayout } from "./page-layout"

describe("PageLayout shared sizing", () => {
  it("keeps the same shell-sized container when the page content changes", () => {
    const { rerender } = render(<PageLayout title="Settings">Form</PageLayout>)
    const page = screen.getByRole("banner").parentElement
    expect(page).toHaveClass("management-page")
    expect(page).not.toHaveAttribute("data-content-width")
    expect(page?.parentElement).toHaveClass("scrollbar-gutter-stable")

    rerender(<PageLayout title="Table">Loading</PageLayout>)
    expect(screen.getByRole("banner").parentElement).toBe(page)
    expect(page).toHaveTextContent("Loading")

    rerender(<PageLayout title="Form">Form</PageLayout>)
    expect(screen.getByRole("banner").parentElement).toBe(page)
    expect(page).not.toHaveAttribute("data-content-width")
  })
})
