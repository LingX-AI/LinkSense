import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"

export const supportedLanguages = ["zh-CN", "en-US"] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

const LANGUAGE_STORAGE_KEY = "linksense.language"

export function normalizeLanguage(
  value: string | null | undefined
): SupportedLanguage | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized.startsWith("zh")) return "zh-CN"
  if (normalized.startsWith("en")) return "en-US"
  return null
}

export function resolveBrowserLanguage(
  languages: readonly string[] | undefined,
  language: string | null | undefined
): SupportedLanguage {
  const candidates = languages?.length ? languages : language ? [language] : []
  for (const candidate of candidates) {
    const normalized = normalizeLanguage(candidate)
    if (normalized) return normalized
  }
  return "en-US"
}

function resolveInitialLanguage(): SupportedLanguage {
  let stored: SupportedLanguage | null
  try {
    stored = normalizeLanguage(
      window.localStorage?.getItem(LANGUAGE_STORAGE_KEY)
    )
  } catch {
    stored = null
  }
  if (stored) return stored
  return resolveBrowserLanguage(
    window.navigator.languages,
    window.navigator.language
  )
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: "zh-CN",
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on("languageChanged", (language) => {
  const normalized = normalizeLanguage(language) ?? "zh-CN"
  document.documentElement.lang = normalized
})

document.documentElement.lang =
  normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"

export async function setAppLanguage(
  language: SupportedLanguage,
  options: { persist?: boolean } = {}
) {
  await i18n.changeLanguage(language)
  if (options.persist === false) return
  try {
    window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Language switching remains available when browser storage is disabled.
  }
}

export function hasStoredLanguagePreference() {
  try {
    return window.localStorage?.getItem(LANGUAGE_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export default i18n
