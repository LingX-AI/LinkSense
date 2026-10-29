import { InfoIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"

export function LoadingState({
  label,
  fill = false,
  fullScreen = false,
}: {
  label?: string
  fill?: boolean
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  return (
    <div
      className={cn(
        "page-state page-state-loading",
        fill && "size-full",
        fullScreen &&
          "page-state-loading-fullscreen fixed inset-0 z-50 bg-background"
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {fullScreen && (
        <ProductLogo
          productName={productName}
          className="h-6 motion-safe:animate-pulse sm:h-7"
        />
      )}
      <span className={fullScreen ? "sr-only" : "shimmer"}>
        {label ?? t("common.pageLoading")}
      </span>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  const { t } = useTranslation()
  const normalizedTitle = title.replace(/[。.]+$/u, "")
  const resolvedDescription =
    description === undefined ? t("common.emptyDescription") : description

  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia>
          {icon ?? (
            <InfoIcon
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </EmptyMedia>
        <EmptyTitle>{normalizedTitle}</EmptyTitle>
        {resolvedDescription && (
          <EmptyDescription>{resolvedDescription}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
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
