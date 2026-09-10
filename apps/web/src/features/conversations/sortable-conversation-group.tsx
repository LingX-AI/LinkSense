import {
  SortableContext,
  useSortable,
  type SortingStrategy,
} from "@dnd-kit/sortable"
import {
  useContext,
  useMemo,
  type PointerEventHandler,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import type { Conversation } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { SidebarConversationDragState } from "./sidebar-conversation-drag-state"

import { SidebarDropIndicator } from "./sidebar-drop-indicator"

// Insertion markers own the preview; rows keep their original layout.
const stationaryStrategy: SortingStrategy = () => null

type SortableConversationRenderState = {
  keyboardActivator: ReactNode
  onPointerDown: PointerEventHandler<HTMLElement> | undefined
  sortingDisabled: boolean
  isDragging: boolean
  setNodeRef: (node: HTMLElement | null) => void
  dropIndicator: ReactNode
}

export function SortableConversationGroup({
  conversations,
  children,
}: {
  conversations: readonly Conversation[]
  children: (
    conversation: Conversation,
    sortable: SortableConversationRenderState
  ) => ReactNode
}) {
  const { disabled, pendingOrder } = useContext(SidebarConversationDragState)
  const orderedConversations = useMemo(() => {
    if (!pendingOrder) return conversations
    const byId = new Map(
      conversations.map((conversation) => [conversation.id, conversation])
    )
    if (!pendingOrder.some((id) => byId.has(id))) return conversations
    return pendingOrder.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
  }, [conversations, pendingOrder])
  const ids = useMemo(
    () => orderedConversations.map((item) => item.id),
    [orderedConversations]
  )
  return (
    <SortableContext items={ids} strategy={stationaryStrategy}>
      {orderedConversations.map((conversation, index) => (
        <SortableConversationItem
          key={conversation.id}
          conversation={conversation}
          position={index + 1}
          disabled={disabled}
        >
          {(sortable) => children(conversation, sortable)}
        </SortableConversationItem>
      ))}
    </SortableContext>
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
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging } =
    useSortable({
      id: conversation.id,
      disabled,
      transition: null,
      animateLayoutChanges: () => false,
    })
  const title = conversation.title || t("conversation.untitled")
  // Only the native active draggable subscribes to every pointer transform.
  // Cache its expensive task presentation while position alone changes.
  return useMemo(() => {
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
      dropIndicator: <SidebarDropIndicator targetId={conversation.id} />,
    })
  }, [
    attributes,
    children,
    conversation.id,
    disabled,
    isDragging,
    listeners,
    position,
    setActivatorNodeRef,
    setNodeRef,
    t,
    title,
  ])
}
