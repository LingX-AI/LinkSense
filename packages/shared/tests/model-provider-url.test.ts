import { describe, expect, it } from "vitest"
import { modelProviderBaseUrlSchema } from "../src/model-provider.js"

describe("model provider URL validation", () => {
  it.each(["", "h", "https:", "https://", "not a url"])("rejects incomplete URL %j without throwing during editing", (value) => {
    expect(() => modelProviderBaseUrlSchema.safeParse(value)).not.toThrow()
    expect(modelProviderBaseUrlSchema.safeParse(value).success).toBe(false)
  })
  it.each(["ftp://models.example.test", "https://user:password@models.example.test", "https://models.example.test?key=value", "https://models.example.test#section"])("rejects unsupported or credential-bearing URL %s", (value) => {
    expect(modelProviderBaseUrlSchema.safeParse(value).success).toBe(false)
  })
  it("normalizes trailing slashes on valid model endpoints", () => {
    expect(modelProviderBaseUrlSchema.parse("https://models.example.test/v1///")).toBe("https://models.example.test/v1")
  })
})
