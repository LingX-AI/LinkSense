import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Place inside a relative group with pr-8 so its action rail stays in the hover area. */
export function AssistantPreviewActions({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div
      className="assistant-html-preview-actions absolute top-2 right-0 z-20 flex w-8 flex-col gap-1 pl-2"
      role="toolbar"
      aria-label={label}
      aria-orientation="vertical"
    >
      {children}
    </div>
  )
}

export function AssistantPreviewAction({
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            {...props}
            aria-label={label}
          />
        }
      />
      <ActionTooltipContent side="left">{label}</ActionTooltipContent>
    </Tooltip>
  )
}
