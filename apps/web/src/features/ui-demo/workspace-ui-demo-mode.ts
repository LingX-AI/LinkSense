const storageKey = "linksense.workspace-ui-demo"

function isLocalDevelopment(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  )
}

export function isWorkspaceUiDemoEnabled(): boolean {
  if (
    !isLocalDevelopment() ||
    !/^\/(?:automations|capabilities|knowledge-bases)(?:\/|$)/u.test(
      window.location.pathname
    )
  )
    return false
  const requested = new URLSearchParams(window.location.search).get(
    "workspaceDemo"
  )
  if (requested !== null) return requested === "1"
  try {
    return window.sessionStorage.getItem(storageKey) === "1"
  } catch {
    return false
  }
}

export function rememberWorkspaceUiDemo(): void {
  if (!isWorkspaceUiDemoEnabled()) return
  try {
    window.sessionStorage.setItem(storageKey, "1")
  } catch {
    // The explicit URL still works when session storage is unavailable.
  }
}

export function exitWorkspaceUiDemo(): void {
  try {
    window.sessionStorage.removeItem(storageKey)
    window.sessionStorage.removeItem("linksense.knowledge-ui-demo")
  } catch {
    // Navigation can still clear an explicit URL flag without storage access.
  }
  const url = new URL(window.location.href)
  for (const key of ["workspaceDemo", "knowledgeDemo", "pluginDemo"]) {
    url.searchParams.delete(key)
  }
  // A full navigation drops all demo query caches before restoring live data.
  window.location.assign(
    url.pathname.startsWith("/knowledge-bases/")
      ? "/knowledge-bases"
      : `${url.pathname}${url.search}`
  )
}

export function workspaceUiDemoQueryKey(): readonly string[] {
  return isWorkspaceUiDemoEnabled() ? ["workspace-ui-demo"] : []
}

export function shouldUseWorkspaceUiDemo(path: string): boolean {
  return (
    isWorkspaceUiDemoEnabled() &&
    /^\/(?:automations|capabilities|applications|application-center|application-developments|connections|marketplace|mcp-servers|clawhub)(?:\/|$)/u.test(
      path
    )
  )
}

export function shouldBlockWorkspaceUiDemoWrite(path: string): boolean {
  // Keep authentication refresh/logout functional; UI actions cannot write.
  return isWorkspaceUiDemoEnabled() && !path.startsWith("/auth/")
}
