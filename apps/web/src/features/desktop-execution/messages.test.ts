import { describe, expect, it } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n from "@/i18n"
import { desktopExecutionMessages } from "./messages"

describe("desktop execution messages", () => {
  it("provides every key in every supported locale", () => {
    const sourceKeys = Object.keys(desktopExecutionMessages["en-US"]).sort()
    for (const locale of supportedLocales) {
      expect(
        Object.keys(desktopExecutionMessages[locale]).sort(),
        locale
      ).toEqual(sourceKeys)
    }
  })

  it("authors every value in its own locale", () => {
    for (const locale of supportedLocales) {
      const messages = desktopExecutionMessages[locale]
      for (const value of Object.values(messages)) {
        expect(value.trim(), locale).not.toBe("")
      }
      if (locale !== "zh-CN") {
        for (const [key, value] of Object.entries(messages)) {
          expect(value, `${locale}.${key}`).not.toBe(
            desktopExecutionMessages["zh-CN"][
              key as keyof (typeof desktopExecutionMessages)["zh-CN"]
            ]
          )
        }
      }
    }
  })

  it("is merged into i18next for every supported locale", () => {
    for (const locale of supportedLocales) {
      for (const key of Object.keys(
        desktopExecutionMessages[locale]
      ) as (keyof (typeof desktopExecutionMessages)["zh-CN"])[]) {
        expect(
          i18n.t(`desktopExecution.${key}`, { lng: locale }),
          `${locale}.${key}`
        ).toBe(desktopExecutionMessages[locale][key])
      }
    }
  })

  it("falls back to zh-CN when a locale bundle is missing", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const key of [
      "cloudTargetUnavailable",
      "noTargetAvailable",
      "deviceChanged",
    ] as const) {
      expect(fallback.t(`desktopExecution.${key}`, { lng: "en-US" })).toBe(
        desktopExecutionMessages["zh-CN"][key]
      )
    }
  })
})
