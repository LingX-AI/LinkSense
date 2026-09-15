import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useLocation, useNavigate } from "react-router-dom"
import { conversationDetailQueryOptions } from "@/features/conversations/conversation-detail-query"
import { useProjects } from "./project-api"
import {
  readNewProject,
  readNewTaskSource,
  rememberNewProject,
  withoutNewTaskSource,
} from "./new-project-preference"

type ProjectSelection = { userId: string | undefined } & (
  | { kind: "choice"; projectId: string | null }
  | { kind: "context"; conversationId: string }
)

function initialSelection(
  userId: string | undefined,
  sourceId?: string
): ProjectSelection {
  return sourceId
    ? { userId, kind: "context", conversationId: sourceId }
    : {
        userId,
        kind: "choice",
        projectId: userId ? readNewProject(userId) : null,
      }
}

export function useNewProject({
  userId,
  isNew,
}: {
  userId: string | undefined
  isNew: boolean
}): {
  projectId: string | null
  isResolving: boolean
  chooseProject: (projectId: string | null) => void
  resetProject: () => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const sourceId = readNewTaskSource(location.state, userId)
  const projects = useProjects()
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
        ? selection.projectId
        : (source.data?.project_id ?? null)
  const projectId =
    candidate && projects.data?.some((project) => project.id === candidate)
      ? candidate
      : null
  const isResolving =
    isNew &&
    ((contextId !== undefined && source.isPending) ||
      (candidate !== null && projects.isPending))

  const chooseProject = useCallback(
    (nextId: string | null) => {
      setSelection({ userId, kind: "choice", projectId: nextId })
      if (userId) rememberNewProject(userId, nextId)
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
  const resetProject = useCallback(
    () => setSelection(initialSelection(userId)),
    [userId]
  )
  return { projectId, isResolving, chooseProject, resetProject }
}
