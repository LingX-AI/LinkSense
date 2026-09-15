import { describe, expect, it } from "vitest"
import i18n from "@/i18n"
import { zhCN } from "@/i18n/zh-CN"
import { enUS } from "@/i18n/en-US"

describe("diagram translations", () => {
  it("provides matching Chinese and English keys and Chinese fallback", () => {
    expect(Object.keys(zhCN.conversation.diagram)).toEqual(
      Object.keys(enUS.conversation.diagram)
    )
    const instance = i18n.cloneInstance({ forkResourceStore: true })
    instance.removeResourceBundle("en-US", "translation")
    for (const [key, chinese] of Object.entries(zhCN.conversation.diagram)) {
      expect(i18n.t(`conversation.diagram.${key}`, { lng: "zh-CN" })).toBe(
        chinese
      )
      expect(i18n.t(`conversation.diagram.${key}`, { lng: "en-US" })).not.toBe(
        `conversation.diagram.${key}`
      )
      expect(instance.t(`conversation.diagram.${key}`, { lng: "en-US" })).toBe(
        chinese
      )
    }
  })
})
