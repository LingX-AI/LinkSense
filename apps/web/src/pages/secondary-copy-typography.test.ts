// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function cssRule(selectorPattern: string) {
  const matches = Array.from(
    appStyles.matchAll(
      new RegExp(`(?:^|\\n)${selectorPattern}\\s*\\{([^}]*)\\}`, "gu")
    )
  )

  return matches[matches.length - 1]?.[1]
}

const readableSecondaryRules = [
  [
    "management descriptions",
    "\\.management-header p,\\s*\\.settings-section > p",
  ],
  ["entity descriptions", "\\.entity-row p"],
  ["form labels", "\\.form-label"],
  ["form hints", "\\.form-hint,\\s*\\.form-error"],
  ["checkbox rows", "\\.checkbox-row"],
  ["audit descriptions", "\\.audit-surface-description"],
  ["advanced filter trigger", "\\.audit-advanced-filters > summary"],
  ["management tables", "\\.data-table"],
  ["table secondary content", "\\.table-secondary"],
  ["capability descriptions", "\\.capability-library-description"],
  ["capability pagination", "\\.capability-library-more"],
  ["authentication notices", "\\.authentication-mode-notice"],
  [
    "settings descriptions",
    "\\.settings-page-header p,\\s*\\.settings-panel > p",
  ],
  ["appearance labels", "\\.appearance-theme-label"],
  ["role account summaries", "\\.role-account-count span"],
  ["page links", "\\.text-link,\\s*\\.public-link,\\s*\\.public-back-link"],
  ["health labels", "\\.health-summary span"],
  ["public page descriptions", "\\.public-panel header p"],
  ["page loading states", "\\.page-state"],
  ["risk summaries", "\\.risk-summary"],
  ["search errors", "\\.search-error"],
] as const

describe("readable secondary copy typography", () => {
  it.each(readableSecondaryRules)(
    "uses the 13px-derived token for %s",
    (_name, selectorPattern) => {
      const rule = cssRule(selectorPattern)

      expect(rule).toContain("font-size: var(--app-font-13);")
      expect(rule).toContain("line-height: var(--app-line-20);")
    }
  )

  it("uses the readable secondary size for table headings", () => {
    expect(cssRule("\\.data-table th")).toContain(
      "font-size: var(--app-font-13);"
    )
  })

  it("keeps page loading text in sync with the configured UI font size", () => {
    const rule = cssRule("\\.page-state-loading")

    expect(rule).toContain("font-size: var(--app-ui-font-size);")
    expect(rule).toContain("font-weight: 500;")
    expect(rule).toContain("line-height: var(--app-ui-compact-line-height);")
  })

  it("lets message channel descriptions use the available page width", () => {
    expect(
      cssRule("\\.channel-access-page \\.settings-page-header p")
    ).toContain("max-width: none;")
  })

  it("centers full-page loading feedback across the dynamic viewport", () => {
    const rule = cssRule("\\.page-state-loading-fullscreen")

    expect(rule).toContain("min-height: 100dvh;")
    expect(rule).toContain("align-items: center;")
    expect(rule).toContain("justify-content: center;")
  })

  it("uses bordered, shadowless health summary cards", () => {
    const rule = cssRule("\\.health-summary > div")

    expect(rule).toContain("border: 1px solid var(--app-border);")
    expect(rule).not.toContain("box-shadow")
  })

  it("keeps true technical metadata on the compact metadata tier", () => {
    const metadataRule = cssRule(
      "\\.table-metadata,\\s*\\.table-metadata \\.table-secondary"
    )

    expect(metadataRule).toContain("font-size: var(--app-font-12);")
    expect(metadataRule).toContain("line-height: var(--app-line-18);")
    expect(cssRule("\\.simple-list-link time")).toContain(
      "font-size: var(--app-font-10-5);"
    )
    expect(cssRule("\\.artifact-tile \\.file-tile-meta")).toContain(
      "font-size: var(--app-font-12);"
    )
  })

  it("uses compact bordered rows for binding lists", () => {
    expect(cssRule("\\.binding-list")).toContain("display: flex;")
    expect(cssRule("\\.binding-list")).toContain("gap: 6px;")

    const rule = cssRule("\\.binding-list li")

    expect(rule).toContain("border: 1px solid")
    expect(rule).toContain("border-radius: 8px;")
    expect(rule).toContain("background: transparent;")
    expect(rule).toContain("font-size: var(--app-font-12);")
    expect(rule).toContain("line-height: var(--app-line-18);")
  })

  it("keeps MCP server rows transparent on hover", () => {
    expect(cssRule("\\.mcp-server-list \\.entity-row:hover")).toContain(
      "background: transparent;"
    )
  })

  it("removes the retired effective-source inspector styles", () => {
    expect(appStyles).not.toContain("credential-effective-plugin-field")
    expect(appStyles).not.toContain("credential-effective-source-list")
  })

  it("vertically aligns capability source and compact risk metadata", () => {
    const metaRule = cssRule("\\.entity-meta")
    const metaTextRule = cssRule("\\.entity-meta > span")
    const compactRiskRule = cssRule("\\.entity-meta \\.risk-summary")
    const compactRiskTriggerRule = cssRule(
      "\\.risk-summary-compact \\.risk-summary-trigger"
    )

    expect(metaRule).toContain("align-items: center;")
    expect(metaTextRule).toContain("display: inline-flex;")
    expect(metaTextRule).toContain("align-items: center;")
    expect(compactRiskRule).toContain("display: inline-flex;")
    expect(compactRiskRule).toContain("align-items: center;")
    expect(compactRiskTriggerRule).toContain("height: var(--app-line-16);")
    expect(compactRiskTriggerRule).toContain("border: 0;")
  })
})
