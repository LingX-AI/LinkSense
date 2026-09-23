// @vitest-environment node

import previewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("Word preview layout", () => {
  it("keeps manually enlarged pages inside the horizontal scroll range", () => {
    expect(previewStyles).toMatch(
      /\.word-preview-editor-surface\[data-fit-width="false"\]\s+\.docx-editor__scroll-container\s*> div\s*\{[^}]*?min-width:\s*var\(--word-preview-scroll-width\)\s*!important;/u
    )
  })

  it("clips scaled wrapper overflow at the page width without creating a nested vertical scroller", () => {
    const manualZoomLayout = previewStyles.match(
      /\.word-preview-editor-surface\[data-fit-width="false"\]\s+\.docx-editor__scroll-container\s*> div\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body
    expect(manualZoomLayout).toMatch(/overflow-x:\s*clip;/u)
    expect(manualZoomLayout).toMatch(/overflow-y:\s*visible;/u)
  })

  it("hides EigenPal's duplicate scroll page indicator without affecting the shared toolbar count", () => {
    expect(previewStyles).toMatch(
      /\.word-preview-editor\s+\.docx-editor__scroll-container\s*\+\s*\[role="status"\]\[aria-live="polite"\]\s*\{[\s\S]*?display:\s*none\s*!important;/u
    )
  })

  it("hides horizontal overflow while the document is fitted to the preview width", () => {
    expect(previewStyles).toMatch(
      /\.word-preview-editor-surface\[data-fit-width="true"\]\s+\.docx-editor__scroll-container\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow-x:\s*hidden\s*!important;/u
    )
    expect(previewStyles).toMatch(
      /\.word-preview-editor-surface\[data-fit-width="true"\]\s+\.docx-editor__scroll-container\s*> div\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0\s*!important;[\s\S]*?max-width:\s*100%;/u
    )
  })

  it("keeps the first unscaled Word frame hidden behind the shared loading surface", () => {
    expect(previewStyles).toMatch(
      /\.word-preview-editor-surface\[data-layout-ready="false"\]\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/u
    )
    expect(previewStyles).toMatch(
      /\.word-preview-loading-state\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?background:\s*var\(--office-viewer-canvas\);/u
    )
  })

  it("uses a crisp square page without a muddy outer glow", () => {
    expect(previewStyles).toMatch(
      /--word-preview-page-edge:\s*rgb\(32 32 32 \/ 8%\);/u
    )
    expect(previewStyles).toMatch(
      /--word-preview-page-shadow:\s*0 0 0 1px var\(--word-preview-page-edge\),\s*0 8px 18px -14px rgb\(32 32 32 \/ 16%\),\s*0 1px 2px rgb\(32 32 32 \/ 4%\);/u
    )
    expect(previewStyles).toMatch(
      /\.dark\s*\{[\s\S]*?--word-preview-page-edge:\s*rgb\(255 255 255 \/ 7%\);/u
    )
    expect(previewStyles).toMatch(
      /\.dark\s*\{[\s\S]*?--word-preview-page-shadow:\s*0 0 0 1px var\(--word-preview-page-edge\),\s*0 10px 22px -18px rgb\(0 0 0 \/ 30%\),\s*0 1px 2px rgb\(0 0 0 \/ 14%\);/u
    )
    expect(previewStyles).not.toMatch(/0 0 1[46]px rgb/u)
    expect(previewStyles).toMatch(
      /\.word-preview-editor\.ep-root\.word-preview-editor \.layout-page\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?border-radius:\s*0;[\s\S]*?box-shadow:\s*var\(--word-preview-page-shadow\)\s*!important;/u
    )
  })

  it("draws the active text selection with a dashed outline and translucent blue fill", () => {
    expect(previewStyles).toMatch(
      /\.word-preview-selection-frame\s*\{[\s\S]*?fill:\s*color-mix\(in srgb, var\(--app-selection\) 12%, transparent\);[\s\S]*?stroke:\s*var\(--app-selection\);[\s\S]*?stroke-width:\s*2px;[\s\S]*?stroke-dasharray:\s*6 4;/u
    )
  })
})
