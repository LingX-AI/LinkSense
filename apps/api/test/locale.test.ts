import { describe, expect, it } from "vitest"
import type { FastifyRequest } from "fastify"

import { normalizeLocale, resolveLocale } from "../src/lib/locale.js"

function request(acceptLanguage?: string): FastifyRequest {
  return {
    headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
  } as FastifyRequest
}

describe("locale resolution", () => {
  it.each([
    ["es-MX", "es-ES"],
    ["pt-PT", "pt-BR"],
    ["fr-CA", "fr-FR"],
    ["ja", "ja-JP"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected)
  })

  it("prefers the saved locale over the request header", () => {
    expect(resolveLocale(request("ja,en;q=0.8"), "fr-FR")).toBe("fr-FR")
  })

  it("uses the first supported Accept-Language entry", () => {
    expect(resolveLocale(request("de-DE, pt-PT;q=0.9, en;q=0.8"))).toBe(
      "pt-BR"
    )
  })

  it("uses the requested fallback when no supported locale is available", () => {
    expect(resolveLocale(request("de-DE"), null, "en-US")).toBe("en-US")
  })
})
