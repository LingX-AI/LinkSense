export type HtmlPreviewRect = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

/** Self-contained so both annotation controllers can use it inside the iframe. */
export function getHtmlPreviewBoundingRect(
  rects: readonly HtmlPreviewRect[]
): HtmlPreviewRect | null {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    if (
      ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    )
      continue
    left = Math.min(left, rect.left)
    top = Math.min(top, rect.top)
    right = Math.max(right, rect.left + rect.width)
    bottom = Math.max(bottom, rect.top + rect.height)
  }
  return right > left && bottom > top
    ? { left, top, width: right - left, height: bottom - top }
    : null
}
