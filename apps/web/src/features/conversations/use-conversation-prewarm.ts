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

type PrewarmScope = {
  key: string
  active: boolean
  claimed: boolean
  conversationId: string | undefined
  reservationId: string | null
  mode: ConversationCollaborationMode
  inFlight: boolean
  completed: { mode: ConversationCollaborationMode; at: number } | null
}

async function prewarm(scope: PrewarmScope): Promise<void> {
  if (!scope.active || scope.claimed || scope.inFlight) return
  const now = Date.now()
  if (
    scope.completed?.mode === scope.mode &&
    now - scope.completed.at < refreshIntervalMs
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
      },
      schema: receiptSchema,
    })
    if (!scope.active || scope.claimed) return
    if (!scope.conversationId) scope.reservationId = receipt.conversation_id
    scope.completed = { mode, at: now }
  } catch (error) {
    if (!scope.active || scope.claimed) return
    scope.completed = null
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
}): { claim: () => string | null; reset: () => void } {
  const { ownerId, conversationId, scopeKey, collaborationMode } = input
  const scopeRef = useRef<PrewarmScope | null>(null)
  const [resetVersion, increaseResetVersion] = useReducer(
    (value: number) => value + 1,
    0
  )
  const key = JSON.stringify([ownerId, conversationId, scopeKey, resetVersion])

  useLayoutEffect(() => {
    if (!ownerId) return
    if (scopeRef.current?.key !== key) {
      scopeRef.current = {
        key,
        active: true,
        claimed: false,
        conversationId,
        reservationId: null,
        mode: collaborationMode,
        inFlight: false,
        completed: null,
      }
    }
    const scope = scopeRef.current
    scope.active = true
    scope.mode = collaborationMode
    return () => {
      scope.active = false
    }
  }, [key, ownerId, conversationId, collaborationMode])

  useEffect(() => {
    const scope = scopeRef.current
    if (scope?.active) void prewarm(scope)
  }, [key, collaborationMode])

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
