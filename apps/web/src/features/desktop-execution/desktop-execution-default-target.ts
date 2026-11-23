import { useState } from "react"
import {
  conversationExecutionTargetSchema,
  type ConversationExecutionTarget,
} from "@linksense/shared"

import {
  getDesktopServerUrl,
  isMacDesktopHost,
} from "@/adapters/desktop/desktop-adapter"

export function desktopExecutionDefaultTargetKey(
  userId: string | undefined
): string | null {
  if (!userId || !isMacDesktopHost()) return null
  const serverUrl = getDesktopServerUrl()
  return serverUrl
    ? `linksense.desktopExecution.defaultTarget:${JSON.stringify([serverUrl, userId])}`
    : null
}

export function readDesktopExecutionDefaultTarget(
  key: string | null
): ConversationExecutionTarget {
  if (!key) return "cloud"
  try {
    return (
      conversationExecutionTargetSchema.safeParse(
        window.localStorage.getItem(key)
      ).data ?? "cloud"
    )
  } catch {
    return "cloud"
  }
}

export function saveDesktopExecutionDefaultTarget(
  key: string,
  value: unknown
): ConversationExecutionTarget | null {
  const target = conversationExecutionTargetSchema.safeParse(value)
  if (!target.success) return null
  try {
    const storage = window.localStorage
    storage.setItem(key, target.data)
    return storage.getItem(key) === target.data ? target.data : null
  } catch {
    return null
  }
}

export function useDesktopExecutionDraftTarget(
  preferenceKey: string | null,
  locationKey: string,
  resetVersion: number
): readonly [
  ConversationExecutionTarget,
  (value: ConversationExecutionTarget) => void,
] {
  const draftScope = preferenceKey
    ? JSON.stringify([preferenceKey, locationKey, resetVersion])
    : null
  const [draft, setDraft] = useState(() => ({
    scope: draftScope,
    value: readDesktopExecutionDefaultTarget(preferenceKey),
  }))
  let activeDraft = draft
  if (draft.scope !== draftScope) {
    // Reset before committing the new draft so an old cloud override cannot prewarm.
    activeDraft = {
      scope: draftScope,
      value: readDesktopExecutionDefaultTarget(preferenceKey),
    }
    setDraft(activeDraft)
  }
  return [activeDraft.value, (value) => setDraft({ scope: draftScope, value })]
}
