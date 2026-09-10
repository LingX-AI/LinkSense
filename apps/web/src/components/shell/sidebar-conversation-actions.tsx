import { ArchiveIcon } from "lucide-react"
import { TbPin, TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const tooltipHoverDelay = 300

type SidebarConversationActionsProps = {
  title: string
  pinned: boolean
  pinDisabled: boolean
  archiveDisabled: boolean
  onTogglePinned: () => void
  onArchive: () => void
}

export function SidebarConversationActions({
  title,
  pinned,
  pinDisabled,
  archiveDisabled,
  onTogglePinned,
  onArchive,
}: SidebarConversationActionsProps) {
  const { t } = useTranslation()
  const pinLabel = t(pinned ? "conversation.unpin" : "conversation.pin")
  const archiveLabel = t("conversation.archive")

  return (
    <TooltipProvider delay={tooltipHoverDelay}>
      <div
        className="sidebar-conversation-actions pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 cursor-default items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="w-5 text-[var(--app-muted)] transition-none hover:bg-transparent hover:text-[var(--app-text)] dark:hover:bg-transparent"
                aria-label={t(
                  pinned ? "conversation.unpinNamed" : "conversation.pinNamed",
                  { title }
                )}
                disabled={pinDisabled}
                onClick={onTogglePinned}
              />
            }
          >
            {pinned ? (
              <TbPinFilled
                className="size-4"
                data-icon="sidebar-pin-filled"
                aria-hidden="true"
              />
            ) : (
              <TbPin
                className="size-4"
                data-icon="sidebar-pin"
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
          </TooltipTrigger>
          <ActionTooltipContent side="top">{pinLabel}</ActionTooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="w-5 text-[var(--app-muted)] transition-none hover:bg-transparent hover:text-[var(--app-text)] dark:hover:bg-transparent"
                aria-label={t("conversation.archiveNamed", { title })}
                disabled={archiveDisabled}
                onClick={onArchive}
              />
            }
          >
            <ArchiveIcon
              className="size-3.5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </TooltipTrigger>
          <ActionTooltipContent side="top">{archiveLabel}</ActionTooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
