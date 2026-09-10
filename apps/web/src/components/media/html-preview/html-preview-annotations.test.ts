import { afterEach, describe, expect, it, vi } from "vitest"
import { htmlAnnotatedAttribute } from "./html-preview-selection"
import {
  htmlPreviewAnnotationsMessageType,
  htmlPreviewAnnotationFramesMessageType,
  htmlPreviewAnnotationFocusMessageType,
  installHtmlPreviewAnnotationsController,
  parseHtmlPreviewAnnotationFrames,
} from "./html-preview-annotations"

let controller:
  ReturnType<typeof installHtmlPreviewAnnotationsController> | undefined
afterEach(() => {
  controller?.destroy()
  controller = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function install() {
  vi.useFakeTimers()
  controller = installHtmlPreviewAnnotationsController(window, {
    markersMessageType: htmlPreviewAnnotationsMessageType,
    framesMessageType: htmlPreviewAnnotationFramesMessageType,
    focusMessageType: htmlPreviewAnnotationFocusMessageType,
    maximumMarkers: 20,
    maximumElements: 20,
    annotatedAttribute: htmlAnnotatedAttribute,
  })
  const postMessage = vi
    .spyOn(window, "postMessage")
    .mockImplementation(() => {})
  return postMessage
}
function setMarkers(selectors: string[]) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        type: htmlPreviewAnnotationsMessageType,
        markers: selectors.length
          ? [{ id: "draft-1", index: 1, selectors }]
          : [],
      },
    })
  )
}

describe("HTML annotation live geometry", () => {
  it("follows scrolling, zoom, layout changes and removed elements without annotation mode", () => {
    document.body.innerHTML = '<div id="target">Selected element</div>'
    const target = document.getElementById("target")
    if (!target) throw new Error("Missing target")
    let bounds = new DOMRect(100, 200, 300, 80)
    target.getBoundingClientRect = () => bounds
    const postMessage = install()
    setMarkers(["#target"])
    const expectFrame = (frame: Partial<DOMRect>) =>
      expect(postMessage).toHaveBeenLastCalledWith(
        {
          type: htmlPreviewAnnotationFramesMessageType,
          frames: [
            expect.objectContaining({
              id: "draft-1",
              index: 1,
              elementIndex: 0,
              ...frame,
            }),
          ],
        },
        "*"
      )
    expectFrame({ left: 100, top: 200, width: 300, height: 80 })
    expect(target).toHaveAttribute(htmlAnnotatedAttribute, "true")
    bounds = new DOMRect(60, 40, 300, 80)
    vi.advanceTimersByTime(20)
    expectFrame({ left: 60, top: 40, width: 300, height: 80 })
    bounds = new DOMRect(90, 60, 450, 120)
    vi.advanceTimersByTime(20)
    expectFrame({ left: 90, top: 60, width: 450, height: 120 })
    bounds = new DOMRect(40, 120, 200, 60)
    vi.advanceTimersByTime(20)
    expectFrame({ left: 40, top: 120, width: 200, height: 60 })
    target.remove()
    vi.advanceTimersByTime(20)
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: htmlPreviewAnnotationFramesMessageType, frames: [] },
      "*"
    )
    setMarkers([])
    expect(target).not.toHaveAttribute(htmlAnnotatedAttribute)
    postMessage.mockClear()
    vi.advanceTimersByTime(100)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("clips nested scrolling content, hides inactive pages and navigates to the live element", () => {
    document.body.innerHTML =
      '<div id="scroller" style="overflow-y: auto"><p id="target">Selected</p></div>'
    const scroller = document.getElementById("scroller")
    const target = document.getElementById("target")
    if (!scroller || !target) throw new Error("Missing fixture")
    scroller.getBoundingClientRect = () => new DOMRect(100, 100, 400, 200)
    target.getBoundingClientRect = () => new DOMRect(120, 80, 160, 100)
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    const postMessage = install()
    setMarkers(["#target", "#missing"])
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: htmlPreviewAnnotationFramesMessageType,
        frames: [
          {
            id: "draft-1",
            index: 1,
            elementIndex: 0,
            left: 120,
            top: 100,
            width: 160,
            height: 80,
          },
        ],
      },
      "*"
    )
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        data: {
          type: htmlPreviewAnnotationFocusMessageType,
          selectors: ["#target"],
        },
      })
    )
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "center",
      behavior: "smooth",
    })
    scroller.style.opacity = "0"
    vi.advanceTimersByTime(20)
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: htmlPreviewAnnotationFramesMessageType, frames: [] },
      "*"
    )
  })

  it("rejects foreign sources, malformed selectors and invalid frame coordinates", () => {
    const postMessage = install()
    window.dispatchEvent(
      new MessageEvent("message", {
        source: null,
        data: { type: htmlPreviewAnnotationsMessageType, markers: [] },
      })
    )
    expect(postMessage).not.toHaveBeenCalled()
    setMarkers(["["])
    expect(postMessage).toHaveBeenLastCalledWith(
      { type: htmlPreviewAnnotationFramesMessageType, frames: [] },
      "*"
    )
    expect(
      parseHtmlPreviewAnnotationFrames({
        type: htmlPreviewAnnotationFramesMessageType,
        frames: [
          {
            id: "a",
            index: 1,
            elementIndex: 0,
            left: Infinity,
            top: 0,
            width: 1,
            height: 1,
          },
        ],
      })
    ).toBeNull()
  })
})
