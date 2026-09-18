// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("knowledge-base detail page layout", () => {
  it("does not add a knowledge-only gap above the library search toolbar", () => {
    const toolbarRule = appStyles.match(
      /\.knowledge-library-toolbar\s*\{([^}]*)\}/u
    )?.[1]

    expect(toolbarRule).toBeDefined()
    expect(toolbarRule).not.toMatch(/margin(?:-top|-block(?:-start)?)?:/u)
  })

  it("maps directory tree guides to a visible divider token in every theme", () => {
    const dividerValues = Array.from(
      appStyles.matchAll(/--app-divider:\s*([^;]+);/gu),
      (match) => match[1]?.trim()
    )

    expect(appStyles).toMatch(/--color-divider:\s*var\(--app-divider\);/u)
    expect(dividerValues.length).toBeGreaterThanOrEqual(2)
    expect(dividerValues.every((value) => value !== "transparent")).toBe(true)
  })

  it("uses compact spacing between the detail header and document section", () => {
    expect(appStyles).toMatch(
      /\.knowledge-detail-page\s+\.management-header\s*\{[^}]*margin-bottom:\s*14px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-detail-page\s+\.knowledge-document-section\s*\{[^}]*margin-top:\s*12px;/u
    )
  })

  it("stacks detail notices without reserving an empty banner row", () => {
    expect(appStyles).toMatch(
      /\.knowledge-detail-notices\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*12px;/u
    )
  })

  it("keeps the detail overview metadata beside a truncated description", () => {
    expect(appStyles).toMatch(
      /\.management-header-description-row\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*flex-wrap:\s*wrap;[^}]*align-items:\s*center;[^}]*gap:\s*4px\s+16px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-detail-page\s+\.management-header-description\s*\{[^}]*max-width:\s*min\(360px,\s*100%\);[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/u
    )
    expect(appStyles).toMatch(
      /@media\s*\([^)]*max-width:\s*767px[^)]*\)\s*\{[\s\S]*?\.knowledge-detail-page\s+\.management-header-description-row\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*flex-start;/u
    )
  })

  it("constrains document names with ellipsis and keeps their typography compact", () => {
    expect(appStyles).toMatch(
      /\.knowledge-document-name\s*\{[^}]*width:\s*420px;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-file-name\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;[^}]*color:\s*var\(--app-text\);[^}]*font-size:\s*var\(--app-ui-font-size\);[^}]*line-height:\s*var\(--app-ui-compact-line-height\);[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-type\s*\{[^}]*color:\s*var\(--app-muted\);[^}]*font-size:\s*var\(--app-font-12\);[^}]*line-height:\s*var\(--app-line-18\);/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-link:hover\s*\{[^}]*color:\s*var\(--app-text\);/u
    )
  })

  it("uses the configured appearance font size for knowledge preview file names", () => {
    expect(appStyles).toMatch(
      /\.knowledge-preview-header h1\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);[^}]*line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
  })

  it("uses the one-pixel-smaller token for knowledge citation source labels", () => {
    expect(appStyles).toMatch(
      /\.knowledge-preview-header p\s*\{[^}]*font-size:\s*var\(--app-font-12\);/u
    )
  })

  it("uses a bounded viewport height for the document preview", () => {
    const filePreviewRule = appStyles.match(
      /\.knowledge-file-preview\s*\{([^}]*)\}/u
    )?.[1]
    const mobileFilePreviewRule = appStyles.match(
      /@media\s*\([^)]*max-width:\s*767px[^)]*\)\s*\{[\s\S]*?\.knowledge-file-preview\s*\{([^}]*)\}/u
    )?.[1]

    expect(appStyles).toMatch(
      /\.knowledge-preview-page\s*\{[^}]*display:\s*flex;[^}]*padding-bottom:\s*24px;/u
    )
    expect(filePreviewRule).toMatch(/height:\s*calc\(100dvh - 220px\);/u)
    expect(filePreviewRule).toMatch(/min-height:\s*640px;/u)
    expect(filePreviewRule).toMatch(/max-height:\s*860px;/u)
    expect(mobileFilePreviewRule).toMatch(/height:\s*calc\(100dvh - 220px\);/u)
    expect(mobileFilePreviewRule).toMatch(/min-height:\s*520px;/u)
    expect(mobileFilePreviewRule).toMatch(/max-height:\s*620px;/u)
    expect(appStyles).toMatch(
      /@media\s*\([^)]*max-width:\s*767px[^)]*\)\s*\{[\s\S]*?\.knowledge-preview-page\s*\{[^}]*padding-bottom:\s*24px;/u
    )
  })

  it("keeps the viewer surface without an outer or loading status card", () => {
    const filePreviewPanelRule = appStyles.match(
      /\.knowledge-preview-panel:has\(> \.knowledge-file-preview\)\s*\{([^}]*)\}/u
    )?.[1]

    expect(filePreviewPanelRule).toMatch(/border:\s*0;/u)
    expect(filePreviewPanelRule).toMatch(/border-radius:\s*0;/u)
    expect(filePreviewPanelRule).toMatch(/background:\s*transparent;/u)
    expect(filePreviewPanelRule).toMatch(/padding:\s*0;/u)
    expect(appStyles).toMatch(
      /\.knowledge-file-viewer-surface,[\s\S]*?\.knowledge-file-viewer-state\s*\{[^}]*border:\s*1px solid var\(--app-divider\);[^}]*border-radius:\s*var\(--radius-lg\);[^}]*background:\s*var\(--office-viewer-canvas\);/u
    )
    expect(appStyles).not.toContain(".knowledge-file-viewer-loading-status")
    expect(appStyles).not.toContain(".knowledge-file-viewer-loading-progress")
  })

  it("uses a simple rounded card without a side accent for citation excerpts", () => {
    const excerptRule = appStyles.match(
      /\n\.knowledge-citation-excerpt\s*\{([^}]*)\}/u
    )?.[1]

    expect(excerptRule).toMatch(/border:\s*1px solid var\(--app-divider\);/u)
    expect(excerptRule).toMatch(/border-radius:\s*var\(--radius-xl\);/u)
    expect(excerptRule).toMatch(/background:\s*var\(--card\);/u)
    expect(excerptRule).toMatch(/padding:\s*16px 18px;/u)
    expect(excerptRule).not.toMatch(/border-left/u)
    expect(excerptRule).not.toMatch(/box-shadow/u)
  })

  it("keeps knowledge cards bordered without hover shadows", () => {
    const linkRule = appStyles.match(
      /\.knowledge-card-link\s*\{([^}]*)\}/u
    )?.[1]
    const cardRule = appStyles.match(/\.knowledge-card\s*\{([^}]*)\}/u)?.[1]
    const hoverRule = appStyles.match(
      /\.knowledge-card-link:hover \.knowledge-card,\s*\.knowledge-card-link:focus-visible \.knowledge-card\s*\{([^}]*)\}/u
    )?.[1]
    const focusRule = appStyles.match(
      /\.knowledge-card-link:focus-visible\s*\{([^}]*)\}/u
    )?.[1]

    expect(linkRule).toMatch(/display:\s*block;/u)
    expect(linkRule).toMatch(/text-decoration:\s*none;/u)
    expect(cardRule).toMatch(/--card-spacing:\s*0px;/u)
    expect(cardRule).toMatch(/cursor:\s*pointer;/u)
    expect(cardRule).toMatch(/background:\s*transparent;/u)
    expect(cardRule).toMatch(/transition:\s*background-color 160ms ease;/u)
    expect(cardRule).not.toMatch(/box-shadow/u)
    expect(hoverRule).toMatch(/background:\s*var\(--app-hover\);/u)
    expect(hoverRule).not.toMatch(/box-shadow/u)
    expect(focusRule).toMatch(/outline:\s*2px solid/u)
    expect(focusRule).toMatch(/outline-offset:\s*-2px;/u)
    expect(appStyles).not.toMatch(
      /\.knowledge-card-link:hover \.knowledge-card-title\s*\{[^}]*text-decoration:\s*underline;/u
    )
  })

  it("aligns the knowledge icon with a compact single-line card title and description", () => {
    const headingRule = appStyles.match(
      /\.knowledge-card-heading\s*\{([^}]*)\}/u
    )?.[1]
    const titleRule = appStyles.match(
      /\.knowledge-card-title\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = appStyles.match(
      /\.knowledge-card-icon\s*\{([^}]*)\}/u
    )?.[1]
    const iconSvgRule = appStyles.match(
      /\.knowledge-card-icon svg\s*\{([^}]*)\}/u
    )?.[1]
    const sourceTextRule = appStyles.match(
      /\.knowledge-card-source-text\s*\{([^}]*)\}/u
    )?.[1]
    const footerRule = appStyles.match(
      /\.knowledge-card-footer\s*\{([^}]*)\}/u
    )?.[1]
    const footerMetaRule = appStyles.match(
      /\.knowledge-card-footer-meta\s*\{([^}]*)\}/u
    )?.[1]
    const updatedAtRule = appStyles.match(
      /\.knowledge-card-updated-at\s*\{([^}]*)\}/u
    )?.[1]

    expect(headingRule).toMatch(/display:\s*flex;/u)
    expect(headingRule).toMatch(/min-width:\s*0;/u)
    expect(headingRule).toMatch(/align-items:\s*center;/u)
    expect(headingRule).toMatch(/gap:\s*8px;/u)
    expect(titleRule).toMatch(/min-width:\s*0;/u)
    expect(titleRule).toMatch(/flex:\s*0 1 auto;/u)
    expect(titleRule).toMatch(/font-size:\s*var\(--app-font-15\);/u)
    expect(titleRule).toMatch(/line-height:\s*var\(--app-line-22\);/u)
    expect(iconRule).toMatch(/width:\s*24px;/u)
    expect(iconRule).toMatch(/height:\s*24px;/u)
    expect(iconRule).toMatch(/color:\s*var\(--app-text\);/u)
    expect(iconRule).not.toMatch(/linear-gradient/u)
    expect(iconRule).not.toMatch(/box-shadow/u)
    expect(iconSvgRule).toMatch(/width:\s*18px;/u)
    expect(iconSvgRule).toMatch(/height:\s*18px;/u)
    expect(sourceTextRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(sourceTextRule).toMatch(/font-weight:\s*400;/u)
    expect(sourceTextRule).toMatch(/line-height:\s*var\(--app-line-18\);/u)
    expect(sourceTextRule).not.toMatch(
      /background|border-radius|#4aa4ef|#2067a8|#71b7ff|#9ed0ff/u
    )
    expect(footerRule).toBeUndefined()
    expect(footerMetaRule).toBeUndefined()
    expect(updatedAtRule).toMatch(/white-space:\s*nowrap;/u)
    expect(appStyles).not.toContain(".knowledge-card-footer")
    expect(appStyles).toMatch(
      /\.knowledge-card-metadata\s*\{[^}]*gap:\s*1px\s+12px;/u
    )
  })

  it("keeps citation excerpt typography compact", () => {
    expect(appStyles).toMatch(
      /\.knowledge-citation-excerpt h1,[\s\S]*?\.knowledge-citation-excerpt h4\s*\{[^}]*margin:\s*14px 0 6px;[^}]*font-size:\s*var\(--app-font-16\);[^}]*line-height:\s*var\(--app-line-24\);/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-citation-excerpt p,[\s\S]*?\.knowledge-citation-excerpt table\s*\{[^}]*margin-block:\s*8px;/u
    )
  })

  it("uses compact retry details and a thin processing track in document rows", () => {
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s*\{[^}]*gap:\s*6px 8px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s+\[data-slot="progress-label"\],[\s\S]*?\.knowledge-document-progress\s+\[data-slot="progress-value"\]\s*\{[^}]*font-size:\s*var\(--app-font-12\);[^}]*font-weight:\s*500;[^}]*line-height:\s*var\(--app-line-16\);/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s+\[data-slot="progress-track"\]\s*\{[^}]*height:\s*4px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-retry-status\s*\{[^}]*font-size:\s*var\(--app-font-12\);[^}]*line-height:\s*var\(--app-line-18\);/u
    )
  })

  it("keeps live document progress in a fixed non-pulsing layout", () => {
    expect(appStyles).toMatch(
      /\.knowledge-document-status-column\s*\{[^}]*width:\s*256px;[^}]*min-width:\s*256px;[^}]*max-width:\s*256px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-status\s*\{[^}]*width:\s*240px;[^}]*max-width:\s*240px;[^}]*min-width:\s*240px;[^}]*min-height:\s*26px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 40px;[^}]*gap:\s*6px 8px;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s+\[data-slot="progress-value"\]\s*\{[^}]*width:\s*40px;[^}]*margin-left:\s*0;[^}]*text-align:\s*right;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress\s+\[data-slot="progress-indicator"\]\s*\{[^}]*transition:\s*width 180ms ease-out;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-progress[\s\S]*?\[data-slot="progress-indicator"\]\[data-indeterminate\]\s*\{[^}]*animation:\s*none;/u
    )
    expect(appStyles).toMatch(
      /\.knowledge-document-name,[\s\S]*?\.knowledge-document-status-column\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-width:\s*0;/u
    )
  })

  it("pins document actions to the right edge during horizontal table scroll", () => {
    const actionsColumnRule = appStyles.match(
      /\.knowledge-document-actions-column\s*\{([^}]*)\}/u
    )?.[1]
    const actionsHeaderRule = appStyles.match(
      /\.knowledge-document-table\s+\[data-slot="table-head"\]\.knowledge-document-actions-column\s*\{([^}]*)\}/u
    )?.[1]
    const mobileActionsColumnRule = appStyles.match(
      /@media\s*\([^)]*max-width:\s*767px[^)]*\)\s*\{[\s\S]*?\.knowledge-document-actions-column\s*\{([^}]*)\}/u
    )?.[1]

    expect(appStyles).toMatch(
      /\.knowledge-document-table table\s*\{[^}]*min-width:\s*980px;/u
    )
    expect(actionsColumnRule).toMatch(/position:\s*sticky;/u)
    expect(actionsColumnRule).toMatch(/right:\s*0;/u)
    expect(actionsColumnRule).toMatch(/width:\s*136px;/u)
    expect(actionsColumnRule).toMatch(/min-width:\s*136px;/u)
    expect(actionsColumnRule).toMatch(/background:\s*var\(--card\);/u)
    expect(actionsColumnRule).toMatch(
      /box-shadow:\s*-1px 0 0 var\(--app-divider\);/u
    )
    expect(actionsHeaderRule).toMatch(/z-index:\s*2;/u)
    expect(mobileActionsColumnRule).toMatch(/position:\s*static;/u)
    expect(mobileActionsColumnRule).toMatch(/right:\s*auto;/u)
    expect(mobileActionsColumnRule).toMatch(/box-shadow:\s*none;/u)
  })
})
