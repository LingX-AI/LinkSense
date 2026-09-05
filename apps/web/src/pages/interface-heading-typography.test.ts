// @vitest-environment node

import appStyles from "@/index.css?raw"
import capabilityPageSource from "@/pages/capability-pages.tsx?raw"
import { describe, expect, it } from "vitest"

function cssRules(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, "gu")
    )
  ).map((match) => match[1])
}

describe("application heading typography", () => {
  it.each([
    ".conversation-welcome h2",
    ".management-header h1",
    ".capability-library-header h1",
    ".settings-page-header h1",
    ".public-panel header h1",
    ".knowledge-library-header h1",
  ])("matches the settings page title tier for %s", (selector) => {
    const rules = cssRules(selector)

    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain("font-size: var(--app-font-16);")
    expect(rules[0]).toContain("font-weight: 600;")
    expect(rules[0]).toContain("line-height: var(--app-line-24);")
  })

  it("uses the configured appearance font size for preview file names", () => {
    const rules = cssRules(".knowledge-preview-header h1")

    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain("font-size: var(--app-ui-font-size);")
    expect(rules[0]).toContain("font-weight: 600;")
    expect(rules[0]).toContain(
      "line-height: var(--app-ui-compact-line-height);"
    )
  })

  it("does not retain the removed marketplace explanation heading", () => {
    expect(cssRules(".management-section-heading h2")).toHaveLength(0)
    expect(cssRules(".management-section-heading p")).toHaveLength(0)
    expect(capabilityPageSource).not.toContain("management-section-heading")
    expect(capabilityPageSource).not.toContain(
      'className="font-heading text-lg font-medium"'
    )
  })

  it("keeps other application section headings on the compact tier", () => {
    expect(appStyles).toMatch(
      /\.capability-library-section-header h2,\s*\.capability-library-section-title\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*font-weight:\s*600;[^}]*line-height:\s*var\(--app-line-20\);/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-section-heading h2,\s*\.knowledge-upload-queue-header h3,\s*\.knowledge-grants-header h3\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*font-weight:\s*600;[^}]*line-height:\s*var\(--app-line-20\);/u
    )
  })
})
