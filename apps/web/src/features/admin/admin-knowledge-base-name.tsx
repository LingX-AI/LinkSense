import { useRef } from "react"

import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function AdminKnowledgeBaseName({ name }: { name: string }) {
  const nameRef = useRef<HTMLElement>(null)

  return (
    <Tooltip
      onOpenChange={(open, details) => {
        if (!open) return
        const element = nameRef.current
        if (
          !element ||
          (element.scrollHeight <= element.clientHeight &&
            element.scrollWidth <= element.clientWidth)
        ) {
          details.cancel()
        }
      }}
    >
      <TooltipTrigger
        render={<strong ref={nameRef} />}
        tabIndex={0}
        className="line-clamp-2 min-w-0 leading-[var(--app-line-22)] wrap-anywhere whitespace-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {name}
      </TooltipTrigger>
      <ActionTooltipContent
        side="top"
        align="start"
        className="max-w-sm wrap-anywhere whitespace-normal"
      >
        {name}
      </ActionTooltipContent>
    </Tooltip>
  )
}
