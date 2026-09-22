import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PageLayout } from "./page-layout"

describe("PageLayout content width", () => {
  it("defaults to personal settings width and changes width with the selected page", () => {
    const { rerender } = render(<PageLayout title="Settings">Form</PageLayout>)
    const page = screen.getByRole("banner").parentElement
    expect(page).toHaveAttribute("data-content-width", "standard")

    rerender(
      <PageLayout title="Table" contentWidth="wide">
        Loading
      </PageLayout>
    )
    expect(page).toHaveAttribute("data-content-width", "wide")

    rerender(
      <PageLayout title="Form" contentWidth="standard">
        Form
      </PageLayout>
    )
    expect(page).toHaveAttribute("data-content-width", "standard")
  })
})
