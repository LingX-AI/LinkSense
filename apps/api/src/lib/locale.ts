import type { FastifyRequest } from "fastify"
import { isLocale, type Locale } from "@linksense/shared"

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null
  if (isLocale(value)) return value
  const normalized = value.toLowerCase()
  if (normalized.startsWith("zh")) return "zh-CN"
  if (normalized.startsWith("en")) return "en-US"
  if (normalized.startsWith("es")) return "es-ES"
  if (normalized.startsWith("pt")) return "pt-BR"
  if (normalized.startsWith("fr")) return "fr-FR"
  if (normalized.startsWith("ja")) return "ja-JP"
  return null
}

export function resolveLocale(
  request: FastifyRequest,
  preferred?: string | null,
  fallback: Locale = "zh-CN",
): Locale {
  const preferredLocale = normalizeLocale(preferred)
  if (preferredLocale) return preferredLocale
  const acceptLanguages = request.headers["accept-language"]?.split(",") ?? []
  for (const language of acceptLanguages) {
    const locale = normalizeLocale(language.split(";", 1)[0]?.trim())
    if (locale) return locale
  }
  return fallback
}
