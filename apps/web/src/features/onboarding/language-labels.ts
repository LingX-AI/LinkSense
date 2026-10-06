import type { SupportedLanguage } from "@/i18n"

const languageLabelKeys = {
  "zh-CN": "common.chinese",
  "en-US": "common.english",
  "es-ES": "common.spanish",
  "pt-BR": "common.portuguese",
  "fr-FR": "common.french",
  "ja-JP": "common.japanese",
} as const satisfies Record<SupportedLanguage, string>

export function languageLabelKey(language: SupportedLanguage) {
  return languageLabelKeys[language]
}
