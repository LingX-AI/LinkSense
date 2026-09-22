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
  it("keeps the login support links in one row at the page bottom right", () => {
    const desktopRule = cssRules(".login-page-links")[0]

    expect(desktopRule).toContain("position: fixed;")
    expect(desktopRule).toContain("right:")
    expect(desktopRule).toContain("bottom:")
    expect(desktopRule).toContain("display: flex;")
    expect(desktopRule).toContain("white-space: nowrap;")
  })
})
