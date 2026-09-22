import { createInstance, type i18n } from "i18next"
import { translationsEn } from "pptx-react-viewer/i18n"

import { normalizeLanguage, supportedLanguages } from "@/i18n"

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

const translationsEs: Record<string, string> = {
  "common.loading": "Cargando",
  "pptx.canvas.slide": "Diapositiva",
  "pptx.slidesPanel.goToSlide": "Ir a la diapositiva {{n}}",
  "pptx.statusBar.noSlides": "No hay diapositivas",
  "pptx.statusBar.slideOf": "Diapositiva {{current}} de {{total}}",
  "pptx.viewer.background": "Fondo",
  "pptx.viewer.encrypted":
    "Esta presentación está protegida con contraseña y no se puede abrir.",
  "pptx.viewer.loadError": "No se pudo cargar la presentación.",
  "pptx.viewer.loading": "Cargando la presentación",
  "pptx.viewer.slide": "Diapositiva",
  "pptx.viewer.slideEditorAria": "Vista previa de la diapositiva",
  "pptx.zoom.slidePreviewAlt": "Vista previa de la diapositiva {{number}}",
}

const translationsPt: Record<string, string> = {
  "common.loading": "Carregando",
  "pptx.canvas.slide": "Slide",
  "pptx.slidesPanel.goToSlide": "Ir para o slide {{n}}",
  "pptx.statusBar.noSlides": "Nenhum slide",
  "pptx.statusBar.slideOf": "Slide {{current}} de {{total}}",
  "pptx.viewer.background": "Plano de fundo",
  "pptx.viewer.encrypted":
    "Esta apresentação é protegida por senha e não pode ser aberta.",
  "pptx.viewer.loadError": "Não foi possível carregar a apresentação.",
  "pptx.viewer.loading": "Carregando a apresentação",
  "pptx.viewer.slide": "Slide",
  "pptx.viewer.slideEditorAria": "Pré-visualização do slide",
  "pptx.zoom.slidePreviewAlt": "Pré-visualização do slide {{number}}",
}

const translationsFr: Record<string, string> = {
  "common.loading": "Chargement",
  "pptx.canvas.slide": "Diapositive",
  "pptx.slidesPanel.goToSlide": "Aller à la diapositive {{n}}",
  "pptx.statusBar.noSlides": "Aucune diapositive",
  "pptx.statusBar.slideOf": "Diapositive {{current}} sur {{total}}",
  "pptx.viewer.background": "Arrière-plan",
  "pptx.viewer.encrypted":
    "Cette présentation est protégée par un mot de passe et ne peut pas être ouverte.",
  "pptx.viewer.loadError": "Impossible de charger la présentation.",
  "pptx.viewer.loading": "Chargement de la présentation",
  "pptx.viewer.slide": "Diapositive",
  "pptx.viewer.slideEditorAria": "Aperçu de la diapositive",
  "pptx.zoom.slidePreviewAlt": "Aperçu de la diapositive {{number}}",
}

const translationsJa: Record<string, string> = {
  "common.loading": "読み込み中",
  "pptx.canvas.slide": "スライド",
  "pptx.slidesPanel.goToSlide": "スライド{{n}}へ移動",
  "pptx.statusBar.noSlides": "スライドがありません",
  "pptx.statusBar.slideOf": "{{current}} / {{total}} 枚目",
  "pptx.viewer.background": "背景",
  "pptx.viewer.encrypted":
    "このプレゼンテーションはパスワードで保護されているため、開けません。",
  "pptx.viewer.loadError": "プレゼンテーションを読み込めませんでした。",
  "pptx.viewer.loading": "プレゼンテーションを読み込み中",
  "pptx.viewer.slide": "スライド",
  "pptx.viewer.slideEditorAria": "スライドのプレビュー",
  "pptx.zoom.slidePreviewAlt": "スライド{{number}}のプレビュー",
}

export function normalizePresentationViewerLanguage(language?: string) {
  return normalizeLanguage(language) ?? "en-US"
}

export function createPresentationViewerI18n(language?: string): i18n {
  const instance = createInstance()
  void instance.init({
    resources: {
      "en-US": { translation: presentationTranslationsEn },
      "zh-CN": { translation: translationsZh },
      "es-ES": { translation: translationsEs },
      "pt-BR": { translation: translationsPt },
      "fr-FR": { translation: translationsFr },
      "ja-JP": { translation: translationsJa },
    },
    lng: normalizePresentationViewerLanguage(language),
    fallbackLng: "en-US",
    supportedLngs: supportedLanguages,
    keySeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  })
  return instance
}
