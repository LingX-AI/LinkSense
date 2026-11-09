import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import "@/i18n"
import appStyles from "@/index.css?raw"

describe("shared shell attribution layout", () => {
  afterEach(cleanup)

  it.each([
    "management-page",
    "settings-page",
    "settings-content-administration",
    "knowledge-library-page",
    "knowledge-preview-page",
    "office-preview-pane",
  ])("keeps only the attribution in the corner beside %s", (pageClass) => {
    render(
      <div className="shell-content relative flex min-h-0 flex-col">
        <main className="min-h-0 flex-1">
          <div className={pageClass} />
        </main>
        <PoweredByLinkSense />
      </div>
    )

    const footer = screen.getByRole("contentinfo")
    expect(footer).toHaveClass(
      "absolute",
      "w-max",
      "bg-transparent",
      "p-0",
      "pointer-events-none"
    )
    expect(footer).not.toHaveClass("fixed", "w-full")
    expect(footer.querySelector("a")).toHaveClass("pointer-events-auto")
    expect(screen.getByRole("main")).not.toContainElement(footer)
    expect(appStyles).not.toMatch(/>\s*\.shell-attribution\s*\{/u)
  })
})
