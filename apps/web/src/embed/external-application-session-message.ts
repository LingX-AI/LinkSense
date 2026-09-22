import { isLocale, type Locale } from "@linksense/shared"

export type ExternalApplicationSessionMessage = Readonly<{
  sessionId: string | null
}>

export type EmbedLocale = Locale

export function embedLocaleFromMessage(
  message: Record<string, unknown>,
  appId: string
): EmbedLocale | undefined {
  if (message.appId !== appId || message.type !== "linksense:locale") {
    return undefined
  }
  return isLocale(message.locale) ? message.locale : undefined
}

export function embedExternalApplicationSessionFromMessage(
  message: Record<string, unknown>,
  appId: string
): ExternalApplicationSessionMessage | undefined {
  if (
    message.appId !== appId ||
    (message.type !== "linksense:ticket" &&
      message.type !== "linksense:session-id")
  ) {
    return undefined
  }
  const sessionId = optionalBoundedString(message, "sessionId", 16_384, false)
  if (sessionId === undefined) return undefined
  return { sessionId }
}

function optionalBoundedString(
  message: Record<string, unknown>,
  key: string,
  maxLength: number,
  trim = true
): string | null | undefined {
  const value = message[key]
  if (value === undefined || value === null) return null
  if (typeof value !== "string") return undefined
  const normalized = trim ? value.trim() : value
  return normalized.trim().length > 0 &&
    normalized.length <= maxLength &&
    !/[\r\n]/u.test(normalized)
    ? normalized
    : undefined
}
