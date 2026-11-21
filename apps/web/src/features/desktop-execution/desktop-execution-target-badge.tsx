import { CloudIcon, LaptopIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ConversationExecutionTarget } from "@linksense/shared"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function DesktopExecutionTargetBadge({
  target,
  className,
}: Readonly<{
  target: ConversationExecutionTarget
  className?: string
}>) {
  const { t } = useTranslation()
  const label =
    target === "local"
      ? t("desktopExecution.local")
      : t("desktopExecution.cloud")
  const accessibleLabel = t("desktopExecution.targetBadge", { target: label })
  const Icon = target === "local" ? LaptopIcon : CloudIcon

  return (
    <Badge
      variant="tag"
      size="sm"
      className={cn(
        "gap-1 font-normal text-muted-foreground [&>svg]:size-3",
        className
      )}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  )
}
