import { Archive, Pin, PinOff } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { SidebarActionIcon } from "./sidebar-action-icon"

const actionButtonClassName =
  "text-[var(--app-sidebar-action)] transition-none hover:bg-transparent hover:text-[var(--app-text)] aria-expanded:bg-transparent aria-expanded:text-[var(--app-text)] dark:hover:bg-transparent"

type SidebarConversationActionsProps = {
  title: string
  pinned: boolean
  pinDisabled: boolean
  archiveDisabled: boolean
  onTogglePinned: () => void
  onArchive: () => void
}

export function SidebarConversationActions(props: SidebarConversationActionsProps) {
  const { t } = useTranslation()
  const {
    title,
    pinned,
    pinDisabled,
    archiveDisabled,
    onTogglePinned,
    onArchive,
  } = props
  return (
    <div
      className="sidebar-conversation-actions pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 cursor-default items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={actionButtonClassName}
        title={t(pinned ? "conversation.unpin" : "conversation.pin")}
        aria-label={t(
          pinned ? "conversation.unpinNamed" : "conversation.pinNamed",
          { title }
        )}
        disabled={pinDisabled}
        onClick={onTogglePinned}
      >
        <SidebarActionIcon>
          {pinned ? (
            <PinOff
              className="size-3.5"
              data-icon="sidebar-pin-off"
              aria-hidden="true"
            />
          ) : (
            <Pin className="size-4" aria-hidden="true" />
          )}
        </SidebarActionIcon>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={actionButtonClassName}
        title={t("conversation.archive")}
        aria-label={t("conversation.archiveNamed", { title })}
        disabled={archiveDisabled}
        onClick={onArchive}
      >
        <SidebarActionIcon>
          <Archive className="size-3.5 -translate-y-px" aria-hidden="true" />
        </SidebarActionIcon>
      </Button>
    </div>
  )
}
