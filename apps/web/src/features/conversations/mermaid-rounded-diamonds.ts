import { z } from "zod"

const coordinate = z.number().finite()
const diamondCoordinates = z.tuple([
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
  coordinate,
])

// Mermaid's classic renderer uses decision polygons without a corner-radius option.
// Use native SVG quadratic curves, keeping its layout and node styling intact.
export function roundMermaidDiamonds(root: Element): void {
  for (const polygon of root.querySelectorAll(
    ".node > polygon.label-container"
  )) {
    const parsed = diamondCoordinates.safeParse(
      polygon
        .getAttribute("points")
        ?.trim()
        .split(/[\s,]+/u)
        .map(Number)
    )
    if (!parsed.success) continue
    const [x1, y1, x2, y2, x3, y3, x4, y4] = parsed.data
    const points = [
      [x1, y1],
      [x2, y2],
      [x3, y3],
      [x4, y4],
    ] as const
    const left = Math.min(x1, x2, x3, x4)
    const right = Math.max(x1, x2, x3, x4)
    const top = Math.min(y1, y2, y3, y4)
    const bottom = Math.max(y1, y2, y3, y4)
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2
    const halfWidth = (right - left) / 2
    const halfHeight = (bottom - top) / 2
    if (halfWidth <= 0 || halfHeight <= 0) continue
    const near = (a: number, b: number) => Math.abs(a - b) < 0.001
    // Match the four axis-aligned diamond tips; leave other node shapes alone.
    const tips = [
      [cx, top],
      [right, cy],
      [cx, bottom],
      [left, cy],
    ] as const
    if (
      !tips.every(([x, y]) =>
        points.some(([px, py]) => near(px, x) && near(py, y))
      )
    )
      continue
    const side = Math.hypot(halfWidth, halfHeight)
    const inset = Math.min(10, side / 4)
    const dx = (inset * halfWidth) / side
    const dy = (inset * halfHeight) / side
    const path = root.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    )
    for (const attribute of polygon.attributes) {
      if (attribute.name !== "points")
        path.setAttribute(attribute.name, attribute.value)
    }
    path.setAttribute(
      "d",
      [
        `M ${cx + dx} ${top + dy}`,
        `L ${right - dx} ${cy - dy} Q ${right} ${cy} ${right - dx} ${cy + dy}`,
        `L ${cx + dx} ${bottom - dy} Q ${cx} ${bottom} ${cx - dx} ${bottom - dy}`,
        `L ${left + dx} ${cy + dy} Q ${left} ${cy} ${left + dx} ${cy - dy}`,
        `L ${cx - dx} ${top + dy} Q ${cx} ${top} ${cx + dx} ${top + dy} Z`,
      ].join(" ")
    )
    path.append(...polygon.childNodes)
    polygon.replaceWith(path)
  }
}
