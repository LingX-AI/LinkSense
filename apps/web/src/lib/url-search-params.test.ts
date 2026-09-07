// @vitest-environment node

import { describe, expect, it } from "vitest"

import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"

describe("URL search parameter helpers", () => {
  it("updates scoped values while preserving unrelated parameters", () => {
    const current = new URLSearchParams("tab=artifacts&search=old")
    const next = updateUrlSearchParams(current, {
      search: "report",
      cursor: "next-page",
    })

    expect(next.toString()).toBe("tab=artifacts&search=report&cursor=next-page")
  })

  it("removes empty values and rejects unsupported enum values", () => {
    const next = updateUrlSearchParams(
      new URLSearchParams("filter=unknown&search=report"),
      { search: "" }
    )

    expect(next.has("search")).toBe(false)
    expect(readUrlEnum(next, "filter", ["all", "active"], "all")).toBe("all")
  })
})
