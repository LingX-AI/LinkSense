import { afterEach, describe, expect, it, vi } from "vitest"
import { exportMermaidPng } from "@/features/conversations/mermaid-export"

const diagram = {
  url: "data:image/svg+xml,test",
  width: 1800,
  height: 500,
  background: "#ffffff",
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function prepareCanvas() {
  const fillRect = vi.fn()
  const drawImage = vi.fn()
  let canvas: HTMLCanvasElement | undefined
  const original = document.createElement.bind(document)
  vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
    const element = original(tag, options)
    if (element instanceof HTMLCanvasElement) {
      canvas = element
      Object.defineProperty(element, "getContext", {
        value: () => ({ fillRect, drawImage }),
      })
      Object.defineProperty(element, "toBlob", {
        configurable: true,
        writable: true,
        value: (callback: BlobCallback) =>
          callback(new Blob(["png"], { type: "image/png" })),
      })
    }
    return element
  })
  const images: HTMLImageElement[] = []
  vi.spyOn(globalThis, "Image").mockImplementation(function () {
    const image = original("img")
    images.push(image)
    return image
  })
  return { getCanvas: () => canvas!, images, fillRect, drawImage }
}

describe("diagram PNG export", () => {
  it("exports all nodes at double resolution without using viewport dimensions", async () => {
    const capture = prepareCanvas()
    const pending = exportMermaidPng(diagram)
    capture.images[0]!.dispatchEvent(new Event("load"))
    await expect(pending).resolves.toMatchObject({ type: "image/png" })
    expect(capture.getCanvas().width).toBe(3600)
    expect(capture.getCanvas().height).toBe(1000)
    expect(capture.fillRect).toHaveBeenCalledWith(0, 0, 3600, 1000)
    expect(capture.drawImage).toHaveBeenCalledWith(
      capture.images[0],
      0,
      0,
      3600,
      1000
    )
  })
  it("bounds large export memory while retaining the entire image", async () => {
    const capture = prepareCanvas()
    const pending = exportMermaidPng({
      ...diagram,
      width: 30_000,
      height: 20_000,
    })
    capture.images[0]!.dispatchEvent(new Event("load"))
    await pending
    const canvas = capture.getCanvas()
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(20_000_000)
    expect(canvas.width).toBeLessThanOrEqual(16_384)
    expect(canvas.width / canvas.height).toBeCloseTo(1.5, 2)
  })
  it("rejects invalid dimensions before allocating a canvas", async () => {
    const capture = prepareCanvas()
    await expect(exportMermaidPng({ ...diagram, width: 0 })).rejects.toThrow(
      "Invalid diagram dimensions"
    )
    expect(capture.getCanvas()).toBeUndefined()
  })
  it("reports failed images and releases event handlers", async () => {
    const capture = prepareCanvas()
    const pending = exportMermaidPng(diagram)
    capture.images[0]!.dispatchEvent(new Event("error"))
    await expect(pending).rejects.toThrow("Diagram image load failed")
    expect(capture.images[0]!.onload).toBeNull()
  })
  it("does not leave exports waiting indefinitely for image loading", async () => {
    vi.useFakeTimers()
    const capture = prepareCanvas()
    const failure = expect(exportMermaidPng(diagram)).rejects.toThrow(
      "timed out"
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await failure
    expect(capture.images[0]!.onerror).toBeNull()
  })
  it("reports PNG encoding failure", async () => {
    const capture = prepareCanvas()
    const pending = exportMermaidPng(diagram)
    // Canvas API can return null when the image cannot be encoded.
    const canvas = capture.getCanvas()
    vi.spyOn(canvas, "toBlob").mockImplementation((callback) => callback(null))
    capture.images[0]!.dispatchEvent(new Event("load"))
    await expect(pending).rejects.toThrow("Diagram PNG encoding failed")
  })
})
