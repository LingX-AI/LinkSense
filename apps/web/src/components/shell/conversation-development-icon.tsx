import type { ConversationApplicationDevelopmentRole } from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { ApplicationIconDisplay } from "@/features/applications/application-icon"
import { cn } from "@/lib/utils"

export function ConversationDevelopmentIcon({
  role,
  className,
}: Readonly<{
  role?: ConversationApplicationDevelopmentRole | null
  className?: string
}>) {
  const { t } = useTranslation()
  if (!role) return null
  const label = t(
    role === "development"
      ? "applicationDevelopment.developmentTask"
      : "applicationDevelopment.previewTask"
  )
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "conversation-development-icon flex size-5 shrink-0 items-center justify-center",
        className
      )}
    >
      <ApplicationIconDisplay
        icon={{ type: "preset", preset: "code-xml" }}
        compact
        className="size-5"
      />
    </span>
  )
}
