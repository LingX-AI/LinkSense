// @vitest-environment node

import { describe, expect, it } from "vitest"

import appStyles from "@/index.css?raw"

function cssRules(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "gu")
    )
  ).map((match) => match[1])
}

describe("authentication page layout", () => {
  it("keeps authentication content scrollable without a fixed login-link footer", () => {
    expect(cssRules(".public-shell")[0]).toContain("overflow-y: auto;")
    expect(cssRules(".login-page-links")).toHaveLength(0)
  })

  it("lets the shared attribution own its bottom inset in desktop and mobile shells", () => {
    const shellRules = cssRules(".public-shell")
    expect(shellRules).toHaveLength(2)
    for (const rule of shellRules) {
      expect(rule).toContain("--public-shell-horizontal-padding:")
      expect(rule).toMatch(
        /padding:[^;]*var\(--app-safe-area-bottom\)\s*calc\(var\(--public-shell-horizontal-padding\) \+ var\(--app-safe-area-left\)\);/u
      )
      expect(rule).not.toMatch(/calc\(32px \+ var\(--app-safe-area-bottom\)\)/u)
    }
  })
})
