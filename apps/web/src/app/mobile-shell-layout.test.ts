// @vitest-environment node

import appDocument from "../../index.html?raw"
import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("mobile shell layout", () => {
  it("opts into viewport safe areas and applies them to top-level shells", () => {
    expect(appDocument).toContain("viewport-fit=cover")
    expect(appStyles).toContain(
      "--app-safe-area-top: env(safe-area-inset-top, 0px)"
    )
    expect(appStyles).toContain(
      "padding: var(--app-safe-area-top) var(--app-safe-area-right)"
    )
    expect(appStyles).toContain(
      "var(--app-safe-area-bottom) var(--app-safe-area-left)"
    )
  })

  it("provides browser chrome colors for both application themes", () => {
    expect(appDocument).toContain('name="theme-color" content="#ffffff"')
  })

  it("skips offscreen sidebar item layout without changing list semantics", () => {
    expect(appStyles).toContain(".sidebar-conversation-item")
    expect(appStyles).toContain("content-visibility: auto")
    expect(appStyles).toContain("contain-intrinsic-size: auto 32px")
  })
})
