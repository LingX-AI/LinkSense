import { describe, expect, it } from "vitest"

import { passwordSchema } from "@/lib/password"

describe("password schema", () => {
  it("counts Unicode code points and accepts all required categories", () => {
    expect(passwordSchema.safeParse("Abcdef1!").success).toBe(true)
    expect(passwordSchema.safeParse("Abc😀def1!").success).toBe(true)
    expect(passwordSchema.safeParse("Aa1!xxxxxxxxxxxx").success).toBe(true)
  })

  it("rejects missing categories and out-of-range values", () => {
    expect(passwordSchema.safeParse("abcdef1!").success).toBe(false)
    expect(passwordSchema.safeParse("ABCDEF1!").success).toBe(false)
    expect(passwordSchema.safeParse("Abcdefg!").success).toBe(false)
    expect(passwordSchema.safeParse("Abcdef12").success).toBe(false)
    expect(passwordSchema.safeParse("Aa1!xxxxxxxxxxxxx").success).toBe(false)
  })
})
