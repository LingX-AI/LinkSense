// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("administrator knowledge-base governance layout", () => {
  it("separates the search filters from the result content", () => {
    expect(appStyles).toMatch(
      /\.admin-knowledge-filters\s*\{[^}]*margin-bottom:\s*16px;/u
    )
  })

  it("keeps the action column fixed to the right while the table scrolls", () => {
    expect(appStyles).toMatch(
      /\.admin-knowledge-actions-column\s*\{[^}]*position:\s*sticky;[^}]*right:\s*0;[^}]*width:\s*72px;[^}]*min-width:\s*72px;[^}]*background:\s*var\(--app-canvas\);[^}]*box-shadow:\s*-1px 0 0 var\(--app-divider\);/u
    )
    expect(appStyles).toMatch(
      /\.admin-knowledge-table\s+\[data-slot="table-head"\]\.admin-knowledge-actions-column\s*\{[^}]*z-index:\s*2;/u
    )
  })

  it("uses stable column widths and consistent information hierarchy", () => {
    expect(appStyles).toMatch(
      /\.admin-knowledge-table table\s*\{[^}]*min-width:\s*1230px;[^}]*table-layout:\s*fixed;/u
    )
    expect(appStyles).toMatch(
      /\.admin-knowledge-cell-stack\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*4px;/u
    )
    expect(appStyles).toMatch(
      /\.admin-knowledge-diagnostic-code\s*\{[^}]*max-width:\s*100%;[^}]*color:\s*var\(--destructive\);[^}]*font-size:\s*var\(--app-font-12\);/u
    )
  })

  it("integrates compact pagination with the table surface", () => {
    expect(appStyles).toMatch(
      /\.admin-knowledge-pagination\s*\{[^}]*justify-content:\s*flex-end;[^}]*border-top:\s*1px solid var\(--app-divider\);[^}]*padding:\s*10px 12px;/u
    )
  })
})
