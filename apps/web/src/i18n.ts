import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import {
  auditTranslationResource,
  supportedLocales,
  type Locale,
} from "@linksense/shared"

import { enUS } from "@/i18n/en-US"
import { esES } from "@/i18n/es-ES"
import { frFR } from "@/i18n/fr-FR"
import { jaJP } from "@/i18n/ja-JP"
import { ptBR } from "@/i18n/pt-BR"
import { zhCN } from "@/i18n/zh-CN"

export const supportedLanguages = supportedLocales
export type SupportedLanguage = Locale

const LANGUAGE_STORAGE_KEY = "linksense.language"

export function normalizeLanguage(
  value: string | null | undefined
): SupportedLanguage | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized.startsWith("zh")) return "zh-CN"
  if (normalized.startsWith("en")) return "en-US"
  if (normalized.startsWith("es")) return "es-ES"
  if (normalized.startsWith("pt")) return "pt-BR"
  if (normalized.startsWith("fr")) return "fr-FR"
  if (normalized.startsWith("ja")) return "ja-JP"
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
    "zh-CN": {
      translation: {
        ...zhCN,
        auditValues: auditTranslationResource("zh-CN"),
      },
    },
    "en-US": {
      translation: {
        ...enUS,
        auditValues: auditTranslationResource("en-US"),
      },
    },
    "es-ES": {
      translation: {
        ...esES,
        auditValues: auditTranslationResource("es-ES"),
      },
    },
    "pt-BR": {
      translation: {
        ...ptBR,
        auditValues: auditTranslationResource("pt-BR"),
      },
    },
    "fr-FR": {
      translation: {
        ...frFR,
        auditValues: auditTranslationResource("fr-FR"),
      },
    },
    "ja-JP": {
      translation: {
        ...jaJP,
        auditValues: auditTranslationResource("ja-JP"),
      },
    },
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
  const currentLanguage = normalizeLanguage(
    i18n.language ?? i18n.resolvedLanguage
  )
  if (currentLanguage !== language) {
    await i18n.changeLanguage(language)
  } else if (document.documentElement.lang !== language) {
    document.documentElement.lang = language
  }
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
