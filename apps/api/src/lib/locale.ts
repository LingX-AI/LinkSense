import type { FastifyRequest } from "fastify"
import type { Locale } from "@linksense/shared"

export function resolveLocale(
  request: FastifyRequest,
  preferred?: string | null,
  fallback: Locale = "zh-CN",
): Locale {
  if (preferred === "zh-CN" || preferred === "en-US") return preferred
  const acceptLanguage = request.headers["accept-language"]?.toLowerCase() ?? ""
  if (acceptLanguage.includes("en")) return "en-US"
  return fallback
}
