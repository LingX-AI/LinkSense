import { useContext, useMemo, type ReactNode } from "react"
import { SortableContext, type SortingStrategy } from "@dnd-kit/sortable"
import type { TaskCategory } from "@linksense/shared"
import { PlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { Conversation } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { SidebarTaskGroup } from "./sidebar-task-group"
import type { TaskCategoryAction } from "./task-category-dialog"
import {
  SidebarConversationDragState,
  taskCategoryDropId,
} from "@/features/conversations/sidebar-conversation-drag-state"

const stationaryCategoryStrategy: SortingStrategy = () => null

export type SidebarTaskGroupData = {
  orderGroup: "pinned" | "recent"
  categoryId: string | null
  conversations: Conversation[]
}

export function SidebarTaskGroups({
  pinned,
  recent,
  categories,
  loadingMore,
  onAction,
  children,
}: {
  pinned: Conversation[]
  recent: Conversation[]
  categories: TaskCategory[]
  loadingMore: boolean
  onAction: (action: TaskCategoryAction) => void
  children: (group: SidebarTaskGroupData) => ReactNode
}) {
  const { t } = useTranslation()
  const { pendingCategoryOrder } = useContext(SidebarConversationDragState)
  const orderedCategories = useMemo(() => {
    if (!pendingCategoryOrder) return categories
    const positions = new Map(
      pendingCategoryOrder.map((id, index) => [id, index])
    )
    return [...categories].sort(
      (left, right) =>
        (positions.get(left.id) ?? Infinity) -
        (positions.get(right.id) ?? Infinity)
    )
  }, [categories, pendingCategoryOrder])
  const categoryIds = useMemo(
    () => orderedCategories.map((category) => taskCategoryDropId(category.id)),
    [orderedCategories]
  )
  const byCategory = new Map<string | null, Conversation[]>()
  for (const conversation of recent) {
    const tasks = byCategory.get(conversation.category_id) ?? []
    tasks.push(conversation)
    byCategory.set(conversation.category_id, tasks)
  }
  const renderCategory = (id: string | null) =>
    children({
      orderGroup: "recent",
      categoryId: id,
      conversations: byCategory.get(id) ?? [],
    })
  const unavailableIds = [...byCategory.keys()].filter(
    (id) => id !== null && !categories.some((category) => category.id === id)
  )
  return (
    <>
      {pinned.length > 0 && (
        <section
          aria-labelledby="pinned-conversations-title"
          className="flex flex-col gap-0.5"
        >
          <h2
            id="pinned-conversations-title"
            className="px-2.5 pb-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-semibold text-[var(--app-muted)]"
          >
            {t("nav.pinned")}
          </h2>
          {children({
            orderGroup: "pinned",
            categoryId: null,
            conversations: pinned,
          })}
        </section>
      )}
      <section
        aria-labelledby="recent-conversations-title"
        className="flex flex-col gap-0.5"
      >
        <div className="group/tasks-heading flex items-center justify-between gap-2 pr-0.5 pb-1 pl-2.5">
          <h2
            id="recent-conversations-title"
            className="text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-semibold text-[var(--app-muted)]"
          >
            {t("nav.recent")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pointer-events-none opacity-0 group-hover/tasks-heading:pointer-events-auto group-hover/tasks-heading:opacity-100 group-has-[:focus-visible]/tasks-heading:pointer-events-auto group-has-[:focus-visible]/tasks-heading:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
            aria-label={t("taskCategories.create")}
            onClick={() => onAction({ mode: "create" })}
          >
            <PlusIcon />
          </Button>
        </div>
        <SortableContext
          items={categoryIds}
          strategy={stationaryCategoryStrategy}
        >
          {orderedCategories.map((category) => (
            <SidebarTaskGroup
              key={category.id}
              label={category.name}
              category={category}
              onAction={onAction}
            >
              {renderCategory(category.id)}
              {!loadingMore && !byCategory.get(category.id)?.length && (
                <p className="py-2 pr-2.5 pl-[calc(8px+var(--sidebar-conversation-indent))] text-[length:var(--app-font-13)] leading-[var(--app-ui-compact-line-height)] text-muted-foreground">
                  {t("taskCategories.empty")}
                </p>
              )}
            </SidebarTaskGroup>
          ))}
        </SortableContext>
        {byCategory.has(null) && <div>{renderCategory(null)}</div>}
        {unavailableIds.map((id) => (
          <SidebarTaskGroup
            key={id}
            label={t("taskCategories.unavailable")}
            onAction={onAction}
          >
            {renderCategory(id)}
          </SidebarTaskGroup>
        ))}
      </section>
    </>
  )
}
