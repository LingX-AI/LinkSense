import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("production CSS compatibility", () => {
  it("lets the production pipeline generate backdrop-filter vendor prefixes", () => {
    expect(appStyles).toContain("backdrop-filter:")
    expect(appStyles).not.toContain("-webkit-backdrop-filter:")
  })
})
