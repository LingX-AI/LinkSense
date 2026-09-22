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

  it.each([
    ["es-MX", "Cargando la presentación", "Ir a la diapositiva 2"],
    ["pt-PT", "Carregando a apresentação", "Ir para o slide 2"],
    ["fr-CA", "Chargement de la présentation", "Aller à la diapositive 2"],
    ["ja", "プレゼンテーションを読み込み中", "スライド2へ移動"],
  ])(
    "uses manually translated viewer labels for %s",
    (language, loading, goToSlide) => {
      const i18n = createPresentationViewerI18n(language)

      expect(i18n.t("pptx.viewer.loading")).toBe(loading)
      expect(i18n.t("pptx.slidesPanel.goToSlide", { n: 2 })).toBe(goToSlide)
      expect(i18n.t("pptx.toolbar.readOnly")).toBe("Read-only")
    }
  )

  it("does not replace the app-wide react-i18next instance", () => {
    expect(getI18n()).toBe(appI18n)

    createPresentationViewerI18n("zh-CN")

    expect(getI18n()).toBe(appI18n)
  })
})
