import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import utc from "dayjs/plugin/utc"
import timezone from "dayjs/plugin/timezone"
import "dayjs/locale/en"
import "dayjs/locale/zh-cn"

import type { SupportedLanguage } from "@/i18n"

dayjs.extend(relativeTime)
dayjs.extend(utc)
dayjs.extend(timezone)

export function formatRelativeDate(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed.locale(language === "zh-CN" ? "zh-cn" : "en").fromNow()
}

export function formatDateTime(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  return parsed
    .locale(language === "zh-CN" ? "zh-cn" : "en")
    .format("YYYY-MM-DD HH:mm")
}

export function formatLongDateTime(
  value: string | null | undefined,
  language: SupportedLanguage
) {
  if (!value) return "—"
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  const localized = parsed.locale(language === "zh-CN" ? "zh-cn" : "en")
  return localized.format(
    language === "zh-CN" ? "YYYY年M月D日，HH:mm" : "MMM D, YYYY, HH:mm"
  )
}

export function formatCalendarDate(
  value: string,
  language: SupportedLanguage
): string {
  const parsed = dayjs(value)
  if (!parsed.isValid()) return "—"
  const localized = parsed.locale(language === "zh-CN" ? "zh-cn" : "en")
  return localized.format(language === "zh-CN" ? "YYYY年M月D日" : "MMM D, YYYY")
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
  const locale = language === "zh-CN" ? "zh-cn" : "en"
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
  return parsed.locale(language === "zh-CN" ? "zh-cn" : "en").format("HH:mm")
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
  const localized = parsed.locale(language === "zh-CN" ? "zh-cn" : "en")
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

  const locale = language === "zh-CN" ? "zh-cn" : "en"
  const localized = parsed.locale(locale)
  const time = localized.format("H:mm")
  if (parsed.isSame(now, "day")) return { kind: "today", time }
  if (parsed.isSame(now.subtract(1, "day"), "day")) {
    return { kind: "yesterday", time }
  }
  if (parsed.isSame(now, "year")) {
    return {
      kind: "sameYear",
      date: localized.format(language === "zh-CN" ? "M月D日" : "MMM D"),
      time,
    }
  }
  return {
    kind: "otherYear",
    date: localized.format(
      language === "zh-CN" ? "YYYY年M月D日" : "MMM D, YYYY"
    ),
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
