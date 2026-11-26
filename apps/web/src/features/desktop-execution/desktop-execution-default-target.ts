import { useState } from "react"
import {
  conversationExecutionTargetSchema,
  type ConversationExecutionTarget,
} from "@linksense/shared"

import {
  getDesktopServerUrl,
  isMacDesktopHost,
} from "@/adapters/desktop/desktop-adapter"

// Scope every Mac-local preference to the packaged server and signed-in
// account so switching either one never inherits the other's choice.
export function desktopPreferencesScope(
  userId: string | undefined
): string | null {
  if (!userId || !isMacDesktopHost()) return null
  const serverUrl = getDesktopServerUrl()
  return serverUrl ? JSON.stringify([serverUrl, userId]) : null
}

export function desktopExecutionDefaultTargetKey(
  userId: string | undefined
): string | null {
  const scope = desktopPreferencesScope(userId)
  return scope ? `linksense.desktopExecution.defaultTarget:${scope}` : null
}

export function desktopStartGuideKey(
  userId: string | undefined
): string | null {
  const scope = desktopPreferencesScope(userId)
  return scope ? `linksense.desktopStartGuide:${scope}` : null
}

/**
 * A stored, valid value means this account already used the run-location
 * preference on this server. The guide then stays out of the way after an
 * upgrade. An older invalid value is not a saved choice and must not suppress
 * the guide.
 */
export function hasStoredDesktopExecutionDefaultTarget(
  preferenceKey: string | null
): boolean {
  if (!preferenceKey) return false
  try {
    return conversationExecutionTargetSchema.safeParse(
      window.localStorage.getItem(preferenceKey)
    ).success
  } catch {
    return false
  }
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
