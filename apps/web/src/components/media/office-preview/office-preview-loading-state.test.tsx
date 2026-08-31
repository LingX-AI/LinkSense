import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import appStyles from "@/index.css?raw"

function cssRule(selector: string) {
  return appStyles.match(
    new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`, "u")
  )?.[1]
}

describe("OfficePreviewLoadingState", () => {
  afterEach(() => cleanup())

  it.each(["正在加载文档", "Loading document"])(
    "renders %s with the shadcn shimmer utility and no loading icon",
    (label) => {
      render(<OfficePreviewLoadingState label={label} />)

      const status = screen.getByRole("status")
      expect(status).toHaveAttribute("aria-busy", "true")
      expect(status).toHaveAttribute("aria-live", "polite")
      expect(screen.getByText(label)).toHaveClass("shimmer")
      expect(status.querySelector("svg")).not.toBeInTheDocument()
      expect(status.querySelector(".animate-spin")).not.toBeInTheDocument()
    }
  )

  it("uses the configured UI type scale and medium weight", () => {
    const rule = cssRule("\\.office-preview-state")

    expect(rule).toContain("font-size: var(--app-ui-font-size);")
    expect(rule).toContain("font-weight: 500;")
    expect(rule).toContain("align-items: center;")
    expect(rule).toContain("justify-content: center;")
  })
})
