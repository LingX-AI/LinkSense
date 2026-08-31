import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"

import type { Conversation } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { reorderConversationIds } from "@/features/conversations/conversation-order"

type SortableConversationRenderState = {
  keyboardActivator: ReactNode
  onPointerDown: PointerEventHandler<HTMLElement> | undefined
  sortingDisabled: boolean
  isDragging: boolean
  setNodeRef: (node: HTMLElement | null) => void
  style: CSSProperties
}

export function SortableConversationGroup({
  conversations,
  disabled,
  onReorder,
  children,
}: {
  conversations: readonly Conversation[]
  disabled: boolean
  onReorder: (conversationIds: string[]) => Promise<void>
  children: (
    conversation: Conversation,
    sortable: SortableConversationRenderState
  ) => ReactNode
}) {
  const { t } = useTranslation()
  const sourceIds = useMemo(
    () => conversations.map((conversation) => conversation.id),
    [conversations]
  )
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null)
  const suppressClickAfterDragRef = useRef(false)
  const clearSuppressClickAfterDragTimerRef = useRef<number | undefined>(
    undefined
  )
  const orderedIds = draggedIds ?? sourceIds
  const conversationsById = useMemo(
    () =>
      new Map(
        conversations.map((conversation) => [conversation.id, conversation])
      ),
    [conversations]
  )
  const orderedConversations = orderedIds.flatMap((id) => {
    const conversation = conversationsById.get(id)
    return conversation ? [conversation] : []
  })
  const sortingDisabled = disabled || orderedConversations.length < 2
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const conversationTitle = (id: string | number) =>
    conversationsById.get(String(id))?.title ?? t("conversation.untitled")
  const conversationPosition = (id: string | number) =>
    orderedIds.indexOf(String(id)) + 1

  const resetSuppressClickAfterDrag = useCallback(() => {
    if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
      window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
      clearSuppressClickAfterDragTimerRef.current = undefined
    }
    suppressClickAfterDragRef.current = false
  }, [])

  const scheduleSuppressClickAfterDragReset = useCallback(() => {
    if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
      window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
    }
    clearSuppressClickAfterDragTimerRef.current = window.setTimeout(() => {
      resetSuppressClickAfterDrag()
    }, 250)
  }, [resetSuppressClickAfterDrag])

  useEffect(() => {
    // dnd-kit stops the trailing click at document capture without cancelling
    // the anchor default, so cancel it earlier to avoid native navigation.
    const preventNativeNavigationAfterDrag = (event: MouseEvent) => {
      if (!suppressClickAfterDragRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("click", preventNativeNavigationAfterDrag, true)
    return () => {
      window.removeEventListener(
        "click",
        preventNativeNavigationAfterDrag,
        true
      )
      if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
        window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
      }
    }
  }, [resetSuppressClickAfterDrag])

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    scheduleSuppressClickAfterDragReset()
    if (!over || active.id === over.id || sortingDisabled) return
    const nextIds = reorderConversationIds(
      orderedIds,
      String(active.id),
      String(over.id)
    )
    setDraggedIds(nextIds)
    try {
      await onReorder(nextIds)
    } finally {
      setDraggedIds(null)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      accessibility={{
        screenReaderInstructions: {
          draggable: t("conversation.reorderInstructions"),
        },
        announcements: {
          onDragStart: ({ active }) =>
            t("conversation.reorderStarted", {
              title: conversationTitle(active.id),
              position: conversationPosition(active.id),
            }),
          onDragOver: ({ active, over }) =>
            over
              ? t("conversation.reorderOver", {
                  title: conversationTitle(active.id),
                  position: conversationPosition(over.id),
                })
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? t("conversation.reorderCompleted", {
                  title: conversationTitle(active.id),
                  position: conversationPosition(over.id),
                })
              : t("conversation.reorderCancelled"),
          onDragCancel: () => t("conversation.reorderCancelled"),
        },
      }}
      onDragStart={() => {
        suppressClickAfterDragRef.current = true
      }}
      onDragEnd={(event) => void handleDragEnd(event)}
      onDragCancel={scheduleSuppressClickAfterDragReset}
    >
      <SortableContext
        items={orderedIds}
        strategy={verticalListSortingStrategy}
      >
        {orderedConversations.map((conversation, index) => (
          <SortableConversationItem
            key={conversation.id}
            conversation={conversation}
            position={index + 1}
            disabled={sortingDisabled}
          >
            {(sortable) => children(conversation, sortable)}
          </SortableConversationItem>
        ))}
      </SortableContext>
    </DndContext>
  )
}

function SortableConversationItem({
  conversation,
  position,
  disabled,
  children,
}: {
  conversation: Conversation
  position: number
  disabled: boolean
  children: (sortable: SortableConversationRenderState) => ReactNode
}) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: conversation.id, disabled })
  const title = conversation.title || t("conversation.untitled")
  const keyboardActivator = (
    <Button
      ref={setActivatorNodeRef}
      type="button"
      className="sr-only"
      aria-label={t("conversation.reorderHandle", { title, position })}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      {t("conversation.reorderHandle", { title, position })}
    </Button>
  )

  return children({
    keyboardActivator,
    onPointerDown: disabled
      ? undefined
      : (event) => listeners?.onPointerDown?.(event),
    sortingDisabled: disabled,
    isDragging,
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
    },
  })
}
