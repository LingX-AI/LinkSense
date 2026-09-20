import { useContext, useMemo, type ReactNode } from "react"
import { SortableContext, type SortingStrategy } from "@dnd-kit/sortable"
import type { Project } from "@linksense/shared"
import { PlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { Conversation } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { sortSidebarConversations } from "@/features/conversations/conversation-order"
import { SidebarTaskSortMenu } from "@/features/conversations/sidebar-task-sort-menu"
import {
  defaultSidebarTaskSortModes,
  type SidebarTaskSortMode,
  type SidebarTaskSortModes,
  type SidebarTaskSortScope,
} from "@/features/conversations/sidebar-task-sort-preference"
import { SidebarTaskGroup } from "./sidebar-task-group"
import { SidebarTaskSection } from "./sidebar-task-section"
import type { ProjectAction } from "./project-dialog"
import {
  SidebarConversationDragState,
  projectDropId,
} from "@/features/conversations/sidebar-conversation-drag-state"

const stationaryProjectStrategy: SortingStrategy = () => null

export type SidebarTaskGroupData = {
  orderGroup: "pinned" | "recent"
  projectId: string | null
  conversations: Conversation[]
}

export function SidebarTaskGroups({
  userId,
  pinned,
  recent,
  projects,
  loadingMore,
  sortModes = defaultSidebarTaskSortModes,
  onSortModeChange,
  onAction,
  children,
}: {
  userId: string | undefined
  pinned: Conversation[]
  recent: Conversation[]
  projects: Project[]
  loadingMore: boolean
  sortModes?: SidebarTaskSortModes
  onSortModeChange?: (
    scope: SidebarTaskSortScope,
    mode: SidebarTaskSortMode
  ) => void
  onAction: (action: ProjectAction) => void
  children: (group: SidebarTaskGroupData) => ReactNode
}) {
  const { t } = useTranslation()
  const { pendingProjectOrder } = useContext(SidebarConversationDragState)
  const orderedProjects = useMemo(() => {
    if (!pendingProjectOrder) return projects
    const positions = new Map(
      pendingProjectOrder.map((id, index) => [id, index])
    )
    return [...projects].sort(
      (left, right) =>
        (positions.get(left.id) ?? Infinity) -
        (positions.get(right.id) ?? Infinity)
    )
  }, [projects, pendingProjectOrder])
  const projectIds = useMemo(
    () => orderedProjects.map((project) => projectDropId(project.id)),
    [orderedProjects]
  )
  const byProject = new Map<string | null, Conversation[]>()
  for (const conversation of recent) {
    const tasks = byProject.get(conversation.project_id) ?? []
    tasks.push(conversation)
    byProject.set(conversation.project_id, tasks)
  }
  for (const [projectId, tasks] of byProject) {
    byProject.set(
      projectId,
      sortSidebarConversations(
        tasks,
        projectId === null ? sortModes.recent : sortModes.projects
      )
    )
  }
  const sortedPinned = sortSidebarConversations(pinned, sortModes.pinned)
  const sortMenu = (scope: SidebarTaskSortScope, sectionLabel: string) => (
    <SidebarTaskSortMenu
      sectionLabel={sectionLabel}
      value={sortModes[scope]}
      onValueChange={(mode) => onSortModeChange?.(scope, mode)}
    />
  )
  const renderProject = (id: string | null) =>
    children({
      orderGroup: "recent",
      projectId: id,
      conversations: byProject.get(id) ?? [],
    })
  const unavailableIds = [...byProject.keys()].filter(
    (id) => id !== null && !projects.some((project) => project.id === id)
  )
  return (
    <>
      {sortedPinned.length > 0 && (
        <SidebarTaskSection
          key={JSON.stringify([userId, "pinned"])}
          titleId="pinned-conversations-title"
          label={t("nav.pinned")}
          action={sortMenu("pinned", t("nav.pinned"))}
        >
          {children({
            orderGroup: "pinned",
            projectId: null,
            conversations: sortedPinned,
          })}
        </SidebarTaskSection>
      )}
      <SidebarTaskSection
        key={JSON.stringify([userId, "projects"])}
        titleId="sidebar-projects-title"
        label={t("nav.projects")}
        action={
          <>
            {sortMenu("projects", t("nav.projects"))}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="pointer-events-none opacity-0 group-hover/tasks-heading:pointer-events-auto group-hover/tasks-heading:opacity-100 group-has-[:focus-visible]/tasks-heading:pointer-events-auto group-has-[:focus-visible]/tasks-heading:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
              aria-label={t("projects.create")}
              onClick={() => onAction({ mode: "create" })}
            >
              <PlusIcon />
            </Button>
          </>
        }
      >
        <SortableContext
          items={projectIds}
          strategy={stationaryProjectStrategy}
        >
          {orderedProjects.map((project) => (
            <SidebarTaskGroup
              key={JSON.stringify([userId, project.id])}
              userId={userId}
              label={project.name}
              project={project}
              onAction={onAction}
            >
              {renderProject(project.id)}
              {!loadingMore && !byProject.get(project.id)?.length && (
                <p className="py-2 pr-2.5 pl-[calc(8px+var(--sidebar-conversation-indent))] text-[length:var(--app-font-13)] leading-[var(--app-ui-compact-line-height)] text-muted-foreground">
                  {t("projects.empty")}
                </p>
              )}
            </SidebarTaskGroup>
          ))}
        </SortableContext>
        {unavailableIds.map((id) => (
          <SidebarTaskGroup
            key={id}
            userId={userId}
            label={t("projects.unavailable")}
            onAction={onAction}
          >
            {renderProject(id)}
          </SidebarTaskGroup>
        ))}
      </SidebarTaskSection>
      <SidebarTaskSection
        key={JSON.stringify([userId, "recent"])}
        titleId="recent-conversations-title"
        label={t("nav.recent")}
        action={sortMenu("recent", t("nav.recent"))}
      >
        {byProject.has(null) && renderProject(null)}
      </SidebarTaskSection>
    </>
  )
}
