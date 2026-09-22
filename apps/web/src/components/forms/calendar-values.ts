import dayjs from "dayjs"
import { enUS, es, fr, ja, ptBR, zhCN, type Locale } from "date-fns/locale"
import type { SupportedLanguage } from "@/i18n"

export const DATE_VALUE_FORMAT = "YYYY-MM-DD"

export const calendarLocales: Record<SupportedLanguage, Locale> = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "es-ES": es,
  "pt-BR": ptBR,
  "fr-FR": fr,
  "ja-JP": ja,
}

export function parseDateValue(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format(DATE_VALUE_FORMAT) !== value)
    return undefined
  return parsed.startOf("day").toDate()
}
