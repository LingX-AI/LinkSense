// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function declarationsFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  return Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, "gu")
    )
  ).map((match) => match[1])
}

function declarationFor(selector: string) {
  return declarationsFor(selector).at(-1) ?? ""
}

describe("global scrollbar theme", () => {
  it("defines one reusable scrollbar palette and geometry", () => {
    const root = declarationsFor(":root")[0] ?? ""

    expect(root).toContain("--app-scrollbar-size: 7px;")
    expect(root).toContain("--app-scrollbar-radius: 999px;")
    expect(root).toContain("--app-scrollbar-track: transparent;")
    expect(root).toContain("--app-scrollbar-thumb:")
    expect(root).toContain("--app-scrollbar-thumb-hover:")
  })

  it("applies the shared theme to Firefox and WebKit scrollbars", () => {
    expect(declarationFor("*")).toContain(
      "scrollbar-color: var(--app-scrollbar-thumb) var(--app-scrollbar-track);"
    )
    expect(declarationFor("*")).toContain("scrollbar-width: thin;")
    expect(declarationFor("*::-webkit-scrollbar")).toContain(
      "width: var(--app-scrollbar-size);"
    )
    expect(declarationFor("*::-webkit-scrollbar")).toContain(
      "height: var(--app-scrollbar-size);"
    )
    expect(declarationFor("*::-webkit-scrollbar-thumb")).toContain(
      "border-radius: var(--app-scrollbar-radius);"
    )
    expect(declarationFor("*::-webkit-scrollbar-thumb")).toContain(
      "background: var(--app-scrollbar-thumb);"
    )
    expect(declarationFor("*::-webkit-scrollbar-thumb:hover")).toContain(
      "background: var(--app-scrollbar-thumb-hover);"
    )
  })

  it("does not retain component-specific visible scrollbar colors", () => {
    expect(appStyles.match(/scrollbar-color:/gu)).toHaveLength(1)
    expect(appStyles.match(/scrollbar-width:\s*thin;/gu)).toHaveLength(1)
  })
})
