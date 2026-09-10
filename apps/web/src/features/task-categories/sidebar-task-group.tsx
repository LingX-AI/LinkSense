import { useContext, useState, type ReactNode } from "react"
import { useSortable } from "@dnd-kit/sortable"
import type { TaskCategory } from "@linksense/shared"
import {
  FolderClosedIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
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
import type { TaskCategoryAction } from "./task-category-dialog"
import { SidebarDropIndicator } from "@/features/conversations/sidebar-drop-indicator"
import {
  SidebarConversationDragState,
  taskCategoryDropId,
} from "@/features/conversations/sidebar-conversation-drag-state"

export function SidebarTaskGroup({
  category,
  label,
  children,
  onAction,
}: {
  category?: TaskCategory
  label: string
  children: ReactNode
  onAction: (action: TaskCategoryAction) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const { disabled, categoriesDisabled } = useContext(
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
    id: taskCategoryDropId(category?.id ?? label),
    disabled: {
      draggable: categoriesDisabled || !category,
      droppable: (disabled && categoriesDisabled) || !category,
    },
    data: { categoryOpen: open },
    transition: null,
    animateLayoutChanges: () => false,
  })
  const CategoryIcon = open ? FolderOpenIcon : FolderClosedIcon
  if (!category)
    return (
      <section aria-label={label} className="flex flex-col gap-0.5">
        <h2 className="px-2.5 py-1 text-sm font-semibold text-muted-foreground">
          {label}
        </h2>
        {children}
      </section>
    )

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      // Label offset: 10px padding + 14px icon + 6px gap + 1px border.
      // Task rows already provide 8px of padding; inherit the remaining offset.
      render={
        <section
          aria-label={category.name}
          className="relative [--sidebar-conversation-indent:calc(1.875rem-7px)]"
        />
      }
    >
      <div
        ref={setNodeRef}
        data-drop-target={isOver || undefined}
        data-dragging={isDragging || undefined}
        className="group/category relative min-w-0 rounded-[10px] hover:bg-[var(--app-sidebar-hover)] has-data-[popup-open]:bg-[var(--app-sidebar-hover)] has-[:focus-visible]:bg-[var(--app-sidebar-hover)] data-[drop-target]:bg-[var(--app-sidebar-hover)]"
      >
        <CollapsibleTrigger
          onPointerDown={(event) => listeners?.onPointerDown?.(event)}
          draggable={false}
          render={
            <Button
              type="button"
              variant="ghost"
              className={cn(
                "w-full min-w-0 justify-start rounded-[10px] pr-9 pl-2.5 hover:bg-transparent aria-expanded:bg-transparent",
                !categoriesDisabled && "cursor-grab active:cursor-grabbing"
              )}
            />
          }
        >
          <CategoryIcon
            data-icon="inline-start"
            className="size-3.5"
            aria-hidden="true"
          />
          <span
            className="min-w-0 flex-1 truncate text-left"
            title={active ? undefined : category.name}
          >
            {category.name}
          </span>
        </CollapsibleTrigger>
        <Button
          ref={setActivatorNodeRef}
          type="button"
          className="sr-only"
          disabled={categoriesDisabled}
          {...attributes}
          {...listeners}
          aria-label={t("taskCategories.reorderHandle", {
            title: category.name,
            position: index + 1,
          })}
        >
          {t("taskCategories.reorderHandle", {
            title: category.name,
            position: index + 1,
          })}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/category:pointer-events-auto group-hover/category:opacity-100 group-has-[:focus-visible]/category:pointer-events-auto group-has-[:focus-visible]/category:opacity-100 hover:bg-transparent aria-expanded:bg-transparent data-popup-open:pointer-events-auto data-popup-open:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                aria-label={t("common.moreActionsNamed", {
                  name: category.name,
                })}
              />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => onAction({ mode: "rename", category })}
              >
                <PencilIcon className="mx-px size-3.5" />
                {t("taskCategories.renameAction")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction({ mode: "delete", category })}
              >
                <Trash2Icon />
                {t("common.delete")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <SidebarDropIndicator targetId={taskCategoryDropId(category.id)} />
      </div>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none">
        {children}
      </CollapsibleContent>
      <SidebarDropIndicator
        targetId={taskCategoryDropId(category.id)}
        scope="category"
      />
    </Collapsible>
  )
}
