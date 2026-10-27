import { TbPinFilled } from "react-icons/tb"
import { useTranslation } from "react-i18next"
import { useRef } from "react"
import type { Project } from "@linksense/shared"

import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { ProjectIcon } from "@/features/projects/project-icon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ActionTooltipContent,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const tooltipHoverDelay = 300
const actionButtonClassName =
  "w-5 text-[var(--app-muted)] transition-none hover:bg-transparent hover:text-[var(--app-text)] aria-expanded:bg-transparent dark:hover:bg-transparent"

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

export function SidebarConversationActions({
  title,
  pinned,
  pinDisabled,
  archiveDisabled,
  moveDisabled = false,
  projects = [],
  currentProjectId = null,
  onTogglePinned,
  onArchive,
  onMoveToProject,
}: SidebarConversationActionsProps) {
  const { t } = useTranslation()
  const actionsRef = useRef<HTMLDivElement>(null)
  const pinLabel = t(pinned ? "conversation.unpin" : "conversation.pin")
  const archiveLabel = t("conversation.archive")

  return (
    <TooltipProvider delay={tooltipHoverDelay}>
      <div
        ref={actionsRef}
        className="sidebar-conversation-actions pointer-events-none absolute top-1/2 right-1 flex -translate-y-1/2 cursor-default items-center gap-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100 has-data-[popup-open]:pointer-events-auto has-data-[popup-open]:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip>
          <TooltipTrigger
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
            <DesignIcon name="archive" />
          </TooltipTrigger>
          <ActionTooltipContent side="top">{archiveLabel}</ActionTooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger
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
            <DesignIcon name="more" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            anchor={() => actionsRef.current?.parentElement ?? null}
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
                    // Include the parent menu's 8px padding in the visible 8px gap.
                    sideOffset={16}
                    alignOffset={-8}
                    className="w-55 max-w-[calc(100vw-2rem)] p-2"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        disabled={moveDisabled || currentProjectId === null}
                        onClick={() => onMoveToProject(null)}
                      >
                        <span className="truncate">
                          {t("projects.projectless")}
                        </span>
                      </DropdownMenuItem>
                      {projects.map((project) => (
                        <DropdownMenuItem
                          key={project.id}
                          disabled={
                            moveDisabled || project.id === currentProjectId
                          }
                          onClick={() => onMoveToProject(project.id)}
                        >
                          <ProjectIcon
                            icon={project.icon}
                            color={project.color}
                          />
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
        </DropdownMenu>
      </div>
    </TooltipProvider>
  )
}
