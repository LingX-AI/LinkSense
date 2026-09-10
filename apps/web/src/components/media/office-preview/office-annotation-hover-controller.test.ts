import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent } from "@testing-library/react"
import { installOfficeAnnotationHover } from "./office-annotation-hover-controller"
import { officeAnnotationCursor } from "./office-annotation-cursor"

let destroy: (() => void) | undefined
afterEach(() => {
  destroy?.()
  destroy = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function setup() {
  vi.useFakeTimers()
  document.body.innerHTML =
    '<section><div id="scope"><p>Text</p></div><svg><path /></svg></section><button>Toolbar</button>'
  const scope = document.querySelector<HTMLElement>("#scope")
  const target = scope?.querySelector("p")
  const overlay = document.querySelector("svg")
  const path = overlay?.querySelector("path")
  if (!scope || !target || !overlay || !path)
    throw new Error("Missing hover fixture")
  scope.getBoundingClientRect = () => new DOMRect(100, 60, 500, 400)
  overlay.getBoundingClientRect = () => new DOMRect(100, 60, 500, 400)
  let bounds = { left: 120, top: 80, width: 180, height: 60 }
  let hit: Element | null = target
  vi.spyOn(document, "elementFromPoint").mockImplementation(() => hit)
  const resolve = vi.fn(() => [bounds])
  destroy = installOfficeAnnotationHover(
    scope,
    overlay,
    resolve,
    officeAnnotationCursor
  )
  return {
    scope,
    target,
    overlay,
    path,
    resolve,
    move: () =>
      fireEvent.pointerMove(target, {
        pointerType: "mouse",
        buttons: 0,
        clientX: 130,
        clientY: 90,
      }),
    setBounds: (next: typeof bounds) => {
      bounds = next
    },
    setHit: (next: Element | null) => {
      hit = next
    },
  }
}

describe("annotation hover tracking", () => {
  it("clips nested scroll containers and uses the displayed size of a zoomed overlay", () => {
    const { scope, target, overlay, path, move } = setup()
    const nestedScroller = document.createElement("div")
    nestedScroller.style.overflowX = "hidden"
    nestedScroller.getBoundingClientRect = () => new DOMRect(130, 60, 100, 200)
    scope.append(nestedScroller)
    nestedScroller.append(target)
    overlay.getBoundingClientRect = () => new DOMRect(100, 60, 1000, 800)
    move()
    vi.advanceTimersByTime(20)
    expect(overlay).toHaveAttribute("viewBox", "0 0 1000 800")
    expect(path).toHaveAttribute("d", "M30,20H130V80H30Z")
  })

  it("updates the hovered area on scroll and zoom without selecting content", () => {
    const fixture = setup()
    fixture.move()
    vi.advanceTimersByTime(20)
    expect(fixture.path).toHaveAttribute("d", "M20,20H200V80H20Z")
    expect(
      fixture.scope.style.getPropertyValue("--office-annotation-cursor")
    ).toContain("data:image/svg+xml")
    fixture.setBounds({ left: 110, top: 40, width: 270, height: 90 })
    vi.advanceTimersByTime(20)
    expect(fixture.path).toHaveAttribute("d", "M10,0H280V70H10Z")
    fixture.setHit(document.querySelector("button"))
    vi.advanceTimersByTime(20)
    expect(fixture.path).not.toHaveAttribute("d")
    const calls = fixture.resolve.mock.calls.length
    vi.advanceTimersByTime(100)
    expect(fixture.resolve).toHaveBeenCalledTimes(calls)
  })

  it("clears hover during dragging, touch input, window exit and mode cleanup", () => {
    const { move, target, path, scope } = setup()
    move()
    vi.advanceTimersByTime(20)
    fireEvent.pointerDown(target, { buttons: 1 })
    expect(path).not.toHaveAttribute("d")
    fireEvent.pointerMove(target, { pointerType: "touch", buttons: 0 })
    vi.advanceTimersByTime(20)
    expect(path).not.toHaveAttribute("d")
    move()
    vi.advanceTimersByTime(20)
    fireEvent.blur(window)
    expect(path).not.toHaveAttribute("d")
    move()
    vi.advanceTimersByTime(20)
    destroy?.()
    destroy = undefined
    expect(path).not.toHaveAttribute("d")
    expect(scope).not.toHaveAttribute("data-office-annotation-scope")
    expect(scope.style.getPropertyValue("--office-annotation-cursor")).toBe("")
  })
})
