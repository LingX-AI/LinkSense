import { arrayMove } from "@dnd-kit/sortable"

import type { Conversation } from "@/api/contracts"
import type { SidebarTaskSortMode } from "./sidebar-task-sort-preference"

type SidebarConversationOrder = Pick<
  Conversation,
  | "id"
  | "pinned_at"
  | "sort_order"
  | "updated_at"
  | "created_at"
  | "last_run_at"
  | "execution_status"
  | "has_unread_completion"
  | "needs_attention"
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
  mode: SidebarTaskSortMode
) {
  const indexed = conversations.map((conversation, index) => ({
    conversation,
    index,
  }))
  indexed.sort((left, right) => {
    if (mode === "manual") {
      const leftOrder = left.conversation.sort_order ?? null
      const rightOrder = right.conversation.sort_order ?? null
      if (
        leftOrder !== null &&
        rightOrder !== null &&
        leftOrder !== rightOrder
      ) {
        return leftOrder - rightOrder
      }
      if (leftOrder !== null && rightOrder === null) return -1
      if (leftOrder === null && rightOrder !== null) return 1
      return left.index - right.index
    }

    if (mode === "priority") {
      const priorityDifference =
        sidebarConversationPriority(left.conversation) -
        sidebarConversationPriority(right.conversation)
      if (priorityDifference !== 0) return priorityDifference
    }

    const recencyDifference =
      sidebarConversationRecency(right.conversation, mode) -
      sidebarConversationRecency(left.conversation, mode)
    if (recencyDifference !== 0) return recencyDifference
    return left.index - right.index
  })
  return indexed.map(({ conversation }) => conversation)
}

const sidebarConversationPriorityWeight = {
  waiting: 0,
  unread: 1,
  active: 2,
  idle: 3,
} as const

function sidebarConversationPriority(
  conversation: SidebarConversationOrder
): number {
  if (conversation.needs_attention) {
    return sidebarConversationPriorityWeight.waiting
  }
  if (conversation.has_unread_completion) {
    return sidebarConversationPriorityWeight.unread
  }
  if (
    conversation.execution_status === "running" ||
    conversation.execution_status === "pending"
  ) {
    return sidebarConversationPriorityWeight.active
  }
  return sidebarConversationPriorityWeight.idle
}

function sidebarConversationRecency(
  conversation: SidebarConversationOrder,
  mode: SidebarTaskSortMode
): number {
  const parsed = Date.parse(
    mode === "updated_at"
      ? (conversation.updated_at ??
          conversation.last_run_at ??
          conversation.created_at)
      : (conversation.last_run_at ??
          conversation.updated_at ??
          conversation.created_at)
  )
  return Number.isNaN(parsed) ? 0 : parsed
}

export type ConversationInsertionEdge = "before" | "after"

export function reorderConversationIds(
  conversationIds: readonly string[],
  activeId: string,
  overId: string,
  edge: ConversationInsertionEdge
) {
  const previousIndex = conversationIds.indexOf(activeId)
  const anchorIndex = conversationIds.indexOf(overId)
  if (previousIndex < 0 || anchorIndex < 0 || previousIndex === anchorIndex) {
    return [...conversationIds]
  }
  const boundary = anchorIndex + (edge === "after" ? 1 : 0)
  const nextIndex = boundary - (previousIndex < boundary ? 1 : 0)
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
>(
  data: TData | undefined,
  conversationId: string,
  title: string,
  source: "generated" | "manual" = "generated"
) {
  if (!data) return data
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((conversation) => {
      if (conversation.id !== conversationId) {
        return conversation
      }
      const patched = patchConversationTitle(conversation, title, source)
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
  T extends {
    id: string
    execution_status?: Conversation["execution_status"]
    has_unread_completion?: boolean
    updated_at?: string
    last_run_at?: string | null
  },
  TData extends SidebarConversationData<T>,
>(
  data: TData | undefined,
  conversationId: string,
  executionStatus: Conversation["execution_status"],
  options: {
    hasUnreadCompletion?: boolean
    updatedAt?: string
    lastRunAt?: string | null
  } = {}
) {
  if (!data) return data
  let changed = false
  const pages = data.pages.map((page) => {
    let pageChanged = false
    const items = page.items.map((conversation) => {
      if (
        conversation.id !== conversationId ||
        (conversation.execution_status === executionStatus &&
          (options.hasUnreadCompletion === undefined ||
            conversation.has_unread_completion ===
              options.hasUnreadCompletion) &&
          (options.updatedAt === undefined ||
            conversation.updated_at === options.updatedAt) &&
          (options.lastRunAt === undefined ||
            conversation.last_run_at === options.lastRunAt))
      ) {
        return conversation
      }
      pageChanged = true
      return {
        ...conversation,
        execution_status: executionStatus,
        ...(options.updatedAt === undefined
          ? {}
          : { updated_at: options.updatedAt }),
        ...(options.lastRunAt === undefined
          ? {}
          : { last_run_at: options.lastRunAt }),
        ...(options.hasUnreadCompletion === undefined
          ? {}
          : { has_unread_completion: options.hasUnreadCompletion }),
      }
    })
    if (!pageChanged) return page
    changed = true
    return { ...page, items }
  })
  return changed ? { ...data, pages } : data
}

export function patchConversationTitle<
  T extends { title: string; title_source?: string },
>(
  conversation: T,
  title: string,
  source: "generated" | "manual" = "generated"
): T {
  if (source === "manual") {
    return conversation.title === title &&
      conversation.title_source === "manual"
      ? conversation
      : { ...conversation, title, title_source: "manual" }
  }
  if (conversation.title_source === "manual" || conversation.title === title) {
    return conversation
  }
  return { ...conversation, title }
}
