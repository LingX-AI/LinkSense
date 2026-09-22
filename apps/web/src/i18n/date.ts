import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import utc from "dayjs/plugin/utc"
import timezone from "dayjs/plugin/timezone"
import "dayjs/locale/en"
import "dayjs/locale/es"
import "dayjs/locale/fr"
import "dayjs/locale/ja"
import "dayjs/locale/pt-br"
import "dayjs/locale/zh-cn"

import type { SupportedLanguage } from "@/i18n"

dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.extend(timezone)

const dayjsLocales: Record<SupportedLanguage, string> = {
  "zh-CN": "zh-cn",
  "en-US": "en",
  "es-ES": "es",
  "pt-BR": "pt-br",
  "fr-FR": "fr",
  "ja-JP": "ja",
}

export function dayjsLocaleFor(language: SupportedLanguage) {
  return dayjsLocales[language]
}

export function calendarDateFormatFor(language: SupportedLanguage) {
  if (language === "zh-CN" || language === "ja-JP") return "YYYY年M月D日"
  if (language === "es-ES") return "D [de] MMM [de] YYYY"
  if (language === "pt-BR") return "D [de] MMM [de] YYYY"
  if (language === "fr-FR") return "D MMM YYYY"
  return "MMM D, YYYY"
}

export function monthYearFormatFor(language: SupportedLanguage) {
  if (language === "zh-CN" || language === "ja-JP") return "YYYY年M月"
  if (language === "es-ES" || language === "pt-BR") return "MMM [de] YYYY"
  return "MMM YYYY"
}

export function compactDateFormatFor(language: SupportedLanguage) {
  if (language === "zh-CN" || language === "ja-JP") return "M/D"
  if (language === "fr-FR") return "D MMM"
  return "MMM D"
}

export function shortDateFormatFor(language: SupportedLanguage) {
  if (language === "zh-CN" || language === "ja-JP") return "M月D日"
  if (language === "fr-FR") return "D MMM"
  return "MMM D"
}

export function longMonthYearFormatFor(language: SupportedLanguage) {
  if (language === "zh-CN" || language === "ja-JP") return "YYYY年M月"
  if (language === "es-ES" || language === "pt-BR") return "MMMM [de] YYYY"
  return "MMMM YYYY"
}

export function formatRelativeDate(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed.locale(dayjsLocaleFor(language)).fromNow()
}

export function formatDateTime(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed.locale(dayjsLocaleFor(language)).format("YYYY-MM-DD HH:mm")
}

export function formatLongDateTime(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  const localized = parsed.locale(dayjsLocaleFor(language))
  const separator = language === "zh-CN" || language === "ja-JP" ? "，" : ", "
  return localized.format(`${calendarDateFormatFor(language)}${separator}HH:mm`)
}

export function formatCalendarDate(
  value: string,
  language: SupportedLanguage
): string {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed
    .locale(dayjsLocaleFor(language))
    .format(calendarDateFormatFor(language))
}

export function calendarMonthLabels(
  language: SupportedLanguage
): [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
] {
  const locale = dayjsLocaleFor(language)
  const label = (month: number) =>
    dayjs("2026-01-01").month(month).locale(locale).format("MMM")
  return [
    label(0),
    label(1),
    label(2),
    label(3),
    label(4),
    label(5),
    label(6),
    label(7),
    label(8),
    label(9),
    label(10),
    label(11),
  ]
}

export function formatMessageTime(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return null
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null
  return parsed.locale(dayjsLocaleFor(language)).format("HH:mm")
}

export function formatContextualMessageTime(
  value: string | null | undefined,
  language: SupportedLanguage,
  nowMs = Date.now()
) {
  if (!value) return null
  const parsed = dayjs(value)
  if (!parsed.isValid()) return null

  const now = dayjs(nowMs)
  const localized = parsed.locale(dayjsLocaleFor(language))
  return now.isValid() && parsed.isSame(now, "day")
    ? localized.format("HH:mm")
    : localized.format("YYYY-MM-DD HH:mm")
}

export type ConversationTimeSeparatorParts =
  | Readonly<{ kind: "today"; time: string }>
  | Readonly<{ kind: "yesterday"; time: string }>
  | Readonly<{ kind: "sameYear"; date: string; time: string }>
  | Readonly<{ kind: "otherYear"; date: string; time: string }>

export function formatConversationTimeSeparatorParts(
  value: string | null | undefined,
  language: SupportedLanguage,
  nowMs = Date.now()
): ConversationTimeSeparatorParts | null {
  if (!value) return null
  const parsed = dayjs(value)
  const now = dayjs(nowMs)
  if (!parsed.isValid() || !now.isValid()) return null

  const locale = dayjsLocaleFor(language)
  const localized = parsed.locale(locale)
  const time = localized.format("H:mm")
  if (parsed.isSame(now, "day")) return { kind: "today", time }
  if (parsed.isSame(now.subtract(1, "day"), "day")) {
    return { kind: "yesterday", time }
  }
  if (parsed.isSame(now, "year")) {
    return {
      kind: "sameYear",
      date: localized.format(shortDateFormatFor(language)),
      time,
    }
  }
  return {
    kind: "otherYear",
    date: localized.format(calendarDateFormatFor(language)),
    time,
  }
}

export function formatFileSize(
  value: number | null | undefined,
  language: SupportedLanguage
) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: value >= 1024 * 1024 ? "megabyte" : "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value >= 1024 * 1024 ? value / (1024 * 1024) : value / 1024)
}

export function formatCompactDuration(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  nowMs = Date.now()
): string | null {
  if (!startedAt) return null

  const started = dayjs(startedAt)
  const ended =
    endedAt === null || endedAt === undefined ? dayjs(nowMs) : dayjs(endedAt)
  if (!started.isValid() || !ended.isValid()) return null

  const durationMs = ended.diff(started)
  if (durationMs < 0) return null
  if (durationMs < 1_000) return null

  const totalSeconds = Math.floor(durationMs / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0) parts.push(`${seconds}s`)
  return parts.join(" ")
}
