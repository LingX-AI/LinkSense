// @vitest-environment node

import archivePreviewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function declarationFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = archivePreviewStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u")
  )

  return match?.groups?.body ?? ""
}

describe("archive preview layout", () => {
  it("renders the archive search field without a border", () => {
    expect(declarationFor(".archive-preview-search")).toMatch(/border:\s*0;/u)
  })

  it("uses compact text and icon sizing in the archive toolbar actions", () => {
    for (const selector of [
      ".archive-preview-summary",
      '.archive-preview-search [data-slot="input-group-control"]',
    ]) {
      const rule = declarationFor(selector)
      expect(rule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
      expect(rule).toMatch(/line-height:\s*var\(--app-line-18\);/u)
    }

    const searchIconRule = declarationFor(
      '.archive-preview-search [data-slot="input-group-addon"] svg'
    )
    expect(searchIconRule).toMatch(/width:\s*var\(--app-font-13\);/u)
    expect(searchIconRule).toMatch(/height:\s*var\(--app-font-13\);/u)
  })

  it("uses the configured UI font size across archive navigation and file details", () => {
    const uiTextSelectors = [
      ".archive-preview-breadcrumb-button",
      ".archive-preview-safety-note",
      ".archive-preview-tree-button",
      ".archive-preview-table",
      '.archive-preview-table [data-slot="table-head"]',
      ".archive-preview-item-type",
      ".archive-preview-encrypted-badge",
      ".archive-preview-empty-state",
      ".archive-preview-entry-back-button",
      ".archive-preview-entry-file",
      ".archive-preview-entry-read-only",
    ]

    for (const selector of uiTextSelectors) {
      const rule = declarationFor(selector)
      expect(rule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
      expect(rule).toMatch(
        /line-height:\s*var\(--app-ui-compact-line-height\);/u
      )
    }

    const itemNameRule = archivePreviewStyles.match(
      /\.archive-preview-item-name,\s*\.archive-preview-item-button\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body

    expect(itemNameRule).toMatch(
      /font-size:\s*var\(--app-ui-font-size\);/u
    )
    expect(itemNameRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
  })

  it("scales archive controls and rows with the UI font setting", () => {
    expect(declarationFor(".archive-preview-toolbar")).toMatch(
      /min-height:\s*calc\(var\(--app-ui-compact-line-height\) \+ 24px\);/u
    )
    expect(declarationFor(".archive-preview-entry-toolbar")).toMatch(
      /min-height:\s*calc\(var\(--app-ui-compact-line-height\) \+ 24px\);/u
    )
    expect(
      declarationFor(".archive-preview-table [data-slot=\"table-head\"]")
    ).toMatch(
      /height:\s*calc\(var\(--app-ui-compact-line-height\) \+ 14px\);/u
    )
    expect(
      declarationFor(".archive-preview-table [data-slot=\"table-cell\"]")
    ).toMatch(
      /height:\s*calc\(var\(--app-ui-compact-line-height\) \+ 20px\);/u
    )
    expect(declarationFor(".archive-preview-breadcrumb-separator")).toMatch(
      /width:\s*var\(--app-ui-font-size\);/u
    )
    expect(declarationFor(".archive-preview-encrypted-badge")).toMatch(
      /height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(declarationFor(".archive-preview-entry-file > .file-type-icon")).toMatch(
      /width:\s*var\(--app-ui-font-size\);/u
    )
  })

  it("places the code wrapping control in the entry toolbar at the UI text size", () => {
    expect(declarationFor(".archive-preview-entry-actions")).toMatch(
      /margin-left:\s*auto;/u
    )
    const wrapButtonRule = declarationFor(
      ".read-only-file-preview-wrap-button"
    )
    expect(wrapButtonRule).toMatch(
      /font-size:\s*var\(--app-ui-font-size\);/u
    )
    expect(wrapButtonRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
  })
})
