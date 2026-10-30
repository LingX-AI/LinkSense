import { useContext, useRef, useState, type ReactNode } from "react"
import { useSortable } from "@dnd-kit/sortable"
import type { Project } from "@linksense/shared"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { DesignIcon } from "@/components/ui/design-icon"
import { Spinner } from "@/components/ui/spinner"
import { ProjectIcon } from "./project-icon"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProjectAction } from "./project-dialog"
import {
  readSidebarProjectOpen,
  rememberSidebarProjectOpen,
} from "./sidebar-project-preference"
import { SidebarDropIndicator } from "@/features/conversations/sidebar-drop-indicator"
import {
  SidebarConversationDragState,
  projectDropId,
} from "@/features/conversations/sidebar-conversation-drag-state"

export function SidebarTaskGroup({
  userId,
  project,
  label,
  hasRunningTasks = false,
  children,
  onAction,
}: {
  userId: string | undefined
  project?: Project
  label: string
  hasRunningTasks?: boolean
  children: ReactNode
  onAction: (action: ProjectAction) => void
}) {
  const { t } = useTranslation()
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(() =>
    userId && project ? readSidebarProjectOpen(userId, project.id) : true
  )
  const showRunningIndicator = !open && hasRunningTasks
  const { disabled, projectsDisabled } = useContext(
    SidebarConversationDragState
  )
  const {
    setNodeRef,
    setActivatorNodeRef,
    isOver,
    active,
    isDragging,
    listeners,
    attributes,
    index,
  } = useSortable({
    id: projectDropId(project?.id ?? label),
    disabled: {
      draggable: projectsDisabled || !project,
      droppable: (disabled && projectsDisabled) || !project,
    },
    data: { projectOpen: open },
    transition: null,
    animateLayoutChanges: () => false,
  })
  if (!project)
    return (
      <section aria-label={label} className="flex flex-col gap-0.5">
        <h2 className="px-2.5 py-1 text-[length:var(--app-font-13)] leading-[var(--app-ui-compact-line-height)] font-semibold text-muted-foreground">
          {label}
        </h2>
        {children}
      </section>
    )

  return (
    <Collapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (userId) rememberSidebarProjectOpen(userId, project.id, nextOpen)
      }}
      render={
        <section
          aria-label={project.name}
          className="relative [--sidebar-conversation-indent:1.5rem]"
        />
      }
    >
      <div
        ref={setNodeRef}
        data-drop-target={isOver || undefined}
        data-dragging={isDragging || undefined}
        className="group/project relative min-w-0 rounded-lg hover:bg-[var(--app-sidebar-hover)] has-data-[popup-open]:bg-[var(--app-sidebar-hover)] has-[:focus-visible]:bg-[var(--app-sidebar-hover)] data-[drop-target]:bg-[var(--app-sidebar-hover)]"
      >
        <CollapsibleTrigger
          onPointerDown={(event) => listeners?.onPointerDown?.(event)}
          draggable={false}
          render={
            <Button
              type="button"
              variant="ghost"
              className={cn(
                "h-10 w-full min-w-0 justify-start gap-2 rounded-lg pr-10 pl-2 font-normal hover:bg-transparent aria-expanded:bg-transparent",
                showRunningIndicator && "[@media(hover:none)]:pr-14",
                !projectsDisabled && "cursor-grab active:cursor-grabbing"
              )}
            />
          }
        >
          <ProjectIcon
            icon={project.icon}
            color={project.color}
            open={open}
            className="size-4"
          />
          <span
            className="min-w-0 flex-1 truncate text-left text-sm"
            title={active ? undefined : project.name}
          >
            {project.name}
          </span>
        </CollapsibleTrigger>
        <Button
          ref={setActivatorNodeRef}
          type="button"
          className="sr-only"
          disabled={projectsDisabled}
          {...attributes}
          {...listeners}
          aria-label={t("projects.reorderHandle", {
            title: project.name,
            position: index + 1,
          })}
        >
          {t("projects.reorderHandle", {
            title: project.name,
            position: index + 1,
          })}
        </Button>
        {showRunningIndicator && (
          <span
            role="status"
            aria-label={t("statuses.running")}
            className="pointer-events-none absolute top-1/2 right-2.5 flex -translate-y-1/2 items-center text-[var(--app-muted)] group-hover/project:opacity-0 group-has-data-[popup-open]/project:opacity-0 group-has-[:focus-visible]/project:opacity-0 [@media(hover:none)]:right-8"
          >
            <Spinner className="size-3.5 [animation-duration:1.5s] motion-reduce:animate-none" />
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                ref={menuTriggerRef}
                className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-has-[:focus-visible]/project:pointer-events-auto group-has-[:focus-visible]/project:opacity-100 hover:bg-transparent aria-expanded:bg-transparent data-popup-open:pointer-events-auto data-popup-open:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                aria-label={t("common.moreActionsNamed", {
                  name: project.name,
                })}
              />
            }
          >
            <DesignIcon name="more" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            sideOffset={8}
            anchor={() => menuTriggerRef.current?.parentElement ?? null}
            align="start"
            className="w-55 p-2"
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => onAction({ mode: "edit", project })}
              >
                <PencilIcon className="mx-px size-3.5" />
                {t("projects.editAction")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction({ mode: "delete", project })}
              >
                <Trash2Icon />
                {t("projects.delete")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarDropIndicator targetId={projectDropId(project.id)} />
      </div>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none">
        <div className="flex flex-col gap-2 pt-2">{children}</div>
      </CollapsibleContent>
      <SidebarDropIndicator
        targetId={projectDropId(project.id)}
        scope="project"
      />
    </Collapsible>
  )
}
