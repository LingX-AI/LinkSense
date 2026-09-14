// @vitest-environment node

import { describe, expect, it } from "vitest"

import { cn } from "@/lib/utils"

describe("card radius class merging", () => {
  it.each([
    ["rounded-lg", "rounded-card"],
    ["rounded-card", "rounded-none"],
    ["rounded-t-xl", "rounded-t-card"],
    ["rounded-b-card", "rounded-b-none"],
    ["sm:rounded-lg", "sm:rounded-card"],
  ])("merges %s with %s using the last radius", (previous, next) => {
    expect(cn("flex", previous, next)).toBe(`flex ${next}`)
  })

  it("preserves corner and responsive overrides alongside the card radius", () => {
    expect(cn("rounded-card", "rounded-t-none", "sm:rounded-none")).toBe(
      "rounded-card rounded-t-none sm:rounded-none"
    )
  })
})
