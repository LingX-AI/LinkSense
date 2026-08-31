import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("knowledge share dialog layout", () => {
  it("styles share target type as a compact segmented control", () => {
    expect(appStyles).toMatch(
      /:is\(\.knowledge-share-type-options, \.share-target-type-options\)\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*100%;/u
    )
    expect(appStyles).toMatch(
      /:is\(\.knowledge-share-type-options, \.share-target-type-options\)\s+\[data-slot="tabs-trigger"\]\s*\{[^}]*min-width:\s*88px;/u
    )
    expect(appStyles).not.toContain(
      '.knowledge-share-type-options [data-slot="toggle-group-item"]'
    )
    expect(appStyles).not.toMatch(/\.knowledge-share-type-options\s*>\s*label/u)
  })
})
