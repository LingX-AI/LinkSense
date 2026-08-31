import { createInstance, type i18n } from "i18next"
import { translationsEn } from "pptx-react-viewer/i18n"

const presentationTranslationsEn: Record<string, string> = {
  ...translationsEn,
  "common.loading": "Loading",
  "pptx.viewer.loading": "Loading presentation",
}

const translationsZh: Record<string, string> = {
  "common.loading": "正在加载",
  "pptx.canvas.slide": "幻灯片",
  "pptx.slidesPanel.goToSlide": "转到第 {{n}} 页",
  "pptx.statusBar.noSlides": "没有幻灯片",
  "pptx.statusBar.slideOf": "第 {{current}} / {{total}} 页",
  "pptx.viewer.background": "背景",
  "pptx.viewer.encrypted": "此演示文稿受密码保护，无法打开。",
  "pptx.viewer.loadError": "演示文稿加载失败。",
  "pptx.viewer.loading": "正在加载演示文稿",
  "pptx.viewer.slide": "幻灯片",
  "pptx.viewer.slideEditorAria": "幻灯片预览",
  "pptx.zoom.slidePreviewAlt": "第 {{number}} 页预览",
}

export function normalizePresentationViewerLanguage(language?: string) {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN"
}

export function createPresentationViewerI18n(language?: string): i18n {
  const instance = createInstance()
  void instance.init({
    resources: {
      "en-US": { translation: presentationTranslationsEn },
      "zh-CN": { translation: translationsZh },
    },
    lng: normalizePresentationViewerLanguage(language),
    fallbackLng: "en-US",
    supportedLngs: ["zh-CN", "en-US"],
    keySeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  })
  return instance
}
