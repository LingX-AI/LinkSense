// @vitest-environment node
import { createInstance } from "i18next"
import { supportedLocales } from "@linksense/shared"
import { describe, expect, it } from "vitest"
import { modelSetupMessages } from "./model-setup-messages"

const resources = Object.fromEntries(
  Object.entries(modelSetupMessages).map(([locale, messages]) => [
    locale,
    { translation: { modelSetup: messages } },
  ])
)

describe("model setup translations", () => {
  it("covers all supported locales with matching keys and interpolation parameters", () => {
    expect(Object.keys(modelSetupMessages).sort()).toEqual(
      [...supportedLocales].sort()
    )
    const reference = Object.keys(modelSetupMessages["zh-CN"]).sort()
    for (const messages of Object.values(modelSetupMessages)) {
      expect(Object.keys(messages).sort()).toEqual(reference)
      for (const [key, value] of Object.entries(messages)) {
        const original =
          Object.entries(modelSetupMessages["zh-CN"]).find(
            ([name]) => name === key
          )?.[1] ?? ""
        expect(
          [...value.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token)
        ).toEqual(
          [...original.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token)
        )
        expect(value.trim()).not.toBe("")
      }
    }
  })

  it.each(supportedLocales)(
    "renders model setup status in %s",
    async (locale) => {
      const instance = createInstance()
      await instance.init({ resources, lng: locale, fallbackLng: "zh-CN" })
      expect(instance.t("modelSetup.advanced")).toBe(
        modelSetupMessages[locale].advanced
      )
      expect(
        instance.t("modelSetup.testSuccess", { model: "demo-model" })
      ).toBe(
        modelSetupMessages[locale].testSuccess.replace(
          "{{model}}",
          "demo-model"
        )
      )
      expect(instance.t("modelSetup.contextKnown", { count: 128000 })).toBe(
        modelSetupMessages[locale].contextKnown.replace("{{count}}", "128000")
      )
    }
  )

  it("uses Simplified Chinese for unsupported languages", async () => {
    const instance = createInstance()
    await instance.init({ resources, lng: "de-DE", fallbackLng: "zh-CN" })
    expect(instance.t("modelSetup.advanced")).toBe(
      modelSetupMessages["zh-CN"].advanced
    )
  })
})
