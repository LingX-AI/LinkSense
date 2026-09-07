// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function cssRules(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, "gu")
    )
  ).map((match) => match[1])
}

function lastCssRule(selector: string) {
  return cssRules(selector).at(-1)
}

function firstCssRule(selector: string) {
  return cssRules(selector)[0]
}

describe("settings center layout consistency", () => {
  it("uses one desktop page inset for personal and administration pages", () => {
    expect(firstCssRule(".settings-page")).toContain("padding: 44px 52px 72px;")
    expect(
      firstCssRule(".settings-content > .management-scroll .management-page")
    ).toContain("padding: 44px 52px 72px;")
    expect(
      firstCssRule(".settings-content-administration .management-page")
    ).toContain("padding: 44px 52px 72px;")
  })

  it("keeps personal and administration page headers on the same rhythm", () => {
    expect(firstCssRule(".settings-page-header")).toContain(
      "margin-bottom: 28px;"
    )
    expect(firstCssRule(".management-header")).toContain("margin-bottom: 28px;")
  })

  it("uses the same section-title tier across setting page variants", () => {
    for (const selector of [
      ".settings-section h2",
      ".settings-panel h2",
      ".profile-section-heading h2",
    ]) {
      const rule = lastCssRule(selector)

      expect(rule).toContain("font-size: var(--app-ui-font-size);")
      expect(rule).toContain("font-weight: 600;")
      expect(rule).toContain("line-height: var(--app-line-20);")
    }
  })

  it("uses a 16px tab-to-content gap and prevents tab panels from overflowing", () => {
    expect(
      lastCssRule(
        '.settings-shell [data-slot="tabs"][data-orientation="horizontal"]'
      )
    ).toContain("gap: 16px;")
    expect(lastCssRule('.settings-shell [data-slot="tabs-content"]')).toContain(
      "min-width: 0;"
    )
  })

  it("aligns sidebar search and navigation rows to the same control height", () => {
    expect(lastCssRule(".settings-search-field input")).toContain(
      "height: 32px;"
    )
    expect(lastCssRule(".settings-navigation-link")).toContain(
      "min-height: 32px;"
    )
  })
})
