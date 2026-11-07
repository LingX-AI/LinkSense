import type { ComponentProps } from "react"

import { HeaderIconButton } from "@/components/ui/header-icon-button"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ConversationHeaderButton({
  label,
  id,
  className,
  children,
  ...props
}: ComponentProps<typeof HeaderIconButton> & {
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        id={id}
        render={
          <HeaderIconButton
            {...props}
            type="button"
            className={className}
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
