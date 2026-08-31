import { useTranslation } from "react-i18next"

import { Marker, MarkerContent } from "@/components/ui/marker"
import { normalizeLanguage } from "@/i18n"
import {
  formatConversationTimeSeparatorParts,
  formatLongDateTime,
} from "@/i18n/date"

export function ConversationTimeSeparator({
  timestamp,
}: {
  timestamp: string | null | undefined
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const parts = formatConversationTimeSeparatorParts(timestamp, language)
  if (!timestamp || !parts) return null

  const label = t(`conversation.timeSeparator.${parts.kind}`, parts)
  const fullTime = formatLongDateTime(timestamp, language)

  return (
    <Marker
      className="justify-center py-6"
      role="separator"
      aria-label={t("conversation.timeSeparator.accessibleLabel", {
        time: fullTime,
      })}
    >
      <MarkerContent className="text-xs">
        <time dateTime={timestamp} title={fullTime}>
          {label}
        </time>
      </MarkerContent>
    </Marker>
  )
}
