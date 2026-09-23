import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import type { Coordinates } from "@dnd-kit/utilities"
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import type { Project } from "@linksense/shared"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { ProjectIcon } from "@/features/projects/project-icon"
import type { Conversation } from "@/api/contracts"
import {
  reorderConversationIds,
  sortSidebarConversations,
} from "./conversation-order"
import {
  defaultSidebarTaskSortModes,
  type SidebarTaskSortMode,
  type SidebarTaskSortModes,
  type SidebarTaskSortScope,
} from "./sidebar-task-sort-preference"
import {
  SidebarConversationDragState,
  SidebarConversationDropTargetContext,
  type SidebarConversationDropTarget,
  inSameConversationOrderGroup,
  projectDropId,
} from "./sidebar-conversation-drag-state"
import { useSuppressClickAfterDrag } from "./use-suppress-click-after-drag"

type ReorderRequest = {
  group: "pinned" | "recent"
  projectId: string | null
  conversationIds: string[]
}

const pointerSensorOptions = { activationConstraint: { distance: 4 } }

export function SidebarConversationDnd({
  conversations,
  projects,
  disabled,
  projectSortingDisabled = disabled,
  sortModes = defaultSidebarTaskSortModes,
  onMove,
  onReorder,
  onReorderProjects,
  onSortModeChange,
  onError,
  children,
}: {
  conversations: readonly Conversation[]
  projects: readonly Project[]
  disabled: boolean
  projectSortingDisabled?: boolean
  sortModes?: SidebarTaskSortModes
  onMove: (conversationId: string, projectId: string) => Promise<unknown>
  onReorder: (request: ReorderRequest) => Promise<unknown>
  onReorderProjects: (projectIds: string[]) => Promise<unknown>
  onSortModeChange?: (
    scope: SidebarTaskSortScope,
    mode: SidebarTaskSortMode
  ) => void
  onError: (error: unknown) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] =
    useState<SidebarConversationDropTarget | null>(null)
  const pointerPosition = useRef<Coordinates | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [pendingProjectOrder, setPendingProjectOrder] = useState<
    string[] | null
  >(null)
  const [projectOpen, setProjectOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [announcement, setAnnouncement] = useState("")
  const clickSuppression = useSuppressClickAfterDrag()
  const tasks = useMemo(
    () => new Map(conversations.map((task) => [task.id, task])),
    [conversations]
  )
  const destinations = useMemo(
    () =>
      new Map(projects.map((project) => [projectDropId(project.id), project])),
    [projects]
  )
  const orders = useMemo(() => {
    const groups = new Map<string, Conversation[]>()
    for (const task of conversations) {
      const key = task.pinned_at ? "pinned" : `project:${task.project_id ?? ""}`
      const group = groups.get(key) ?? []
      group.push(task)
      groups.set(key, group)
    }
    const byTaskId = new Map<string, string[]>()
    const positions = new Map<string, number>()
    for (const group of groups.values()) {
      const first = group[0]
      const scope = first?.pinned_at
        ? "pinned"
        : first?.project_id
          ? "projects"
          : "recent"
      const ids = sortSidebarConversations(group, sortModes[scope]).map(
        (task) => task.id
      )
      ids.forEach((id, index) => {
        byTaskId.set(id, ids)
        positions.set(id, index + 1)
      })
    }
    return { byTaskId, positions }
  }, [conversations, sortModes])
  const projectOrder = useMemo(() => [...destinations.keys()], [destinations])
  const dragState = useMemo(
    () => ({
      disabled: disabled || saving,
      projectsDisabled: projectSortingDisabled || saving,
      pendingOrder,
      pendingProjectOrder,
    }),
    [
      disabled,
      projectSortingDisabled,
      saving,
      pendingOrder,
      pendingProjectOrder,
    ]
  )
  const activeTask = activeId ? tasks.get(activeId) : undefined
  const activeProject = activeId ? destinations.get(activeId) : undefined

  const isEligibleTarget = useCallback(
    (sourceId: UniqueIdentifier, targetId: UniqueIdentifier) => {
      if (savingRef.current) return false
      if (destinations.has(String(sourceId)))
        return !projectSortingDisabled && destinations.has(String(targetId))
      const source = tasks.get(String(sourceId))
      if (!source || disabled || savingRef.current) return false
      const project = destinations.get(String(targetId))
      if (project)
        return (
          source.application_development_role !== "development" &&
          source.project_id !== project.id
        )
      const target = tasks.get(String(targetId))
      return Boolean(target && inSameConversationOrderGroup(source, target))
    },
    [disabled, projectSortingDisabled, tasks, destinations]
  )
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      pointerPosition.current = args.pointerCoordinates
      const droppableContainers = args.droppableContainers.filter((target) =>
        isEligibleTarget(args.active.id, target.id)
      )
      // A pointer must actually enter a row/header. Releasing outside the sidebar
      // must not move a task to whichever project happens to be closest.
      return args.pointerCoordinates
        ? pointerWithin({ ...args, droppableContainers })
        : closestCenter({ ...args, droppableContainers })
    },
    [isEligibleTarget]
  )
  const keyboardCoordinates: KeyboardCoordinateGetter = useCallback(
    (event, args) =>
      sortableKeyboardCoordinates(event, {
        ...args,
        context: {
          ...args.context,
          droppableRects: new Map(
            [...args.context.droppableRects].filter(([id]) =>
              isEligibleTarget(args.active, id)
            )
          ),
        },
      }),
    [isEligibleTarget]
  )
  const keyboardSensorOptions = useMemo(
    () => ({ coordinateGetter: keyboardCoordinates }),
    [keyboardCoordinates]
  )
  const sensors = useSensors(
    useSensor(PointerSensor, pointerSensorOptions),
    useSensor(KeyboardSensor, keyboardSensorOptions)
  )
  const title = (id: UniqueIdentifier) =>
    destinations.get(String(id))?.name ||
    tasks.get(String(id))?.title ||
    t("conversation.untitled")
  const position = (id: UniqueIdentifier) =>
    destinations.has(String(id))
      ? projectOrder.indexOf(String(id)) + 1
      : (orders.positions.get(String(id)) ?? 0)
  const reorderNamespace = (id: UniqueIdentifier) =>
    destinations.has(String(id)) ? "projects" : "conversation"
  const resolveDropTarget = ({
    active,
    over,
  }: Pick<
    DragMoveEvent,
    "active" | "over"
  >): SidebarConversationDropTarget | null => {
    if (!over || active.id === over.id || !isEligibleTarget(active.id, over.id))
      return null
    const sortingProject = destinations.has(String(active.id))
    if (!sortingProject && destinations.has(String(over.id)))
      return { kind: "project", id: String(over.id), edge: "after" }
    const point = pointerPosition.current
    const edge = point
      ? point.y < over.rect.top + over.rect.height / 2
        ? "before"
        : "after"
      : position(active.id) > position(over.id)
        ? "before"
        : "after"
    return {
      kind: sortingProject ? "project-reorder" : "reorder",
      id: String(over.id),
      edge,
    }
  }
  const updateDropTarget = (event: DragMoveEvent) => {
    const next = resolveDropTarget(event)
    setDropTarget((current) =>
      current?.id === next?.id &&
      current?.edge === next?.edge &&
      current?.kind === next?.kind
        ? current
        : next
    )
  }
  const orderAtTarget = (
    sourceId: string,
    target: SidebarConversationDropTarget
  ) =>
    reorderConversationIds(
      destinations.has(sourceId)
        ? projectOrder
        : (orders.byTaskId.get(sourceId) ?? []),
      sourceId,
      target.id,
      target.edge
    )

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active } = event
    const target = resolveDropTarget(event)
    clickSuppression.end()
    setActiveId(null)
    setDropTarget(null)
    if (!target) return
    const sourceProject = destinations.get(String(active.id))
    if (sourceProject && target.kind === "project-reorder") {
      const nextOrder = orderAtTarget(String(active.id), target)
      if (nextOrder.every((id, index) => id === projectOrder[index])) return
      const ids = nextOrder.flatMap((id) => {
        const project = destinations.get(id)
        return project ? [project.id] : []
      })
      savingRef.current = true
      setSaving(true)
      setPendingProjectOrder(ids)
      try {
        await onReorderProjects(ids)
        setAnnouncement(
          t("projects.reorderCompleted", {
            title: sourceProject.name,
            position: ids.indexOf(sourceProject.id) + 1,
          })
        )
      } catch (error) {
        setAnnouncement(t("projects.dragSaveFailed"))
        onError(error)
      } finally {
        setPendingProjectOrder(null)
        savingRef.current = false
        setSaving(false)
      }
      return
    }
    const task = tasks.get(String(active.id))
    if (!task) return
    const project =
      target.kind === "project" ? destinations.get(target.id) : undefined
    const ids =
      target.kind === "reorder" ? orderAtTarget(task.id, target) : null
    if (ids?.every((id, index) => id === orders.byTaskId.get(task.id)?.[index]))
      return
    savingRef.current = true
    setSaving(true)
    try {
      if (project) {
        await onMove(task.id, project.id)
        setAnnouncement(
          t("conversation.dragProjectCompleted", {
            title: title(task.id),
            project: project.name,
          })
        )
      } else if (ids) {
        const scope = task.pinned_at
          ? "pinned"
          : task.project_id
            ? "projects"
            : "recent"
        onSortModeChange?.(scope, "manual")
        setPendingOrder(ids)
        await onReorder({
          group: task.pinned_at ? "pinned" : "recent",
          projectId: task.pinned_at ? null : task.project_id,
          conversationIds: ids,
        })
        setAnnouncement(
          t("conversation.reorderCompleted", {
            title: title(task.id),
            position: ids.indexOf(task.id) + 1,
          })
        )
      }
    } catch (error) {
      setAnnouncement(t("conversation.dragSaveFailed"))
      onError(error)
    } finally {
      setPendingOrder(null)
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <SidebarConversationDragState.Provider value={dragState}>
      <SidebarConversationDropTargetContext.Provider value={dropTarget}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          accessibility={{
            screenReaderInstructions: {
              draggable: t("projects.sidebarDragInstructions"),
            },
            announcements: {
              onDragStart: ({ active }) =>
                t(`${reorderNamespace(active.id)}.reorderStarted`, {
                  title: title(active.id),
                  position: position(active.id),
                }),
              onDragOver: (event) => {
                const { active } = event
                const target = resolveDropTarget(event)
                if (!target) return undefined
                const project = destinations.get(target.id)
                return project && target.kind === "project"
                  ? t("conversation.dragProjectOver", {
                      title: title(active.id),
                      project: project.name,
                    })
                  : t(`${reorderNamespace(active.id)}.reorderOver`, {
                      title: title(active.id),
                      position:
                        orderAtTarget(String(active.id), target).indexOf(
                          String(active.id)
                        ) + 1,
                    })
              },
              onDragEnd: ({ active }) => {
                const namespace = reorderNamespace(active.id)
                if (!dropTarget) return t(`${namespace}.reorderCancelled`)
                const sourceId = String(active.id)
                if (
                  dropTarget.kind !== "project" &&
                  orderAtTarget(sourceId, dropTarget).every(
                    (id, index) =>
                      id ===
                      (destinations.has(sourceId)
                        ? projectOrder
                        : orders.byTaskId.get(sourceId))?.[index]
                  )
                )
                  return t(`${namespace}.reorderCancelled`)
                return t(`${namespace}.dragSaving`)
              },
              onDragCancel: ({ active }) =>
                t(`${reorderNamespace(active.id)}.reorderCancelled`),
            },
          }}
          onDragStart={({ active }) => {
            clickSuppression.start()
            setAnnouncement("")
            setDropTarget(null)
            setActiveId(String(active.id))
            setProjectOpen(active.data.current?.projectOpen === true)
          }}
          onDragMove={updateDropTarget}
          onDragOver={updateDropTarget}
          onDragEnd={(event) => void handleDragEnd(event)}
          onDragCancel={() => {
            clickSuppression.end()
            setActiveId(null)
            setDropTarget(null)
          }}
        >
          {children}
          {createPortal(
            <DragOverlay dropAnimation={null}>
              {(activeTask || activeProject) && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none flex h-8 items-center rounded-[10px] bg-popover px-2.5 text-[length:var(--app-ui-font-size)] text-popover-foreground opacity-80 shadow-sm"
                >
                  {activeProject && (
                    <ProjectIcon
                      icon={activeProject.icon}
                      color={activeProject.color}
                      open={projectOpen}
                      className="mr-1.5 size-3.5 shrink-0"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {activeProject?.name ||
                      activeTask?.title ||
                      t("conversation.untitled")}
                  </span>
                </div>
              )}
            </DragOverlay>,
            document.body
          )}
        </DndContext>
        <div role="status" className="sr-only">
          {announcement}
        </div>
      </SidebarConversationDropTargetContext.Provider>
    </SidebarConversationDragState.Provider>
  )
}
