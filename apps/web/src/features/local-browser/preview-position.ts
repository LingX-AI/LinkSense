export const previewCorners = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const
export type PreviewCorner = (typeof previewCorners)[number]
export type PreviewBounds = { width: number; height: number }
type PreviewRect = PreviewBounds & { x: number; y: number }

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

export function previewPositionWithoutOverlap(
  corner: PreviewCorner,
  bounds: PreviewBounds,
  panel: PreviewBounds,
  obstacle?: PreviewRect | null
): { x: number; y: number } | null {
  const preferred = previewCornerPosition(corner, bounds, panel)
  if (!obstacle || obstacle.width <= 0 || obstacle.height <= 0) return preferred
  const clearance = 12
  const clear = (position: { x: number; y: number }) =>
    position.x + panel.width + clearance <= obstacle.x ||
    position.x >= obstacle.x + obstacle.width + clearance ||
    position.y + panel.height + clearance <= obstacle.y ||
    position.y >= obstacle.y + obstacle.height + clearance
  if (clear(preferred)) return preferred
  const distance = (position: { x: number; y: number }) =>
    Math.abs(position.x - preferred.x) + Math.abs(position.y - preferred.y)
  return (
    previewCorners
      .map((next) => previewCornerPosition(next, bounds, panel))
      .sort((left, right) => distance(left) - distance(right))
      .find(clear) ?? null
  )
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
