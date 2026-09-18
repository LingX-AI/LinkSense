import { buildIdSchema, buildInfoSchema } from "@linksense/shared"

let pendingBuild: string | null = null
const listeners = new Set<() => void>()
const reloadParameter = "__linksense_build"

export function getClientBuildId(): string | null {
  const parsed = buildIdSchema.safeParse(
    import.meta.env.VITE_LINKSENSE_BUILD_ID
  )
  return parsed.success ? parsed.data : null
}

export function getPendingClientBuild(): string | null {
  return pendingBuild
}

export function subscribeToClientBuild(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function observeServerBuild(value: string | null): boolean {
  const current = getClientBuildId()
  const parsed = buildIdSchema.safeParse(value)
  if (!current || !parsed.success || parsed.data === current) return false
  if (pendingBuild !== parsed.data) {
    pendingBuild = parsed.data
    for (const listener of listeners) listener()
  }
  return true
}

export async function readPublishedWebBuild(
  signal: AbortSignal
): Promise<string> {
  const response = await fetch("/build-info.json", {
    cache: "no-store",
    signal,
  })
  if (!response.ok) throw new Error("BUILD_INFO_UNAVAILABLE")
  const payload: unknown = await response.json()
  return buildInfoSchema.parse(payload).build_id
}

// A failed import alone is not evidence of a deployment: offline and server
// errors remain ordinary load failures, handled by the route error boundary.
export async function checkForPublishedWebUpdate(): Promise<void> {
  if (!getClientBuildId()) return
  try {
    observeServerBuild(await readPublishedWebBuild(AbortSignal.timeout(10_000)))
  } catch {
    // Preserve the current page and let a later focus/reconnect check recover.
  }
}

export function installClientBuildListeners(): () => void {
  const check = () => {
    void checkForPublishedWebUpdate()
  }
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) check()
  }
  window.addEventListener("vite:preloadError", check)
  window.addEventListener("focus", check)
  window.addEventListener("online", check)
  window.addEventListener("pageshow", onPageShow)
  return () => {
    window.removeEventListener("vite:preloadError", check)
    window.removeEventListener("focus", check)
    window.removeEventListener("online", check)
    window.removeEventListener("pageshow", onPageShow)
  }
}

export function clientUpdateUrl(href: string, buildId: string): string {
  const url = new URL(href)
  url.searchParams.set(reloadParameter, buildIdSchema.parse(buildId))
  return url.href
}

export function clearClientUpdateUrl(): void {
  const url = new URL(window.location.href)
  if (url.searchParams.get(reloadParameter) !== getClientBuildId()) return
  if (!url.searchParams.has(reloadParameter)) return
  url.searchParams.delete(reloadParameter)
  window.history.replaceState(window.history.state, "", url.href)
}
