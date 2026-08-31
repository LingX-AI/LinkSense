export const MIN_UI_FONT_SIZE = 12
export const DEFAULT_UI_FONT_SIZE = 14
export const MAX_UI_FONT_SIZE = 18
export const UI_FONT_SIZE_STORAGE_KEY = "linksense.uiFontSize"

export function clampUiFontSize(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_UI_FONT_SIZE
  return Math.min(
    MAX_UI_FONT_SIZE,
    Math.max(MIN_UI_FONT_SIZE, Math.round(value))
  )
}

export function normalizeUiFontSize(value: string | number | null | undefined) {
  if (typeof value === "string" && !value.trim()) return null
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_UI_FONT_SIZE ||
    parsed > MAX_UI_FONT_SIZE
  ) {
    return null
  }
  return parsed
}

export function readStoredUiFontSize() {
  try {
    return (
      normalizeUiFontSize(
        window.localStorage?.getItem(UI_FONT_SIZE_STORAGE_KEY)
      ) ?? DEFAULT_UI_FONT_SIZE
    )
  } catch {
    return DEFAULT_UI_FONT_SIZE
  }
}

export function applyUiFontSize(value: number) {
  const fontSize = clampUiFontSize(value)
  const root = document.documentElement
  root.style.setProperty("--app-ui-font-size", `${fontSize}px`)
  root.dataset.uiFontSize = String(fontSize)
}

export function initializeUiFontSize() {
  const fontSize = readStoredUiFontSize()
  applyUiFontSize(fontSize)
  return fontSize
}

export function persistUiFontSize(value: number) {
  try {
    window.localStorage?.setItem(
      UI_FONT_SIZE_STORAGE_KEY,
      String(clampUiFontSize(value))
    )
  } catch {
    // Font-size changes remain available when browser storage is disabled.
  }
}
