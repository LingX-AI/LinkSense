import { CalendarClockIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

export function ConversationAutomationIcon({
  hasAutomation,
}: {
  hasAutomation: boolean
}) {
  const { t } = useTranslation()
  if (!hasAutomation) return null

  const label = t("nav.automationTask")
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="sidebar-conversation-automation-icon flex size-5 shrink-0 items-center justify-center text-[var(--app-muted)]"
    >
      <CalendarClockIcon
        className="size-4"
        strokeWidth={2}
        aria-hidden="true"
      />
    </span>
  )
}
