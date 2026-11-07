import { ArchiveIcon, FolderInputIcon, MoreHorizontalIcon } from "lucide-react"
import { useEffect, useId } from "react"
import { TbPin, TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import type { Project } from "@linksense/shared"

import { Button } from "@/components/ui/button"
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
  "w-5 text-[var(--app-muted)] transition-none hover:bg-transparent hover:text-[var(--app-text)] aria-expanded:bg-transparent dark:hover:bg-transparent"

export type SidebarConversationActionsProps = {
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

export function SidebarConversationActions(
  props: SidebarConversationActionsProps
) {
  const { t } = useTranslation()
  const handles = useSidebarConversationOverlays()
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
      className="sidebar-conversation-actions pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 cursor-default items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 has-data-[popup-open]:pointer-events-auto has-data-[popup-open]:opacity-100"
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
            size="icon-xs"
            className={actionButtonClassName}
            aria-label={t("conversation.archiveNamed", { title })}
            disabled={archiveDisabled}
            onClick={onArchive}
          />
        }
      >
        <ArchiveIcon className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </TooltipTrigger>
      <DropdownMenuTrigger
        handle={handles.menu}
        payload={props}
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={actionButtonClassName}
            aria-label={t("common.moreActionsNamed", { name: title })}
          />
        }
      >
        <MoreHorizontalIcon
          className="size-3.5"
          strokeWidth={2}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
    </div>
  )
}

export function SidebarConversationMenu({
  pinned,
  pinDisabled,
  moveDisabled = false,
  projects = [],
  currentProjectId = null,
  onTogglePinned,
  onMoveToProject,
}: SidebarConversationActionsProps) {
  const { t } = useTranslation()
  const pinLabel = t(pinned ? "conversation.unpin" : "conversation.pin")

  return (
    <DropdownMenuContent align="start" className="w-max min-w-40">
      <DropdownMenuGroup>
        {onMoveToProject && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={moveDisabled}>
              <FolderInputIcon strokeWidth={2} aria-hidden="true" />
              {t("projects.move")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              side="right"
              className="max-w-[min(18rem,calc(100vw-2rem))] min-w-40"
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
            <TbPin
              className="size-4"
              data-icon="sidebar-pin"
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          {pinLabel}
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}
