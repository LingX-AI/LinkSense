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

type SidebarConversationPage<T> = SidebarConversationOrderPage<T> & {
  total_count?: number
}

type SidebarConversationData<T> = {
  pages: SidebarConversationPage<T>[]
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

export function upsertSidebarConversation<
  T extends { id: string },
  TData extends SidebarConversationData<T>,
>(data: TData | undefined, conversation: T) {
  return replaceSidebarConversation(data, conversation.id, conversation)
}

export function replaceSidebarConversation<
  T extends { id: string },
  TData extends SidebarConversationData<T>,
>(data: TData | undefined, previousConversationId: string, conversation: T) {
  if (!data || data.pages.length === 0) return data

  const alreadyPresent = data.pages.some((page) =>
    page.items.some(
      (item) =>
        item.id === previousConversationId || item.id === conversation.id
    )
  )
  const pages = data.pages.map((page, index) => {
    const remainingItems = page.items.filter(
      (item) =>
        item.id !== previousConversationId && item.id !== conversation.id
    )
    return {
      ...page,
      items: index === 0 ? [conversation, ...remainingItems] : remainingItems,
      ...(page.total_count === undefined
        ? {}
        : {
            total_count: alreadyPresent
              ? page.total_count
              : page.total_count + 1,
          }),
    }
  })

  return { ...data, pages }
}

export function removeSidebarConversation<
  T extends { id: string },
  TData extends SidebarConversationData<T>,
>(data: TData | undefined, conversationId: string) {
  if (!data) return data
  const exists = data.pages.some((page) =>
    page.items.some((item) => item.id === conversationId)
  )
  if (!exists) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((item) => item.id !== conversationId),
      ...(page.total_count === undefined
        ? {}
        : { total_count: Math.max(0, page.total_count - 1) }),
    })),
  }
}

export function patchSidebarConversationTitle<
  T extends { id: string; title: string; title_source?: string },
  TData extends SidebarConversationData<T>,
>(data: TData | undefined, conversationId: string, title: string) {
  if (!data) return data
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation
      }
      const patched = patchConversationTitle(conversation, title)
      if (patched === conversation) return conversation
      pageChanged = true
      return patched
    })
    if (!pageChanged) return page
    changed = true
    return { ...page, items }
  })
  return changed ? { ...data, pages } : data
}

export function patchSidebarConversationExecutionStatus<
  T extends { id: string; execution_status?: Conversation["execution_status"] },
  TData extends SidebarConversationData<T>,
>(
  data: TData | undefined,
  conversationId: string,
  executionStatus: Conversation["execution_status"]
) {
  if (!data) return data
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((conversation) => {
      if (
        conversation.id !== conversationId ||
        conversation.execution_status === executionStatus
      ) {
        return conversation
      }
      pageChanged = true
      return { ...conversation, execution_status: executionStatus }
    })
    if (!pageChanged) return page
    changed = true
    return { ...page, items }
  })
  return changed ? { ...data, pages } : data
}

export function patchConversationTitle<
  T extends { title: string; title_source?: string },
>(conversation: T, title: string): T {
  if (conversation.title_source === "manual" || conversation.title === title) {
    return conversation
  }
  return { ...conversation, title }
}
