// @vitest-environment node

import previewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("read-only document preview layout", () => {
  it("renders the document surface with square corners at every viewport size", () => {
    const contentRules = [
      ...previewStyles.matchAll(
        /\.read-only-file-preview-markdown-content\s*\{([^}]*)\}/gu
      ),
    ].map((match) => match[1] ?? "")

    expect(contentRules).not.toHaveLength(0)
    expect(contentRules.some((rule) => /border-radius:\s*0;/u.test(rule))).toBe(
      true
    )
    const radiusValues = contentRules.flatMap((rule) =>
      [...rule.matchAll(/border-radius:\s*([^;]+);/gu)].map(
        (match) => match[1]?.trim() ?? ""
      )
    )
    expect(new Set(radiusValues)).toEqual(new Set(["0"]))
  })

  it("matches the flat Markdown surface on PDF pages", () => {
    const pageRule = previewStyles.match(
      /\.read-only-file-preview-pdf-page\s*\{([^}]*)\}/u
    )?.[1]

    expect(pageRule).toMatch(/border:\s*1px solid var\(--app-divider\);/u)
    expect(pageRule).toMatch(/border-radius:\s*0;/u)
    expect(pageRule).toMatch(/box-shadow:\s*none;/u)
  })
})
