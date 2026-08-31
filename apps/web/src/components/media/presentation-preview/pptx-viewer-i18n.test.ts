import { describe, expect, it } from "vitest"
import { getI18n } from "react-i18next"

import { createPresentationViewerI18n } from "@/components/media/presentation-preview/pptx-viewer-i18n"
import appI18n from "@/i18n"

describe("presentation viewer i18n", () => {
  it("uses Chinese viewer labels without exposing raw translation keys", () => {
    const i18n = createPresentationViewerI18n("zh-CN")

    expect(i18n.t("pptx.viewer.loading")).toBe("正在加载演示文稿")
    expect(i18n.t("pptx.slidesPanel.goToSlide", { n: 3 })).toBe("转到第 3 页")
    expect(i18n.t("pptx.toolbar.readOnly")).toBe("Read-only")
    expect(i18n.t("pptx.toolbar.readOnly")).not.toContain("pptx.")
  })

  it("uses the canonical English dictionary for English", () => {
    const i18n = createPresentationViewerI18n("en-US")

    expect(i18n.t("pptx.viewer.loading")).toBe("Loading presentation")
    expect(i18n.t("pptx.slidesPanel.goToSlide", { n: 2 })).toBe("Go to slide 2")
  })

  it("does not replace the app-wide react-i18next instance", () => {
    expect(getI18n()).toBe(appI18n)

    createPresentationViewerI18n("zh-CN")

    expect(getI18n()).toBe(appI18n)
  })
})
