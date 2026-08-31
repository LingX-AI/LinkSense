import { afterEach, describe, expect, it, vi } from "vitest"

import { renderAssistantHtmlPreviewSnapshot } from "@/features/conversations/assistant-html-preview-capture"
import type { AssistantHtmlPreviewCaptureSnapshot } from "@/features/conversations/assistant-html-preview-document"
import html2canvas from "html2canvas-pro"

vi.mock("html2canvas-pro", () => ({
  default: vi.fn(),
}))

const snapshot: AssistantHtmlPreviewCaptureSnapshot = {
  html: `<!doctype html><html><body>
    <main>Preview</main>
    <div data-linksense-capture-scroll-top="42"></div>
  </body></html>`,
  viewportWidth: 1_200,
  width: 1_440,
  height: 900,
}

function prepareCaptureDocument(frame: HTMLIFrameElement) {
  const captureDocument = new DOMParser().parseFromString(
    snapshot.html,
    "text/html"
  )
  Object.defineProperty(frame, "contentDocument", {
    configurable: true,
    value: captureDocument,
  })
  return captureDocument
}

describe("assistant HTML preview snapshot capture", () => {
  afterEach(() => {
    vi.mocked(html2canvas).mockReset()
    document
      .querySelectorAll("iframe[aria-hidden='true']")
      .forEach((frame) => frame.remove())
  })

  it("renders the scriptless snapshot in an isolated same-origin frame", async () => {
    const canvas = document.createElement("canvas")
    Object.defineProperty(canvas, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) =>
        callback(new Blob(["png"], { type: "image/png" })),
    })
    vi.mocked(html2canvas).mockResolvedValue(canvas)

    const rendered = renderAssistantHtmlPreviewSnapshot(snapshot)
    const frame = document.querySelector<HTMLIFrameElement>(
      "iframe[aria-hidden='true']"
    )
    expect(frame).not.toBeNull()
    expect(frame?.getAttribute("sandbox")).toBe("allow-same-origin")
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts")
    expect(frame?.srcdoc).toBe(snapshot.html)
    expect(frame?.width).toBe("1200")

    const captureDocument = prepareCaptureDocument(frame!)
    frame!.dispatchEvent(new Event("load"))

    await expect(rendered).resolves.toMatchObject({ type: "image/png" })
    expect(html2canvas).toHaveBeenCalledWith(
      captureDocument.body,
      expect.objectContaining({
        height: 900,
        useCORS: true,
        width: 1_440,
        windowWidth: 1_200,
      })
    )
    expect(
      captureDocument.querySelector<HTMLElement>(
        "[data-linksense-capture-scroll-top]"
      )
    ).toBeNull()
    expect(document.body.contains(frame)).toBe(false)
  })

  it("always removes the temporary frame when rendering fails", async () => {
    vi.mocked(html2canvas).mockRejectedValue(new Error("render failed"))

    const rendered = renderAssistantHtmlPreviewSnapshot(snapshot)
    const frame = document.querySelector<HTMLIFrameElement>(
      "iframe[aria-hidden='true']"
    )
    prepareCaptureDocument(frame!)
    frame!.dispatchEvent(new Event("load"))

    await expect(rendered).rejects.toThrow("render failed")
    expect(document.body.contains(frame)).toBe(false)
  })
})
