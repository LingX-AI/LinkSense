import { InfoIcon } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { useProductName } from "@/app/product-branding"
import { ProductLogo } from "@/components/brand/product-logo"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
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
  variant = "default",
  fill = false,
  fullScreen = false,
}: {
  label?: string
  variant?: "default" | "workspace"
  fill?: boolean
  fullScreen?: boolean
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  if (variant === "workspace" && !fullScreen) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className={cn(
          "flex min-h-95 min-w-0 flex-col items-center justify-center gap-4 px-4",
          fill && "size-full"
        )}
      >
        {["first", "second"].map((group) => (
          <div
            key={group}
            aria-hidden="true"
            className="flex h-25 w-full max-w-128 flex-col gap-3"
          >
            <Skeleton className="h-4 w-15/16 rounded-lg motion-reduce:animate-none" />
            <Skeleton className="h-4 w-45/64 rounded-lg motion-reduce:animate-none" />
            <Skeleton className="h-4 w-55/64 rounded-lg motion-reduce:animate-none" />
          </div>
        ))}
        <div className="flex w-full max-w-128 flex-col gap-2">
          <span className="text-sm leading-[var(--app-line-22)] text-muted-foreground">
            {label ?? t("common.pageLoading")}
          </span>
          <Progress
            value={null}
            aria-label={label ?? t("common.pageLoading")}
          />
        </div>
      </div>
    )
  }
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
  variant = "default",
}: {
  message: string
  onRetry?: () => void
  variant?: "default" | "workspace"
}) {
  const { t } = useTranslation()
  if (variant === "workspace") {
    return (
      <div
        role="alert"
        className="flex min-h-95 min-w-0 flex-col items-center justify-center gap-4 px-4"
      >
        <span aria-hidden="true" className="size-6 text-destructive-text">
          <DesignIcon name="status-error" className="size-5" />
        </span>
        <p className="w-full max-w-128 text-center text-base leading-6 font-medium wrap-anywhere text-destructive-text">
          {message}
        </p>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            className="min-w-22"
            onClick={onRetry}
          >
            {t("common.retry")}
          </Button>
        )}
      </div>
    )
  }
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
