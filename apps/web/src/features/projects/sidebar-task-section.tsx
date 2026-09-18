import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"

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
      className="flex flex-col gap-0.5"
    >
      <div className="group/tasks-heading flex items-center justify-between gap-2 pr-0.5 pb-1 pl-2.5">
        <h2
          id={titleId}
          className="min-w-0 flex-1 text-[length:var(--app-font-13)] leading-[var(--app-ui-compact-line-height)] font-semibold text-[var(--app-muted)]"
        >
          <CollapsibleTrigger className="group/section-trigger flex min-h-7 w-full items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {label}
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover/tasks-heading:opacity-100 group-has-[:focus-visible]/tasks-heading:opacity-100 group-aria-expanded/section-trigger:rotate-90 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
            />
          </CollapsibleTrigger>
        </h2>
        {action}
      </div>
      <CollapsibleContent
        keepMounted
        className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none"
      >
        <div className="flex flex-col gap-0.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
