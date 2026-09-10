export type OfficeAnnotationHoverRect = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

export type OfficeAnnotationHoverResolver = (
  point: Readonly<{ x: number; y: number }>,
  target: Element
) => readonly OfficeAnnotationHoverRect[]

/** Self-contained so HTML previews can run the same tracking inside their isolated iframe. */
export function installOfficeAnnotationHover(
  scope: HTMLElement,
  overlay: SVGSVGElement,
  resolve: OfficeAnnotationHoverResolver,
  cursor: string
): () => void {
  const document = scope.ownerDocument
  const view = document.defaultView
  const path = overlay.querySelector("path")
  if (!view || !path) return () => {}
  const previousCursor = scope.style.getPropertyValue(
    "--office-annotation-cursor"
  )
  const previousScope = scope.getAttribute("data-office-annotation-scope")
  scope.style.setProperty("--office-annotation-cursor", cursor)
  scope.setAttribute("data-office-annotation-scope", "true")
  let pointer: { x: number; y: number } | null = null
  let frame: number | null = null
  let lastPath = ""
  let lastViewBox = ""
  const clear = () => {
    pointer = null
    if (frame !== null) view.cancelAnimationFrame(frame)
    frame = null
    path.removeAttribute("d")
    lastPath = ""
  }
  const refresh = () => {
    frame = null
    if (!pointer) return
    const hit = document.elementFromPoint(pointer.x, pointer.y)
    if (!hit || !scope.contains(hit)) {
      clear()
      return
    }
    const bounds = scope.getBoundingClientRect()
    const origin = overlay.getBoundingClientRect()
    let clipLeft = Math.max(bounds.left, origin.left)
    let clipTop = Math.max(bounds.top, origin.top)
    let clipRight = Math.min(bounds.right, origin.right)
    let clipBottom = Math.min(bounds.bottom, origin.bottom)
    for (
      let ancestor: Element | null = hit;
      ancestor && ancestor !== scope;
      ancestor = ancestor.parentElement
    ) {
      const style = view.getComputedStyle(ancestor)
      const clip = ancestor.getBoundingClientRect()
      if (/auto|scroll|hidden|clip/u.test(style.overflowX)) {
        clipLeft = Math.max(clipLeft, clip.left)
        clipRight = Math.min(clipRight, clip.right)
      }
      if (/auto|scroll|hidden|clip/u.test(style.overflowY)) {
        clipTop = Math.max(clipTop, clip.top)
        clipBottom = Math.min(clipBottom, clip.bottom)
      }
    }
    const viewBox = `0 0 ${Math.max(1, origin.width)} ${Math.max(1, origin.height)}`
    if (viewBox !== lastViewBox) {
      overlay.setAttribute("viewBox", viewBox)
      lastViewBox = viewBox
    }
    const nextPath = resolve(pointer, hit)
      .flatMap((rect) => {
        if (
          ![rect.left, rect.top, rect.width, rect.height].every(
            Number.isFinite
          ) ||
          rect.width <= 0 ||
          rect.height <= 0
        )
          return []
        const left = Math.max(clipLeft, rect.left) - origin.left
        const top = Math.max(clipTop, rect.top) - origin.top
        const right = Math.min(clipRight, rect.left + rect.width) - origin.left
        const bottom = Math.min(clipBottom, rect.top + rect.height) - origin.top
        return right > left && bottom > top
          ? [`M${left},${top}H${right}V${bottom}H${left}Z`]
          : []
      })
      .join(" ")
    if (nextPath !== lastPath) {
      path.setAttribute("d", nextPath)
      lastPath = nextPath
    }
    frame = view.requestAnimationFrame(refresh)
  }
  const move = (event: PointerEvent) => {
    if (
      event.pointerType === "touch" ||
      event.buttons !== 0 ||
      !(event.target instanceof view.Element) ||
      !scope.contains(event.target)
    ) {
      clear()
      return
    }
    pointer = { x: event.clientX, y: event.clientY }
    if (frame === null) frame = view.requestAnimationFrame(refresh)
  }
  const leave = (event: PointerEvent) => {
    if (!event.relatedTarget) clear()
  }
  view.addEventListener("pointermove", move, true)
  view.addEventListener("pointerup", move, true)
  view.addEventListener("pointerdown", clear, true)
  view.addEventListener("pointercancel", clear, true)
  view.addEventListener("pointerout", leave, true)
  view.addEventListener("blur", clear)
  return () => {
    clear()
    view.removeEventListener("pointermove", move, true)
    view.removeEventListener("pointerup", move, true)
    view.removeEventListener("pointerdown", clear, true)
    view.removeEventListener("pointercancel", clear, true)
    view.removeEventListener("pointerout", leave, true)
    view.removeEventListener("blur", clear)
    if (previousScope === null)
      scope.removeAttribute("data-office-annotation-scope")
    else scope.setAttribute("data-office-annotation-scope", previousScope)
    if (previousCursor)
      scope.style.setProperty("--office-annotation-cursor", previousCursor)
    else scope.style.removeProperty("--office-annotation-cursor")
  }
}
