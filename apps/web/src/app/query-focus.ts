import { focusManager } from "@tanstack/react-query"

/**
 * TanStack Query revalidates on document visibility changes only. A Mac window
 * or another application can hand keyboard focus back while the page stays
 * visible, so re-run its focus check on window focus as well: stale queries
 * revalidate in the background with their cached data still on screen.
 */
export function installQueryFocusTracking(): () => void {
  const onWindowFocus = () => {
    // Keep visibility authoritative, then notify subscribers once.
    focusManager.setFocused(undefined)
    focusManager.onFocus()
  }
  window.addEventListener("focus", onWindowFocus)
  return () => {
    window.removeEventListener("focus", onWindowFocus)
    focusManager.setFocused(undefined)
  }
}
