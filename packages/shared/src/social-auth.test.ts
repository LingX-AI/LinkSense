import { describe, expect, it } from "vitest"
import { loginMethodSchema } from "./users.js"
import {
  socialProviderSchema,
  updateSocialProviderSchema,
} from "./social-auth.js"

describe("social authentication contracts", () => {
  it("retains every existing login method and accepts every supported social provider", () => {
    for (const method of [
      "password",
      "oidc",
      "teams",
      ...socialProviderSchema.options,
    ])
      expect(loginMethodSchema.parse(method)).toBe(method)
    expect(loginMethodSchema.safeParse("unknown").success).toBe(false)
  })
  it("validates credentials without accepting endpoints or permission scopes from clients", () => {
    expect(
      updateSocialProviderSchema.safeParse({
        enabled: true,
        expected_revision: 0,
        client_id: "",
      }).success,
    ).toBe(false)
    expect(
      updateSocialProviderSchema.safeParse({
        enabled: true,
        expected_revision: 0,
        client_id: "app",
        issuer_url: "https://attacker.example.test",
      }).success,
    ).toBe(false)
    expect(
      updateSocialProviderSchema.safeParse({
        enabled: true,
        expected_revision: 0,
        client_id: "app",
        graph_api_version: "../../other",
      }).success,
    ).toBe(false)
    expect(
      updateSocialProviderSchema.safeParse({
        enabled: false,
        expected_revision: 0,
        client_id: "",
      }).success,
    ).toBe(true)
  })
})
