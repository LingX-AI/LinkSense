// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function cssRule(selector: string) {
  const matches = Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`, "gu")
    )
  )

  return matches[matches.length - 1]?.[1]
}

describe("form field layout", () => {
  it("keeps controls top-aligned when a multi-column row has taller help text", () => {
    expect(cssRule("\\.form-field")).toContain("align-content: start;")
  })
})
