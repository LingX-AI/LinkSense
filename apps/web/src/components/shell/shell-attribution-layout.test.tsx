import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { PoweredByLinkSense } from "@/components/brand/powered-by-linksense"
import "@/i18n"
import appStyles from "@/index.css?raw"

// JSDOM does not lay out container queries. Exercise their actual selectors and
// width conditions against representative content, including open preview panes.
const cornerRules = Array.from(
  appStyles.matchAll(
    /@container shell-content \(min-width:\s*(\d+)rem\)\s*\{\s*([^{}]+)\{([^{}]+)\}\s*\}/gu
  ),
  (match) => ({
    minWidth: Number(match[1]) * 16,
    selector: match[2].trim(),
    declarations: match[3],
  })
)

describe("shared shell attribution layout", () => {
  afterEach(cleanup)

  it.each([
    {
      pageClass: "management-page",
      contentWidth: "standard",
      width: 390,
      corner: false,
    },
    {
      pageClass: "management-page",
      contentWidth: "standard",
      width: 1200,
      corner: false,
    },
    {
      pageClass: "management-page",
      contentWidth: "standard",
      width: 1250,
      corner: false,
    },
    {
      pageClass: "management-page",
      contentWidth: "standard",
      width: 1264,
      corner: true,
    },
    { pageClass: "settings-page", width: 1264, corner: true },
    { pageClass: "knowledge-library-page", width: 1440, corner: false },
    { pageClass: "knowledge-library-page", width: 1472, corner: true },
    { pageClass: "knowledge-preview-page", width: 1440, corner: false },
    { pageClass: "knowledge-preview-page", width: 1472, corner: true },
    {
      pageClass: "management-page",
      contentWidth: "wide",
      width: 1480,
      corner: false,
    },
    {
      pageClass: "management-page",
      contentWidth: "wide",
      width: 1504,
      corner: true,
    },
    {
      pageClass: "management-page",
      contentWidth: "wide",
      width: 1552,
      corner: true,
    },
  ])(
    "uses the gutter=$corner for $pageClass ($contentWidth) at content width $width",
    ({ pageClass, contentWidth, width, corner }) => {
      render(
        <div className="shell-content">
          <main>
            <div className={pageClass} data-content-width={contentWidth} />
          </main>
          <PoweredByLinkSense />
        </div>
      )
      const footer = screen.getByRole("contentinfo")

      expect(cornerRules).toHaveLength(3)
      expect(
        cornerRules.some(
          (rule) => width >= rule.minWidth && footer.matches(rule.selector)
        )
      ).toBe(corner)
    }
  )

  it.each([390, 1344, 1552, 1632, 2400])(
    "keeps the footer in flow when a full-height preview is open at content width %s",
    (width) => {
      render(
        <div className="shell-content">
          <main>
            <div className="knowledge-library-page" />
            <aside className="office-preview-pane" />
          </main>
          <PoweredByLinkSense />
        </div>
      )
      const footer = screen.getByRole("contentinfo")

      expect(cornerRules).toHaveLength(3)
      expect(
        cornerRules.some(
          (rule) => width >= rule.minWidth && footer.matches(rule.selector)
        )
      ).toBe(false)
      expect(footer).toHaveClass("pb-[var(--attribution-inset)]", "shrink-0")
    }
  )

  it("releases the footer row only inside the content gutter, without pinning to the viewport", () => {
    expect(cornerRules).toHaveLength(3)
    for (const { declarations } of cornerRules) {
      expect(declarations).toMatch(/position:\s*absolute;/u)
      expect(declarations).toMatch(/padding:\s*0;/u)
      expect(declarations).not.toMatch(/position:\s*fixed;/u)
      expect(declarations).not.toMatch(/(?:right|bottom|height):/u)
    }
  })
})
