import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardFooter, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export const catalogResourceListClassName =
  "@container/catalog-list flex min-w-0 flex-col overflow-clip rounded-xl border border-divider bg-card [&>:not(:last-child)]:border-b [&>:not(:last-child)]:border-divider"

const interactiveElementSelector =
  "a,button,input,select,textarea,label,[contenteditable=true],[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]"

export function CatalogResourceRow({
  name,
  icon,
  children,
  summary,
  actions,
  onActivate,
}: {
  name: string
  icon: ReactNode
  children: ReactNode
  summary: ReactNode
  actions?: ReactNode
  onActivate?: () => void
}) {
  return (
    <Card
      role="article"
      aria-label={name}
      data-layout="row"
      className={cn(
        "relative min-h-19 min-w-0 justify-center gap-0 rounded-none border-0 bg-transparent px-3 py-3 shadow-none transition-colors focus-within:bg-(--app-hover-subtle) hover:bg-(--app-hover-subtle) sm:px-4",
        onActivate && "cursor-pointer"
      )}
      onClick={
        onActivate
          ? (event) => {
              if (
                event.target instanceof Element &&
                event.target.closest(interactiveElementSelector)
              )
                return
              onActivate()
            }
          : undefined
      }
    >
      <CardHeader className="@container-normal min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 p-0 has-data-[slot=card-description]:grid-rows-none @min-[42rem]/catalog-list:grid-cols-[2.5rem_minmax(0,1fr)_minmax(8rem,0.34fr)_minmax(7rem,0.28fr)] @min-[42rem]/catalog-list:items-center @min-[42rem]/catalog-list:gap-x-4">
        {icon}
        <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
          {children}
        </div>
        <CardFooter className="col-span-full row-start-2 min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 p-0 @min-[42rem]/catalog-list:contents">
          <div
            data-slot="catalog-resource-summary"
            className="flex min-w-0 flex-1 basis-28 flex-col gap-1 text-xs leading-[var(--app-line-18)] wrap-anywhere text-muted-foreground empty:hidden @min-[42rem]/catalog-list:col-start-3 @min-[42rem]/catalog-list:row-start-1"
          >
            {summary}
          </div>
          {actions && (
            <div
              data-slot="catalog-resource-actions"
              className="relative z-10 ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5 empty:hidden @min-[42rem]/catalog-list:col-start-4 @min-[42rem]/catalog-list:row-start-1 [&_[aria-haspopup=menu]]:min-w-8 [&_[aria-haspopup=menu]]:rounded-md pointer-coarse:[&_[aria-haspopup=menu]]:min-w-11 [&_[aria-haspopup=menu]:hover]:bg-(--app-sidebar-action-hover) [&_[aria-haspopup=menu][data-popup-open]]:bg-(--app-sidebar-action-hover) [&>[data-slot=button]]:h-auto [&>[data-slot=button]]:min-h-8 [&>[data-slot=button]]:max-w-full [&>[data-slot=button]]:wrap-anywhere [&>[data-slot=button]]:whitespace-normal pointer-coarse:[&>[data-slot=button]]:min-h-11"
            >
              {actions}
            </div>
          )}
        </CardFooter>
      </CardHeader>
    </Card>
  )
}

export function CatalogResourceStatus({
  positive = false,
  children,
}: {
  positive?: boolean
  children: ReactNode
}) {
  return (
    <Badge
      variant="outline"
      weight="normal"
      className="h-auto min-h-5 max-w-full items-center justify-start gap-1.5 text-left leading-[var(--app-line-16)] wrap-anywhere whitespace-normal"
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          positive ? "bg-success" : "bg-muted-foreground"
        )}
      />
      {children}
    </Badge>
  )
}
