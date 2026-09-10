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
import type { TaskCategory } from "@linksense/shared"
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { FolderClosedIcon, FolderOpenIcon } from "lucide-react"
import type { Conversation } from "@/api/contracts"
import {
  reorderConversationIds,
  sortSidebarConversations,
} from "./conversation-order"
import {
  SidebarConversationDragState,
  SidebarConversationDropTargetContext,
  type SidebarConversationDropTarget,
  inSameConversationOrderGroup,
  taskCategoryDropId,
} from "./sidebar-conversation-drag-state"
import { useSuppressClickAfterDrag } from "./use-suppress-click-after-drag"

type ReorderRequest = {
  group: "pinned" | "recent"
  categoryId: string | null
  conversationIds: string[]
}

const pointerSensorOptions = { activationConstraint: { distance: 4 } }

export function SidebarConversationDnd({
  conversations,
  categories,
  disabled,
  categorySortingDisabled = disabled,
  onMove,
  onReorder,
  onReorderCategories,
  onError,
  children,
}: {
  conversations: readonly Conversation[]
  categories: readonly TaskCategory[]
  disabled: boolean
  categorySortingDisabled?: boolean
  onMove: (conversationId: string, categoryId: string) => Promise<unknown>
  onReorder: (request: ReorderRequest) => Promise<unknown>
  onReorderCategories: (categoryIds: string[]) => Promise<unknown>
  onError: (error: unknown) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] =
    useState<SidebarConversationDropTarget | null>(null)
  const pointerPosition = useRef<Coordinates | null>(null)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [pendingCategoryOrder, setPendingCategoryOrder] = useState<
    string[] | null
  >(null)
  const [categoryOpen, setCategoryOpen] = useState(false)
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
      new Map(
        categories.map((category) => [
          taskCategoryDropId(category.id),
          category,
        ])
      ),
    [categories]
  )
  const orders = useMemo(() => {
    const groups = new Map<string, Conversation[]>()
    for (const task of conversations) {
      const key = task.pinned_at
        ? "pinned"
        : `category:${task.category_id ?? ""}`
      const group = groups.get(key) ?? []
      group.push(task)
      groups.set(key, group)
    }
    const byTaskId = new Map<string, string[]>()
    const positions = new Map<string, number>()
    for (const group of groups.values()) {
      const ids = sortSidebarConversations(
        group,
        group[0]?.pinned_at ? "pinned" : "recent"
      ).map((task) => task.id)
      ids.forEach((id, index) => {
        byTaskId.set(id, ids)
        positions.set(id, index + 1)
      })
    }
    return { byTaskId, positions }
  }, [conversations])
  const categoryOrder = useMemo(() => [...destinations.keys()], [destinations])
  const dragState = useMemo(
    () => ({
      disabled: disabled || saving,
      categoriesDisabled: categorySortingDisabled || saving,
      pendingOrder,
      pendingCategoryOrder,
    }),
    [
      disabled,
      categorySortingDisabled,
      saving,
      pendingOrder,
      pendingCategoryOrder,
    ]
  )
  const activeTask = activeId ? tasks.get(activeId) : undefined
  const activeCategory = activeId ? destinations.get(activeId) : undefined
  const CategoryIcon = categoryOpen ? FolderOpenIcon : FolderClosedIcon

  const isEligibleTarget = useCallback(
    (sourceId: UniqueIdentifier, targetId: UniqueIdentifier) => {
      if (savingRef.current) return false
      if (destinations.has(String(sourceId)))
        return !categorySortingDisabled && destinations.has(String(targetId))
      const source = tasks.get(String(sourceId))
      if (!source || disabled || savingRef.current) return false
      const category = destinations.get(String(targetId))
      if (category) return source.category_id !== category.id
      const target = tasks.get(String(targetId))
      return Boolean(target && inSameConversationOrderGroup(source, target))
    },
    [disabled, categorySortingDisabled, tasks, destinations]
  )
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      pointerPosition.current = args.pointerCoordinates
      const droppableContainers = args.droppableContainers.filter((target) =>
        isEligibleTarget(args.active.id, target.id)
      )
      // A pointer must actually enter a row/header. Releasing outside the sidebar
      // must not move a task to whichever category happens to be closest.
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
      ? categoryOrder.indexOf(String(id)) + 1
      : (orders.positions.get(String(id)) ?? 0)
  const reorderNamespace = (id: UniqueIdentifier) =>
    destinations.has(String(id)) ? "taskCategories" : "conversation"
  const resolveDropTarget = ({
    active,
    over,
  }: Pick<
    DragMoveEvent,
    "active" | "over"
  >): SidebarConversationDropTarget | null => {
    if (!over || active.id === over.id || !isEligibleTarget(active.id, over.id))
      return null
    const sortingCategory = destinations.has(String(active.id))
    if (!sortingCategory && destinations.has(String(over.id)))
      return { kind: "category", id: String(over.id), edge: "after" }
    const point = pointerPosition.current
    const edge = point
      ? point.y < over.rect.top + over.rect.height / 2
        ? "before"
        : "after"
      : position(active.id) > position(over.id)
        ? "before"
        : "after"
    return {
      kind: sortingCategory ? "category-reorder" : "reorder",
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
        ? categoryOrder
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
    const sourceCategory = destinations.get(String(active.id))
    if (sourceCategory && target.kind === "category-reorder") {
      const nextOrder = orderAtTarget(String(active.id), target)
      if (nextOrder.every((id, index) => id === categoryOrder[index])) return
      const ids = nextOrder.flatMap((id) => {
        const category = destinations.get(id)
        return category ? [category.id] : []
      })
      savingRef.current = true
      setSaving(true)
      setPendingCategoryOrder(ids)
      try {
        await onReorderCategories(ids)
        setAnnouncement(
          t("taskCategories.reorderCompleted", {
            title: sourceCategory.name,
            position: ids.indexOf(sourceCategory.id) + 1,
          })
        )
      } catch (error) {
        setAnnouncement(t("taskCategories.dragSaveFailed"))
        onError(error)
      } finally {
        setPendingCategoryOrder(null)
        savingRef.current = false
        setSaving(false)
      }
      return
    }
    const task = tasks.get(String(active.id))
    if (!task) return
    const category =
      target.kind === "category" ? destinations.get(target.id) : undefined
    const ids =
      target.kind === "reorder" ? orderAtTarget(task.id, target) : null
    if (ids?.every((id, index) => id === orders.byTaskId.get(task.id)?.[index]))
      return
    savingRef.current = true
    setSaving(true)
    try {
      if (category) {
        await onMove(task.id, category.id)
        setAnnouncement(
          t("conversation.dragCategoryCompleted", {
            title: title(task.id),
            category: category.name,
          })
        )
      } else if (ids) {
        setPendingOrder(ids)
        await onReorder({
          group: task.pinned_at ? "pinned" : "recent",
          categoryId: task.pinned_at ? null : task.category_id,
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
              draggable: t("taskCategories.sidebarDragInstructions"),
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
                const category = destinations.get(target.id)
                return category && target.kind === "category"
                  ? t("conversation.dragCategoryOver", {
                      title: title(active.id),
                      category: category.name,
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
                  dropTarget.kind !== "category" &&
                  orderAtTarget(sourceId, dropTarget).every(
                    (id, index) =>
                      id ===
                      (destinations.has(sourceId)
                        ? categoryOrder
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
            setCategoryOpen(active.data.current?.categoryOpen === true)
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
              {(activeTask || activeCategory) && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none flex h-8 items-center rounded-[10px] bg-popover px-2.5 text-[length:var(--app-ui-font-size)] text-popover-foreground opacity-80 shadow-sm"
                >
                  {activeCategory && (
                    <CategoryIcon className="mr-1.5 size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {activeCategory?.name ||
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
