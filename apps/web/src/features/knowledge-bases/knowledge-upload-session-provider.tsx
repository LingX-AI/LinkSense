import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  emptyKnowledgeUploadSession,
  KnowledgeUploadSessionContext,
  type KnowledgeUploadSession,
  type KnowledgeUploadSessionContextValue,
} from "@/features/knowledge-bases/knowledge-upload-session"

export function KnowledgeUploadSessionProvider({
  children,
}: {
  children: ReactNode
}) {
  const [sessions, setSessions] = useState<
    Record<string, KnowledgeUploadSession | undefined>
  >({})
  const activeRef = useRef(true)
  const controllersRef = useRef(new Map<string, AbortController>())

  useEffect(() => {
    activeRef.current = true
    const controllers = controllersRef.current
    return () => {
      activeRef.current = false
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
    }
  }, [])

  const updateSession = useCallback<
    KnowledgeUploadSessionContextValue["updateSession"]
  >((knowledgeBaseId, update) => {
    if (!activeRef.current) return
    setSessions((current) => {
      const session = current[knowledgeBaseId] ?? emptyKnowledgeUploadSession
      const next = update(session)
      return next === session
        ? current
        : { ...current, [knowledgeBaseId]: next }
    })
  }, [])

  const registerRequest = useCallback(
    (requestId: string): AbortController | null => {
      if (!activeRef.current) return null
      const controller = new AbortController()
      controllersRef.current.set(requestId, controller)
      return controller
    },
    []
  )

  const unregisterRequest = useCallback((requestId: string): void => {
    controllersRef.current.delete(requestId)
  }, [])

  const value = useMemo<KnowledgeUploadSessionContextValue>(
    () => ({ sessions, updateSession, registerRequest, unregisterRequest }),
    [registerRequest, sessions, unregisterRequest, updateSession]
  )

  return (
    <KnowledgeUploadSessionContext.Provider value={value}>
      {children}
    </KnowledgeUploadSessionContext.Provider>
  )
}
