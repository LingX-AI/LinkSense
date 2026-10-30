import type { ReactNode } from "react"
import { DesignIcon } from "@/components/ui/design-icon"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

export function SidebarTaskSection({
  titleId,
  label,
  action,
  children,
}: {
  titleId: string
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Collapsible
      defaultOpen
      render={<section aria-labelledby={titleId} />}
      className="flex flex-col gap-2"
    >
      <div className="group/tasks-heading flex min-h-10 items-center text-muted-foreground">
        <h2
          id={titleId}
          className="min-w-0 flex-1 text-xs leading-[var(--app-line-18)] font-normal"
        >
          <CollapsibleTrigger className="group/section-trigger flex h-10 w-full items-center gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <span className="truncate">{label}</span>
            <DesignIcon
              name="chevron-down"
              className="-rotate-90 opacity-0 transition-[transform,opacity] duration-150 group-hover/tasks-heading:opacity-100 group-has-data-[popup-open]/tasks-heading:opacity-100 group-has-[:focus-visible]/tasks-heading:opacity-100 group-aria-expanded/section-trigger:rotate-0 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
            />
          </CollapsibleTrigger>
        </h2>
        <div className="flex shrink-0 items-center [&_button]:pointer-events-none [&_button]:size-10 [&_button]:text-muted-foreground [&_button]:opacity-0 group-hover/tasks-heading:[&_button]:pointer-events-auto group-hover/tasks-heading:[&_button]:opacity-100 group-has-[:focus-visible]/tasks-heading:[&_button]:pointer-events-auto group-has-[:focus-visible]/tasks-heading:[&_button]:opacity-100 has-data-[popup-open]:[&_button]:pointer-events-auto has-data-[popup-open]:[&_button]:opacity-100 [@media(hover:none)]:[&_button]:pointer-events-auto [@media(hover:none)]:[&_button]:opacity-100">
          {action}
        </div>
      </div>
      <CollapsibleContent
        keepMounted
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none"
      >
        <div className="flex flex-col gap-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
