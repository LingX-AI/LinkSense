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

  it("requires a positive total quota whenever registration is enabled", () => {
    expect(
      registrationSettingsSchema.parse({
        enabled: false,
        total_token_limit: null,
      }),
    ).toEqual({
      enabled: false,
      total_token_limit: null,
    })
    expect(
      registrationSettingsSchema.parse({
        enabled: true,
        total_token_limit: "12500000",
      }),
    ).toEqual({ enabled: true, total_token_limit: "12500000" })
    expect(() =>
      registrationSettingsSchema.parse({
        enabled: true,
        total_token_limit: null,
      }),
    ).toThrow()
    expect(() => registrationSettingsSchema.parse({})).toThrow()
    expect(() =>
      registrationSettingsSchema.parse({
        enabled: true,
        total_token_limit: "1000000",
        allowlist: [],
      }),
    ).toThrow()
  })
})
