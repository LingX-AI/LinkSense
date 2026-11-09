import { isWorkspaceUiDemoEnabled } from "@/features/ui-demo/workspace-ui-demo-mode"

const storageKey = "linksense.knowledge-ui-demo"

export function isKnowledgeUiDemoEnabled(): boolean {
  if (
    !import.meta.env.DEV ||
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
    !/^\/knowledge-bases(?:\/|$)/u.test(window.location.pathname)
  )
    return false

  if (isWorkspaceUiDemoEnabled()) return true
  const requested = new URLSearchParams(window.location.search).get(
    "knowledgeDemo"
  )
  if (requested !== null) return requested === "1"
  return window.sessionStorage.getItem(storageKey) === "1"
}

export function rememberKnowledgeUiDemo(): void {
  if (isWorkspaceUiDemoEnabled()) return
  if (isKnowledgeUiDemoEnabled()) window.sessionStorage.setItem(storageKey, "1")
}

export function exitKnowledgeUiDemo(): void {
  window.sessionStorage.removeItem(storageKey)
  // Reload clears the isolated demo query cache before returning to live data.
  window.location.assign("/knowledge-bases")
}

export function knowledgeUiDemoQueryKey(): readonly string[] {
  return isKnowledgeUiDemoEnabled() ? ["ui-demo"] : []
}
