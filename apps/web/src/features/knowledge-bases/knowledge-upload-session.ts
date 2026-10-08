import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react"

import type { KnowledgeDocument } from "@/features/knowledge-bases/knowledge-base-contracts"

export type KnowledgeUploadQueueState =
  | "waiting"
  | "uploading"
  | "processing"
  | "ready"
  | "duplicate"
  | "conflict"
  | "skipped"
  | "failed"

export type KnowledgeUploadQueueItem = {
  id: string
  file: File
  relativePath?: string
  ocrEnabled: boolean
  state: KnowledgeUploadQueueState
  progress: number
  error?: string
  document?: KnowledgeDocument
  existingDocument?: KnowledgeDocument
}

export type KnowledgeUploadBatchStatus = {
  totalCount: number
  completedCount: number
  issueCount: number
  progressPercent: number
  phase: "running" | "attention" | "completed"
}

export type KnowledgeUploadSession = {
  items: KnowledgeUploadQueueItem[]
  batchError: string | undefined
  batchRunning: boolean
  ocrEnabled: boolean
  uploadMode: "files" | "folder"
  activeRequestCount: number
  conflictItemId: string | undefined
  batchStarted: boolean
}

export const emptyKnowledgeUploadSession: KnowledgeUploadSession = {
  items: [],
  batchError: undefined,
  batchRunning: false,
  ocrEnabled: false,
  uploadMode: "files",
  activeRequestCount: 0,
  conflictItemId: undefined,
  batchStarted: false,
}

export type KnowledgeUploadSessionContextValue = {
  sessions: Readonly<Record<string, KnowledgeUploadSession | undefined>>
  updateSession: (
    knowledgeBaseId: string,
    update: (current: KnowledgeUploadSession) => KnowledgeUploadSession
  ) => void
  registerRequest: (requestId: string) => AbortController | null
  unregisterRequest: (requestId: string) => void
}

export const KnowledgeUploadSessionContext =
  createContext<KnowledgeUploadSessionContextValue | null>(null)

export function useKnowledgeUploadSessionContext(): KnowledgeUploadSessionContextValue {
  const context = useContext(KnowledgeUploadSessionContext)
  if (!context) {
    throw new Error("KnowledgeUploadSessionProvider is required")
  }
  return context
}

export function useKnowledgeUploadSessionState<
  Key extends keyof KnowledgeUploadSession,
>(
  knowledgeBaseId: string,
  field: Key
): readonly [
  KnowledgeUploadSession[Key],
  Dispatch<SetStateAction<KnowledgeUploadSession[Key]>>,
] {
  const { sessions, updateSession } = useKnowledgeUploadSessionContext()
  const session = sessions[knowledgeBaseId] ?? emptyKnowledgeUploadSession
  const setValue = useCallback(
    (value: SetStateAction<KnowledgeUploadSession[Key]>) => {
      updateSession(knowledgeBaseId, (current) => {
        const next = typeof value === "function" ? value(current[field]) : value
        return Object.is(next, current[field])
          ? current
          : { ...current, [field]: next }
      })
    },
    [field, knowledgeBaseId, updateSession]
  )
  return [session[field], setValue]
}

export function useKnowledgeUploadBatchStatus(
  knowledgeBaseId: string
): KnowledgeUploadBatchStatus | null {
  const { sessions } = useKnowledgeUploadSessionContext()
  const session = sessions[knowledgeBaseId] ?? emptyKnowledgeUploadSession
  return useMemo(
    () => getKnowledgeUploadBatchStatus(session.items, session.batchStarted),
    [session.batchStarted, session.items]
  )
}

export function isKnowledgeUploadQueueItemComplete(
  state: KnowledgeUploadQueueState
): boolean {
  return (
    state === "ready" ||
    state === "duplicate" ||
    state === "skipped" ||
    state === "failed"
  )
}

export function getKnowledgeUploadBatchStatus(
  items: readonly KnowledgeUploadQueueItem[],
  batchStarted: boolean
): KnowledgeUploadBatchStatus | null {
  if (!batchStarted || items.length === 0) return null
  const completedCount = items.filter((item) =>
    isKnowledgeUploadQueueItemComplete(item.state)
  ).length
  const issueCount = items.filter(
    (item) =>
      item.state === "failed" ||
      item.state === "skipped" ||
      item.state === "conflict"
  ).length
  const totalProgress = items.reduce(
    (total, item) =>
      total +
      (isKnowledgeUploadQueueItemComplete(item.state) ? 100 : item.progress),
    0
  )
  return {
    totalCount: items.length,
    completedCount,
    issueCount,
    progressPercent: Math.round(totalProgress / items.length),
    phase:
      completedCount === items.length
        ? "completed"
        : items.some((item) => item.state === "conflict")
          ? "attention"
          : "running",
  }
}
