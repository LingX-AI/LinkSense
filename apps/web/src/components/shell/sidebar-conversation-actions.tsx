import { useEffect, useId, useRef } from "react"
import { TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import type { Project } from "@linksense/shared"

import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { HeaderIcon } from "@/components/ui/header-icon-button"
import { SidebarActionIcon } from "./sidebar-action-icon"
import { SidebarMoreIcon } from "./sidebar-more-icon"
import { ProjectIcon } from "@/features/projects/project-icon"
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipTrigger } from "@/components/ui/tooltip"
import { useSidebarConversationOverlays } from "./sidebar-conversation-overlays-state"

const tooltipHoverDelay = 300
const actionButtonClassName =
  "text-[var(--app-sidebar-action)] transition-none hover:bg-transparent hover:text-[var(--app-text)] aria-expanded:bg-transparent aria-expanded:text-[var(--app-text)] dark:hover:bg-transparent"

type SidebarConversationActionsProps = {
  title: string
  pinned: boolean
  pinDisabled: boolean
  archiveDisabled: boolean
  moveDisabled?: boolean
  projects?: Pick<Project, "id" | "name" | "icon" | "color">[]
  currentProjectId?: string | null
  onTogglePinned: () => void
  onArchive: () => void
  onMoveToProject?: (projectId: string | null) => void
}

export type SidebarConversationMenuPayload = SidebarConversationActionsProps & {
  anchor: () => HTMLElement | null
}

export function SidebarConversationActions(
  props: SidebarConversationActionsProps
) {
  const { t } = useTranslation()
  const handles = useSidebarConversationOverlays()
  const actionsRef = useRef<HTMLDivElement>(null)
  const archiveTriggerId = useId()
  const { tooltip, tooltipTriggerId } = handles
  useEffect(
    () => () => {
      if (tooltipTriggerId.current === archiveTriggerId) tooltip.close()
    },
    [tooltip, tooltipTriggerId, archiveTriggerId]
  )
  const { title, archiveDisabled, onArchive } = props
  return (
    <div
      ref={actionsRef}
      className="sidebar-conversation-actions pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 cursor-default items-center opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 has-data-[popup-open]:pointer-events-auto has-data-[popup-open]:opacity-100"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <TooltipTrigger
        id={archiveTriggerId}
        handle={handles.tooltip}
        payload={t("conversation.archive")}
        delay={tooltipHoverDelay}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={actionButtonClassName}
            aria-label={t("conversation.archiveNamed", { title })}
            disabled={archiveDisabled}
            onClick={onArchive}
          />
        }
      >
        <SidebarActionIcon>
          <HeaderIcon name="archive" className="size-4" />
        </SidebarActionIcon>
      </TooltipTrigger>
      <DropdownMenuTrigger
        handle={handles.menu}
        payload={{
          ...props,
          anchor: () => actionsRef.current?.parentElement ?? null,
        }}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={actionButtonClassName}
            aria-label={t("common.moreActionsNamed", { name: title })}
          />
        }
      >
        <SidebarMoreIcon />
      </DropdownMenuTrigger>
    </div>
  )
}

export function SidebarConversationMenu({
  anchor,
  pinned,
  pinDisabled,
  moveDisabled = false,
  projects = [],
  currentProjectId = null,
  onTogglePinned,
  onMoveToProject,
}: SidebarConversationMenuPayload) {
  const { t } = useTranslation()
  const pinLabel = t(pinned ? "conversation.unpin" : "conversation.pin")

  return (
    <DropdownMenuContent
      anchor={anchor}
      side="right"
      sideOffset={8}
      align="start"
      className="w-55 p-2 [&_[data-slot=dropdown-menu-item]]:min-h-8 [&_[data-slot=dropdown-menu-item]]:font-normal"
    >
      <DropdownMenuGroup>
        {onMoveToProject && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={moveDisabled}>
              <DesignIcon name="move-project" />
              {t("projects.move")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              side="right"
              sideOffset={16}
              alignOffset={-8}
              className="w-55 max-w-[calc(100vw-2rem)] p-2"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={moveDisabled || currentProjectId === null}
                  onClick={() => onMoveToProject(null)}
                >
                  <span className="truncate">{t("projects.projectless")}</span>
                </DropdownMenuItem>
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    disabled={moveDisabled || project.id === currentProjectId}
                    onClick={() => onMoveToProject(project.id)}
                  >
                    <ProjectIcon icon={project.icon} color={project.color} />
                    <span className="truncate" title={project.name}>
                      {project.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuItem disabled={pinDisabled} onClick={onTogglePinned}>
          {pinned ? (
            <TbPinFilled
              className="size-4"
              data-icon="sidebar-pin-filled"
              aria-hidden="true"
            />
          ) : (
            <DesignIcon name="pin" />
          )}
          {pinLabel}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}
