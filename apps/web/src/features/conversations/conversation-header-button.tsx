import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function ConversationHeaderButton({
  label,
  id,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size"> & {
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        id={id}
        render={
          <Button
            {...props}
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn("size-9 text-foreground", className)}
            aria-label={label}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <ActionTooltipContent side="bottom">{label}</ActionTooltipContent>
    </Tooltip>
  )
}
