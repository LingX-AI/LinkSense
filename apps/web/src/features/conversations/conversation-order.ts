import { arrayMove } from "@dnd-kit/sortable"

import type { Conversation } from "@/api/contracts"

type SidebarConversationOrder = Pick<
  Conversation,
  "id" | "pinned_at" | "sort_order" | "updated_at"
>

type SidebarConversationOrderPage<T> = {
  items: T[]
}

type SidebarConversationOrderData<T> = {
  pages: SidebarConversationOrderPage<T>[]
}

export function sortSidebarConversations<T extends SidebarConversationOrder>(
  conversations: readonly T[],
  group: "pinned" | "recent"
) {
  return [...conversations].sort((left, right) => {
    const leftOrder = left.sort_order ?? null
    const rightOrder = right.sort_order ?? null
    if (leftOrder !== null || rightOrder !== null) {
      if (leftOrder === null) return -1
      if (rightOrder === null) return 1
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
    }

    const leftFallback = Date.parse(
      group === "pinned" ? (left.pinned_at ?? left.updated_at) : left.updated_at
    )
    const rightFallback = Date.parse(
      group === "pinned"
        ? (right.pinned_at ?? right.updated_at)
        : right.updated_at
    )
    if (leftFallback !== rightFallback) return rightFallback - leftFallback
    return right.id.localeCompare(left.id)
  })
}

export function reorderConversationIds(
  conversationIds: readonly string[],
  activeId: string,
  overId: string
) {
  const previousIndex = conversationIds.indexOf(activeId)
  const nextIndex = conversationIds.indexOf(overId)
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) {
    return [...conversationIds]
  }
  return arrayMove([...conversationIds], previousIndex, nextIndex)
}

export function applySidebarConversationOrder<
  T extends SidebarConversationOrder,
  TData extends SidebarConversationOrderData<T>,
>(
  data: TData | undefined,
  group: "pinned" | "recent",
  conversationIds: readonly string[]
) {
  if (!data) return data
  const sortOrderById = new Map(
    conversationIds.map((conversationId, index) => [conversationId, index])
  )
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((conversation) => {
      const inGroup =
        group === "pinned"
          ? Boolean(conversation.pinned_at)
          : !conversation.pinned_at
      const nextSortOrder = inGroup
        ? (sortOrderById.get(conversation.id) ?? conversation.sort_order)
        : conversation.sort_order
      if (nextSortOrder === conversation.sort_order) return conversation
      pageChanged = true
      return { ...conversation, sort_order: nextSortOrder }
    })
    if (!pageChanged) return page
    changed = true
    return { ...page, items }
  })
  return changed ? { ...data, pages } : data
}
