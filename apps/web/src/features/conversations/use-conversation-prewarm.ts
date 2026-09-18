import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react"
import type { ConversationCollaborationMode } from "@linksense/shared"
import { z } from "zod"

import { ApiError, apiRequest } from "@/api/client"

const receiptSchema = z.strictObject({
  accepted: z.literal(true),
  conversation_id: z.uuid(),
})
const refreshIntervalMs = 60_000
const renewalIntervalMs = 5 * 60_000
const activityWindowMs = 15 * 60_000

type PrewarmScope = {
  key: string
  active: boolean
  enabled: boolean
  claimed: boolean
  conversationId: string | undefined
  projectId: string | null | undefined
  lastActivityAt: number
  reservationId: string | null
  mode: ConversationCollaborationMode
  inFlight: boolean
  enqueued: { mode: ConversationCollaborationMode; at: number } | null
}

async function prewarm(scope: PrewarmScope): Promise<void> {
  if (
    !scope.active ||
    !scope.enabled ||
    scope.claimed ||
    scope.inFlight ||
    document.visibilityState === "hidden"
  )
    return
  const now = Date.now()
  if (
    scope.enqueued?.mode === scope.mode &&
    now - scope.enqueued.at < refreshIntervalMs
  )
    return
  const mode = scope.mode
  const targetId = scope.conversationId ?? scope.reservationId
  scope.inFlight = true
  let reservationExpired = false
  try {
    const receipt = await apiRequest("/conversations/prewarm", {
      method: "POST",
      body: {
        ...(targetId ? { conversation_id: targetId } : {}),
        collaboration_mode: mode,
        ...(!scope.conversationId && scope.projectId
          ? { project_id: scope.projectId }
          : {}),
      },
      schema: receiptSchema,
    })
    if (!scope.active || scope.claimed) return
    if (!scope.conversationId) scope.reservationId = receipt.conversation_id
    scope.enqueued = { mode, at: now }
  } catch (error) {
    if (!scope.active || scope.claimed) return
    scope.enqueued = null
    // A reservation can expire while the user is composing. Only an absent
    // reservation permits allocating a fresh one; task/auth/server errors do not.
    if (
      !scope.conversationId &&
      targetId &&
      error instanceof ApiError &&
      error.errorCode === "CONVERSATION_NOT_FOUND"
    ) {
      scope.reservationId = null
      reservationExpired = true
    }
  } finally {
    scope.inFlight = false
    // Serialize HTTP updates within one page so rapid mode changes share the
    // reservation and only the latest mode is sent after the current receipt.
    if (
      scope.active &&
      !scope.claimed &&
      (scope.mode !== mode || reservationExpired)
    ) {
      await prewarm(scope)
    }
  }
}

export function useConversationPrewarm(input: {
  ownerId: string | undefined
  conversationId: string | undefined
  scopeKey: string
  collaborationMode: ConversationCollaborationMode
  projectId?: string | null
  configurationKey?: string
  enabled?: boolean
}): { claim: () => string | null; reset: () => void } {
  const {
    ownerId,
    conversationId,
    scopeKey,
    collaborationMode,
    projectId,
    configurationKey,
    enabled = true,
  } = input
  const scopeRef = useRef<PrewarmScope | null>(null)
  const [resetVersion, increaseResetVersion] = useReducer(
    (value: number) => value + 1,
    0
  )
  const key = JSON.stringify([
    ownerId,
    conversationId,
    scopeKey,
    resetVersion,
    projectId,
    configurationKey,
  ])

  useLayoutEffect(() => {
    if (!ownerId) return
    if (scopeRef.current?.key !== key) {
      scopeRef.current = {
        key,
        active: true,
        enabled,
        claimed: false,
        conversationId,
        projectId,
        lastActivityAt: Date.now(),
        reservationId: null,
        mode: collaborationMode,
        inFlight: false,
        enqueued: null,
      }
    }
    const scope = scopeRef.current
    scope.active = true
    scope.enabled = enabled
    scope.mode = collaborationMode
    return () => {
      scope.active = false
    }
  }, [key, ownerId, conversationId, collaborationMode, enabled, projectId])

  useEffect(() => {
    const scope = scopeRef.current
    if (!scope?.active || !scope.enabled) return
    void prewarm(scope)
    const recordActivity = () => {
      scope.lastActivityAt = Date.now()
    }
    const refreshVisible = () => {
      if (document.visibilityState === "hidden") return
      recordActivity()
      void prewarm(scope)
    }
    const timer = window.setInterval(() => {
      if (Date.now() - scope.lastActivityAt < activityWindowMs)
        void prewarm(scope)
    }, renewalIntervalMs)
    document.addEventListener("visibilitychange", refreshVisible)
    document.addEventListener("keydown", recordActivity)
    document.addEventListener("pointerdown", recordActivity)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", refreshVisible)
      document.removeEventListener("keydown", recordActivity)
      document.removeEventListener("pointerdown", recordActivity)
    }
  }, [key, collaborationMode, enabled])

  const claim = useCallback((): string | null => {
    const scope = scopeRef.current
    if (!scope?.active || scope.claimed || scope.conversationId) return null
    // Claim once, before the create request. A delayed warmup receipt must not
    // replace the task that is already being created by the foreground action.
    scope.claimed = true
    return scope.reservationId
  }, [])

  const reset = useCallback((): void => {
    if (scopeRef.current) scopeRef.current.active = false
    scopeRef.current = null
    increaseResetVersion()
  }, [])

  return { claim, reset }
}
