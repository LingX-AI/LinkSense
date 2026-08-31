import { resolveCapabilityCenterSettingsReturn } from "@/features/capabilities/capability-center-navigation"

export type SettingsReturnState = {
  settingsReturnTo: string
}

type ReturnableLocation = Pick<Location, "pathname" | "search" | "hash">

const internalOrigin = "https://linksense.local"

function normalizeConversationSettingsReturn(value: string): string | null {
  try {
    const target = new URL(value, internalOrigin)
    if (target.origin !== internalOrigin) return null
    if (
      target.pathname !== "/conversations/new" &&
      !/^\/conversations\/[^/]+$/u.test(target.pathname) &&
      !/^\/applications\/[^/]+\/run\/[^/]+$/u.test(target.pathname)
    ) {
      return null
    }
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return null
  }
}

export function conversationSettingsReturnState(
  location: ReturnableLocation
): SettingsReturnState | undefined {
  const settingsReturnTo = normalizeConversationSettingsReturn(
    `${location.pathname}${location.search}${location.hash}`
  )
  return settingsReturnTo ? { settingsReturnTo } : undefined
}

export function resolveSettingsReturn(state: unknown): string | null {
  if (
    typeof state !== "object" ||
    state === null ||
    !("settingsReturnTo" in state) ||
    typeof state.settingsReturnTo !== "string"
  ) {
    return null
  }

  return (
    normalizeConversationSettingsReturn(state.settingsReturnTo) ??
    resolveCapabilityCenterSettingsReturn(state)
  )
}
