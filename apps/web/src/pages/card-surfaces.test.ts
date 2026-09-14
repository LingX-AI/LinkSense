// @vitest-environment node

import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"

import appStyles from "@/index.css?raw"
import feedbackSource from "@/pages/my-feedback-page.tsx?raw"
import modelTableSource from "@/features/admin/model-settings-table.tsx?raw"

function rule(selector: string) {
  return Array.from(appStyles.matchAll(/([^{}]+)\{([^{}]*)\}/gu))
    .filter((match) => match[1].trim() === selector)
    .map((match) => match[2])
    .join("\n")
}

describe("card and form surfaces", () => {
  it("uses the reference gray for every dark card variant while preserving light surfaces", () => {
    expect(rule(".dark")).toContain("--card: #252525;")
    expect(rule(".dark")).toContain("--card-soft: var(--card);")
    expect(rule(".dark")).toContain("--card-subtle: var(--card);")
    expect(rule(":root")).toContain("--card: #ffffff;")
    expect(rule(":root")).toContain(
      "--card-soft: color-mix(in oklab, var(--muted) 40%, transparent);"
    )
    expect(rule(":root")).toContain(
      "--card-subtle: var(--app-activity-surface);"
    )
  })

  it.each([
    ".settings-panel",
    ".personalization-memory-card",
    ".profile-usage-loading",
    ".profile-stat-strip",
    ".knowledge-card-list",
    ".knowledge-document-table",
  ])("gives %s the shared opaque card surface", (selector) => {
    expect(rule(selector)).toContain("background: var(--card);")
  })

  it.each([".health-summary > div", ".import-preview"])(
    "makes %s follow the theme without changing its light appearance",
    (selector) => {
      expect(rule(selector)).toContain("background: var(--card-subtle);")
    }
  )

  it("uses the shared card appearance for the personal feedback table", () => {
    expect(feedbackSource).toContain('<Table appearance="card">')
  })

  it("keeps fixed table columns opaque on the same surface as normal columns", () => {
    for (const selector of [
      ".audit-details-actions-column",
      ".user-management-selection-column,\n.user-management-name-column,\n.user-management-actions-column",
      ".admin-knowledge-actions-column",
      ".knowledge-document-actions-column",
    ]) {
      expect(rule(selector)).toContain("var(--card)")
      expect(rule(selector)).not.toContain("var(--app-canvas)")
    }
    expect(modelTableSource).toContain('cn("bg-card", isDragging')
  })

  it.each(["admin-knowledge", "knowledge-document"])(
    "matches the regular row hover over an opaque base in the %s fixed column",
    (prefix) => {
      const hoverRule = rule(
        `.${prefix}-table\n  [data-slot="table-row"]:hover\n  .${prefix}-actions-column`
      )
      expect(hoverRule).toContain(
        "linear-gradient(var(--app-hover), var(--app-hover)), var(--card)"
      )
    }
  )

  it("keeps dark fields opaque and distinct from cards with a separate focus surface", () => {
    expect(rule(".dark")).toContain("--field: #303030;")
    expect(rule(".dark")).toContain("--field-focus: #383838;")
    expect(rule(":root")).toContain(
      "--field: color-mix(in oklab, var(--input) 50%, transparent);"
    )
    expect(rule(":root")).toContain(
      "--field-focus: color-mix(in oklab, var(--input) 65%, transparent);"
    )
  })

  it("generates semantic card and field backgrounds from the global tokens", async () => {
    const theme = appStyles.match(/@theme inline\s*\{[^}]*\}/u)?.[0]
    const compiler = await compile(`${theme}\n@tailwind utilities;`)
    const css = compiler.build([
      "bg-card",
      "bg-card-soft",
      "bg-field",
      "focus-visible:bg-field-focus",
    ])
    for (const token of ["card", "card-soft", "field", "field-focus"]) {
      expect(css).toContain(`background-color: var(--${token});`)
    }
  })
})
