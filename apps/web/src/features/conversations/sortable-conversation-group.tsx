import { useSortable } from "@dnd-kit/sortable"
import {
  memo,
  useContext,
  useMemo,
  type PointerEventHandler,
  type ReactNode,
} from "react"
import { useTranslation } from "react-i18next"
import type { Conversation } from "@/api/contracts"
import { Button } from "@/components/ui/button"
import { SidebarConversationDragState } from "./sidebar-conversation-drag-state"
import { SidebarConversationList } from "./sidebar-conversation-list"

import { SidebarDropIndicator } from "./sidebar-drop-indicator"

type SortableConversationRenderState = {
  keyboardActivator: ReactNode
  onPointerDown: PointerEventHandler<HTMLElement> | undefined
  sortingDisabled: boolean
  isDragging: boolean
  setNodeRef: (node: HTMLElement | null) => void
  dropIndicator: ReactNode
}

type ConversationRenderer = (
  conversation: Conversation,
  sortable: SortableConversationRenderState
) => ReactNode

export function SortableConversationGroup({
  conversations,
  totalConversationCount,
  children,
}: {
  conversations: readonly Conversation[]
  totalConversationCount?: number
  children: ConversationRenderer
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
  return (
    <SidebarConversationList
      conversations={orderedConversations}
      totalConversationCount={totalConversationCount}
    >
      {(conversation, index) => (
        <SortableConversationItem
          key={conversation.id}
          conversation={conversation}
          position={index + 1}
          disabled={disabled}
          renderConversation={children}
        />
      )}
    </SidebarConversationList>
  )
}

const SortableConversationItem = memo(function SortableConversationItem({
  conversation,
  position,
  disabled,
  renderConversation,
}: {
  conversation: Conversation
  position: number
  disabled: boolean
  renderConversation: ConversationRenderer
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
    return renderConversation(conversation, {
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
    renderConversation,
    conversation,
    disabled,
    isDragging,
    listeners,
    position,
    setActivatorNodeRef,
    setNodeRef,
    t,
    title,
  ])
})
