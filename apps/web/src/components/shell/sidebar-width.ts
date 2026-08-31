export const DEFAULT_SIDEBAR_WIDTH = 248
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH = 440
export const SIDEBAR_WIDTH_STORAGE_KEY = "linksense.sidebarWidth"

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width))
  )
}

export function readStoredSidebarWidth() {
  try {
    const storedWidth = window.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!storedWidth?.trim()) return DEFAULT_SIDEBAR_WIDTH
    return clampSidebarWidth(Number(storedWidth))
  } catch {
    return DEFAULT_SIDEBAR_WIDTH
  }
}

export function persistSidebarWidth(width: number) {
  try {
    window.localStorage?.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(width))
    )
  } catch {
    // Resizing remains available when browser storage is disabled.
  }
}
