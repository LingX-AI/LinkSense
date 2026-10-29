import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { ShellHeaderActions } from "@/components/shell/shell-header-actions"

export function PageTopBar({
  title,
  actions,
  className,
}: {
  title: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-top-bar"
      className={cn(
        "sticky top-0 z-20 flex h-16.5 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 pl-14 text-foreground md:px-7 [.app-shell[data-sidebar-collapsed=true]_&]:pl-13",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="min-w-0 truncate text-base font-medium"
      >
        {title}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <ShellHeaderActions />
      </div>
    </div>
  )
}
