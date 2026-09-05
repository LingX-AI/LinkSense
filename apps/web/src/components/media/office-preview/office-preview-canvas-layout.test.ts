// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function declarationFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = appStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u")
  )

  return match?.groups?.body ?? ""
}

describe("file preview canvas layout", () => {
  it("uses the app canvas for dark mode file preview backgrounds", () => {
    const darkRule = declarationFor(".dark")

    expect(darkRule).toMatch(/--office-viewer-canvas:\s*var\(--app-canvas\);/u)
    expect(darkRule).toMatch(
      /--presentation-viewer-canvas:\s*var\(--office-viewer-canvas\);/u
    )
    expect(darkRule).toMatch(
      /--presentation-viewer-sidebar:\s*var\(--app-canvas\);/u
    )
  })

  it("keeps every file preview surface on the shared preview canvas token", () => {
    expect(declarationFor(".office-preview-body")).toMatch(
      /background:\s*var\(--office-viewer-canvas\);/u
    )
    expect(
      appStyles.match(
        /\.read-only-file-preview-pane,\s*\.read-only-file-preview-body\s*\{(?<body>[^}]*)\}/u
      )?.groups?.body
    ).toMatch(/background:\s*var\(--office-viewer-canvas\);/u)
    expect(
      appStyles.match(
        /\.archive-preview-pane,\s*\.archive-preview-body\s*\{(?<body>[^}]*)\}/u
      )?.groups?.body
    ).toMatch(/background:\s*var\(--office-viewer-canvas\);/u)
    expect(declarationFor(".word-preview-editor.ep-root")).toMatch(
      /background:\s*var\(--office-viewer-canvas\);/u
    )
    expect(
      appStyles.match(
        /\.word-preview-editor-surface,\s*\.spreadsheet-preview-viewer\s*\{(?<body>[^}]*)\}/u
      )?.groups?.body
    ).toMatch(/background:\s*var\(--office-viewer-canvas\);/u)
    expect(appStyles).toMatch(
      /\.word-preview-editor \.docx-editor__scroll-container,[\s\S]*?\{[\s\S]*?background:\s*var\(--office-viewer-canvas\)\s*!important;/u
    )
    expect(declarationFor(".html-preview-body")).toMatch(
      /background:\s*var\(--office-viewer-canvas\);/u
    )
    expect(declarationFor(".conversation-image-preview-body")).toMatch(
      /background:\s*var\(--office-viewer-canvas\);/u
    )
    expect(
      appStyles.match(
        /\.knowledge-file-viewer-surface,[\s\S]*?\.knowledge-file-viewer-state\s*\{(?<body>[^}]*)\}/u
      )?.groups?.body
    ).toMatch(/background:\s*var\(--office-viewer-canvas\);/u)
    expect(declarationFor(".presentation-preview-pptx-surface")).toMatch(
      /background:\s*var\(--presentation-viewer-canvas\);/u
    )
  })

  it("keeps EigenPal's rendered Word canvas on the shared preview token", () => {
    expect(appStyles).toMatch(
      /\.dark \.word-preview-editor\.ep-root\.word-preview-editor,\s*\.word-preview-editor\.ep-root\.dark\.word-preview-editor\s*\{[\s\S]*?--doc-bg:\s*var\(--office-viewer-canvas\);/u
    )
    expect(appStyles).toMatch(
      /--doc-bg-subtle:\s*var\(--office-viewer-canvas\);/u
    )
    expect(appStyles).toMatch(
      /--doc-surface:\s*var\(--office-viewer-canvas\);/u
    )
    expect(appStyles).toMatch(/--doc-card:\s*var\(--office-viewer-canvas\);/u)
  })

  it("forces EigenPal's dark Word viewport containers onto the preview canvas", () => {
    expect(appStyles).toMatch(
      /\.word-preview-editor\.ep-root\.dark\.word-preview-editor\s+\.docx-editor__scroll-container,[\s\S]*?\.word-preview-editor\.ep-root\.dark\.word-preview-editor\s+\.docx-editor-vue__pages-viewport,[\s\S]*?\.word-preview-editor\.ep-root\.dark\.word-preview-editor \.paged-editor,[\s\S]*?\.word-preview-editor\.ep-root\.dark\.word-preview-editor \.paged-editor__pages\s*\{[\s\S]*?background:\s*var\(--office-viewer-canvas\)\s*!important;[\s\S]*?background-color:\s*var\(--office-viewer-canvas\)\s*!important;/u
    )
  })

  it("does not override the rendered Word page itself", () => {
    expect(
      declarationFor(
        ".dark .word-preview-editor.ep-root.word-preview-editor .layout-page"
      )
    ).toBe("")
  })
})
