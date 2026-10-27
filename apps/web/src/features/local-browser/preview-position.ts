export const previewCorners = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const
export type PreviewCorner = (typeof previewCorners)[number]
export type PreviewBounds = { width: number; height: number }

export function previewCornerPosition(
  corner: PreviewCorner,
  bounds: PreviewBounds,
  panel: PreviewBounds
): { x: number; y: number } {
  return {
    x: corner.endsWith("right") ? Math.max(0, bounds.width - panel.width) : 0,
    y: corner.startsWith("bottom")
      ? Math.max(0, bounds.height - panel.height)
      : 0,
  }
}

export function nearestPreviewCorner(
  position: { x: number; y: number },
  bounds: PreviewBounds,
  panel: PreviewBounds
): PreviewCorner {
  const right = position.x >= Math.max(0, bounds.width - panel.width) / 2
  const bottom = position.y >= Math.max(0, bounds.height - panel.height) / 2
  if (bottom) return right ? "bottom-right" : "bottom-left"
  return right ? "top-right" : "top-left"
}

export function readPreviewCorner(key: string): PreviewCorner {
  try {
    const saved = localStorage.getItem(key)
    return previewCorners.find((corner) => corner === saved) ?? "bottom-right"
  } catch {
    return "bottom-right"
  }
}
