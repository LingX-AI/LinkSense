import { downloadApiFile } from "@/api/client"

const MAX_CACHED_SITE_ICON_REQUESTS = 64
const siteIconRequests = new Map<string, Promise<Blob | null>>()

export function getHttpsSiteIconOrigin(href?: string): string | null {
  if (!href) return null

  try {
    const url = new URL(href)
    return url.protocol === "https:" ? url.origin : null
  } catch {
    return null
  }
}

export function isExternalHttpLink(href?: string): boolean {
  if (!href) return false

  try {
    const url = new URL(href)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function loadSiteIcon(origin: string): Promise<Blob | null> {
  const existing = siteIconRequests.get(origin)
  if (existing) return existing

  if (siteIconRequests.size >= MAX_CACHED_SITE_ICON_REQUESTS) {
    const oldestOrigin = siteIconRequests.keys().next().value
    if (oldestOrigin) siteIconRequests.delete(oldestOrigin)
  }

  const download = downloadApiFile("/site-icons", { origin }).then((blob) =>
    blob.size > 0 ? blob : null
  )
  const request = download.catch(() => null)
  siteIconRequests.set(origin, request)
  void download.catch(() => {
    if (siteIconRequests.get(origin) === request) {
      siteIconRequests.delete(origin)
    }
  })
  return request
}
