import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"
import { conversationDetailQueryOptions } from "@/features/conversations/conversation-detail-query"
import { useTaskCategories } from "./task-category-api"
import {
  readNewTaskCategory,
  readNewTaskSource,
  rememberNewTaskCategory,
  withoutNewTaskSource,
} from "./new-task-category-preference"

type CategorySelection = { userId: string | undefined } & (
  | { kind: "choice"; categoryId: string | null }
  | { kind: "context"; conversationId: string }
)

function initialSelection(
  userId: string | undefined,
  sourceId?: string
): CategorySelection {
  return sourceId
    ? { userId, kind: "context", conversationId: sourceId }
    : {
        userId,
        kind: "choice",
        categoryId: userId ? readNewTaskCategory(userId) : null,
      }
}

export function useNewTaskCategory({
  userId,
  isNew,
}: {
  userId: string | undefined
  isNew: boolean
}): {
  categoryId: string | null
  isResolving: boolean
  chooseCategory: (categoryId: string | null) => void
  resetCategory: () => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const sourceId = readNewTaskSource(location.state, userId)
  const categories = useTaskCategories()
  const [selection, setSelection] = useState(() =>
    initialSelection(userId, isNew ? sourceId : undefined)
  )
  const previousEntry = useRef({ userId, isNew })
  useLayoutEffect(() => {
    const previous = previousEntry.current
    previousEntry.current = { userId, isNew }
    if (userId !== previous.userId || (isNew && !previous.isNew)) {
      setSelection(initialSelection(userId, isNew ? sourceId : undefined))
    }
  }, [userId, isNew, sourceId])

  const contextId =
    selection.userId === userId && selection.kind === "context"
      ? selection.conversationId
      : undefined
  const source = useQuery({
    ...conversationDetailQueryOptions(contextId),
    enabled: isNew && contextId !== undefined,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  })
  const candidate =
    selection.userId !== userId
      ? null
      : selection.kind === "choice"
        ? selection.categoryId
        : (source.data?.category_id ?? null)
  const categoryId =
    candidate && categories.data?.some((category) => category.id === candidate)
      ? candidate
      : null
  const isResolving =
    isNew &&
    ((contextId !== undefined && source.isPending) ||
      (candidate !== null && categories.isPending))

  const chooseCategory = useCallback(
    (nextId: string | null) => {
      setSelection({ userId, kind: "choice", categoryId: nextId })
      if (userId) rememberNewTaskCategory(userId, nextId)
      // Once edited, a refreshed new-task page must restore the user's choice,
      // rather than replay the task context carried by the navigation entry.
      if (isNew && sourceId)
        navigate(`${location.pathname}${location.search}${location.hash}`, {
          replace: true,
          state: withoutNewTaskSource(location.state),
        })
    },
    [userId, isNew, sourceId, navigate, location]
  )
  const resetCategory = useCallback(
    () => setSelection(initialSelection(userId)),
    [userId]
  )
  return { categoryId, isResolving, chooseCategory, resetCategory }
}
