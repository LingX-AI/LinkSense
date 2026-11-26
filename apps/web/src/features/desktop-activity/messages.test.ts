import { describe, expect, it } from "vitest"

import i18n, { supportedLanguages } from "@/i18n"

import { desktopActivityMessages } from "./messages"

function entries(
  value: unknown,
  prefix = ""
): Array<readonly [string, string]> {
  if (typeof value === "string") return [[prefix, value]]
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) =>
    entries(child, prefix ? `${prefix}.${key}` : key)
  )
}

function tokens(value: string) {
  return [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort()
}

describe("desktop activity translations", () => {
  it("provides the same authored keys and parameters in all six locales", () => {
    const source = entries(desktopActivityMessages["zh-CN"])
    const sourceKeys = source.map(([key]) => key).sort()
    for (const locale of supportedLanguages) {
      const translated = entries(desktopActivityMessages[locale])
      expect(
        translated.map(([key]) => key).sort(),
        `desktopActivity keys in ${locale}`
      ).toEqual(sourceKeys)
      for (const [key, value] of translated) {
        expect(value.trim(), `${locale}.${key}`).not.toBe("")
        const sourceValue = source.find(([sourceKey]) => sourceKey === key)?.[1]
        expect(tokens(value), `${locale}.${key}`).toEqual(
          tokens(sourceValue ?? "")
        )
      }
    }
  })

  it.each(supportedLanguages)("registers the namespace in %s", (locale) => {
    expect(i18n.getResource(locale, "translation", "desktopActivity")).toEqual(
      desktopActivityMessages[locale]
    )
  })

  it("falls back to Chinese for an unsupported language", () => {
    expect(i18n.t("desktopActivity.title", { lng: "de-DE" })).toBe(
      desktopActivityMessages["zh-CN"].title
    )
  })
})
