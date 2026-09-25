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
})
