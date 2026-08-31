import type { ReactNode } from "react"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  InfoIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { cn } from "@/lib/utils"

type StatusBannerProps = {
  children: ReactNode
  title?: ReactNode
  variant?: "info" | "success" | "warning" | "error"
  actions?: ReactNode
  className?: string
  hideIcon?: boolean
}

const iconByVariant = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: TriangleAlertIcon,
  error: AlertCircleIcon,
}

export function StatusBanner({
  children,
  title,
  actions,
  className,
  hideIcon = false,
  variant = "info",
}: StatusBannerProps) {
  const Icon = iconByVariant[variant]
  return (
    <Alert
      variant={variant === "error" ? "destructive" : "default"}
      className={cn(
        "status-banner items-center border-0",
        `status-banner-${variant}`,
        className
      )}
      role={variant === "error" ? "alert" : "status"}
    >
      {!hideIcon && (
        <Icon className="size-4 shrink-0 translate-y-0!" aria-hidden="true" />
      )}
      <div className="flex min-h-5 min-w-0 flex-1 flex-col justify-center">
        {title && (
          <AlertTitle className="text-[var(--app-text)]">{title}</AlertTitle>
        )}
        <AlertDescription className="text-[length:var(--app-font-13)] leading-5 text-[var(--app-muted)]">
          {children}
        </AlertDescription>
      </div>
      {actions && (
        <AlertAction className="static shrink-0 self-center">
          {actions}
        </AlertAction>
      )}
    </Alert>
  )
}
