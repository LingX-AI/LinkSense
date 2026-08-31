import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("administrator user-management table layout", () => {
  it("keeps sticky identity and action cells opaque while preserving hover feedback", () => {
    expect(appStyles).toMatch(
      /\.user-management-table\s*\{[^}]*min-width:\s*1600px;[^}]*border-spacing:\s*0;[^}]*border-collapse:\s*separate;[^}]*isolation:\s*isolate;/u
    )
    expect(appStyles).toMatch(
      /\.user-management-selection-column,\s*\.user-management-name-column,\s*\.user-management-actions-column\s*\{[^}]*--user-management-sticky-overlay:\s*transparent;[^}]*position:\s*sticky;[^}]*z-index:\s*10;[^}]*background:\s*linear-gradient\(\s*var\(--user-management-sticky-overlay\),\s*var\(--user-management-sticky-overlay\)\s*\),\s*var\(--app-canvas\)\s*!important;/u
    )
    expect(appStyles).toMatch(
      /\.user-management-table\s+\[data-slot="table-row"\]:hover\s+\.user-management-selection-column,\s*\.user-management-table\s+\[data-slot="table-row"\]:hover\s+\.user-management-name-column,\s*\.user-management-table\s+\[data-slot="table-row"\]:hover\s+\.user-management-actions-column\s*\{[^}]*--user-management-sticky-overlay:\s*color-mix\(\s*in srgb,\s*var\(--app-hover\) 72%,\s*transparent\s*\);/u
    )
    expect(appStyles).not.toContain("--user-management-sticky-background")
  })

  it("keeps the identity columns on the left and actions on the right without vertical separators", () => {
    expect(appStyles).toMatch(
      /\.user-management-selection-column\s*\{[^}]*left:\s*0;[^}]*width:\s*40px;[^}]*min-width:\s*40px;/u
    )
    expect(appStyles).toMatch(
      /\.user-management-name-column\s*\{[^}]*left:\s*40px;[^}]*width:\s*320px;[^}]*min-width:\s*320px;[^}]*max-width:\s*320px;/u
    )
    expect(appStyles).toMatch(
      /\.user-management-actions-column\s*\{[^}]*right:\s*0;[^}]*width:\s*112px;[^}]*min-width:\s*112px;/u
    )
    expect(
      appStyles.match(/\.user-management-name-column\s*\{[^}]*\}/u)?.[0]
    ).not.toContain("box-shadow")
    expect(
      appStyles.match(/\.user-management-actions-column\s*\{[^}]*\}/u)?.[0]
    ).not.toContain("box-shadow")
  })

  it("reserves enough space for the complete last-login value", () => {
    expect(appStyles).toMatch(
      /\.user-management-last-login-column\s*\{[^}]*width:\s*168px;[^}]*min-width:\s*168px;/u
    )
  })
})
