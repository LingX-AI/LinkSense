import { describe, expect, it } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n, { supportedLanguages } from "@/i18n"

import { desktopComputerUseMessages } from "./messages"

const source = desktopComputerUseMessages["zh-CN"]
const sourceKeys = Object.keys(source).sort()

function interpolationTokens(value: string): string[] {
  return [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort()
}

describe("desktop computer use messages", () => {
  it.each(supportedLocales)(
    "defines every authored message in %s",
    (locale) => {
      const messages = desktopComputerUseMessages[locale]
      expect(Object.keys(messages).sort()).toEqual(sourceKeys)
      for (const key of sourceKeys) {
        const value = messages[key as keyof typeof messages]
        expect(value.trim(), `${locale}.${key}`).not.toBe("")
        expect(interpolationTokens(value), `${locale}.${key}`).toEqual(
          interpolationTokens(source[key as keyof typeof source])
        )
        if (locale !== "zh-CN") {
          expect(value, `${locale}.${key}`).not.toBe(
            source[key as keyof typeof source]
          )
        }
      }
    }
  )

  it.each(supportedLanguages)("registers the namespace in %s", (locale) => {
    expect(
      i18n.getResource(locale, "translation", "desktopComputerUse")
    ).toEqual(desktopComputerUseMessages[locale])
  })

  it("falls back to zh-CN when a locale bundle is missing", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    expect(fallback.t("desktopComputerUse.errorBusy", { lng: "en-US" })).toBe(
      desktopComputerUseMessages["zh-CN"].errorBusy
    )
  })
})
