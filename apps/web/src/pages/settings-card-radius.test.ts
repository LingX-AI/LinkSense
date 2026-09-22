// @vitest-environment node

import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"

import appStyles from "@/index.css?raw"
import tableSource from "@/components/ui/table.tsx?raw"
import adminKnowledgeSource from "@/pages/admin-knowledge-base-page.tsx?raw"

const cardSelectors = [
  ".entity-row,\n.simple-list-row",
  ".archived-conversation-list",
  ".data-table-scroll",
  ".capability-library-row",
  ".marketplace-governance-item",
  ".settings-panel",
  ".personalization-memory-card",
  ".role-summary",
  ".product-logo-preview",
  ".profile-usage-loading",
  ".profile-stat-strip",
  ".health-summary > div",
  ".import-preview",
  ".knowledge-document-table",
  '.knowledge-document-table [data-slot="table-row"]',
]

describe("settings card radius", () => {
  it("uses the shared table card for knowledge results and keeps pagination outside the border", () => {
    expect(adminKnowledgeSource).toContain('<Table appearance="card">')
    expect(tableSource).toContain('appearance === "card"')
    expect(tableSource).toContain(
      "rounded-card border border-[color:var(--app-border)]"
    )
    const outer = appStyles.match(/\.admin-knowledge-table\s*\{[^}]*\}/u)?.[0]
    expect(outer).toBeDefined()
    expect(outer).not.toContain("border:")
    expect(outer).not.toContain("border-radius:")
  })

  it.each(cardSelectors)(
    "connects %s to the global card radius",
    (selector) => {
      const rules = Array.from(appStyles.matchAll(/([^{}]+)\{([^{}]*)\}/gu))
        .filter((match) => match[1].trim() === selector)
        .map((match) => match[2])
        .filter((rule) => rule.includes("border-radius:"))

      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) {
        expect(rule).toContain("border-radius: var(--app-card-radius);")
      }
    }
  )

  it("generates card utilities that follow one configurable token without a fixed cap", async () => {
    expect(appStyles.match(/--app-card-radius:\s*[^;]+;/gu)).toHaveLength(1)
    expect(appStyles.match(/:root\s*\{[^}]*\}/u)?.[0]).toMatch(
      /--app-card-radius:\s*\d+(?:\.\d+)?(?:px|rem);/u
    )
    const theme = appStyles.match(/@theme inline\s*\{[^}]*\}/u)?.[0]
    expect(theme).toBeDefined()
    const compiler = await compile(`${theme}\n@tailwind utilities;`)
    const css = compiler.build([
      "rounded-card",
      "rounded-t-card",
      "rounded-b-card",
    ])

    expect(css).toContain("border-radius: var(--app-card-radius);")
    for (const corner of [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]) {
      expect(css).toContain(`border-${corner}-radius: var(--app-card-radius);`)
    }
  })
})
