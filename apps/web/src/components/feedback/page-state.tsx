import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { StatusBanner } from "@/components/feedback/status-banner"
import { cn } from "@/lib/utils"

export function LoadingState({
  label,
  fullScreen = false,
}: {
  label?: string
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "page-state page-state-loading",
        fullScreen &&
          "page-state-loading-fullscreen fixed inset-0 z-50 bg-background"
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="shimmer">{label ?? t("common.pageLoading")}</span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  return (
    <StatusBanner
      variant="error"
      actions={
        onRetry ? (
          <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      {message}
    </StatusBanner>
  )
}
