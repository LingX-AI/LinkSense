import { describe, expect, it } from "vitest"

import {
  completeRegistrationInputSchema,
  registrationRequestInputSchema,
  registrationSettingsSchema,
} from "../src/auth.js"

describe("open registration contracts", () => {
  it("normalizes registration emails and rejects unknown fields", () => {
    expect(
      registrationRequestInputSchema.parse({ email: " Person@Example.COM " }),
    ).toEqual({ email: "person@example.com" })
    expect(() =>
      registrationRequestInputSchema.parse({
        email: "person@example.com",
        role: "admin",
      }),
    ).toThrow()
  })

  it("keeps activation input strict and applies the shared password policy", () => {
    expect(
      completeRegistrationInputSchema.parse({
        token: "opaque-token".repeat(3),
        new_password: "Valid123!",
      }),
    ).toEqual({
      token: "opaque-token".repeat(3),
      new_password: "Valid123!",
    })
    expect(() =>
      completeRegistrationInputSchema.parse({ token: "", new_password: "" }),
    ).toThrow()
  })

  it("controls registration independently of quotas and rejects old quota fields", () => {
    expect(registrationSettingsSchema.parse({ enabled: true })).toEqual({ enabled: true })
    expect(registrationSettingsSchema.parse({ enabled: false })).toEqual({ enabled: false })
    expect(() => registrationSettingsSchema.parse({})).toThrow()
    expect(() => registrationSettingsSchema.parse({ enabled: true, total_token_limit: "100" })).toThrow()
  })
})
