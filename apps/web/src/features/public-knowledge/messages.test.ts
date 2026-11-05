import { describe, expect, it } from "vitest"
import { createInstance } from "i18next"
import { supportedLocales } from "@linksense/shared"
import { publicKnowledgeMessages } from "./messages"

describe("public knowledge translations", () => {
  it.each(supportedLocales)(
    "provides every message and consistent interpolation in %s",
    (locale) => {
      const keys = Object.keys(publicKnowledgeMessages["zh-CN"]).sort()
      expect(Object.keys(publicKnowledgeMessages[locale]).sort()).toEqual(keys)
      for (const key of keys) {
        const name = key as keyof (typeof publicKnowledgeMessages)["zh-CN"]
        const value = publicKnowledgeMessages[locale][name]
        expect(value.trim()).not.toBe("")
        expect(value.match(/\{\{[^}]+\}\}/gu) ?? []).toEqual(
          publicKnowledgeMessages["zh-CN"][name].match(/\{\{[^}]+\}\}/gu) ?? []
        )
      }
    }
  )
  it("falls back to Simplified Chinese for an unsupported locale", async () => {
    const instance = createInstance()
    await instance.init({
      lng: "unknown",
      fallbackLng: "zh-CN",
      resources: Object.fromEntries(
        supportedLocales.map((locale) => [
          locale,
          { translation: publicKnowledgeMessages[locale] },
        ])
      ),
    })
    expect(instance.t("title")).toBe(publicKnowledgeMessages["zh-CN"].title)
    expect(instance.t("privacy", { days: 30 })).not.toContain("{{days}}")
  })
})
