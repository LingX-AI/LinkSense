import { afterEach, describe, expect, it, vi } from "vitest"

import {
  assistantHtmlPreviewCaptureErrorMessageType,
  assistantHtmlPreviewCaptureRequestMessageType,
  assistantHtmlPreviewCaptureSnapshotMessageType,
  assistantHtmlPreviewErrorMessageType,
  assistantHtmlPreviewReadyMessageType,
  assistantHtmlPreviewResizeMessageType,
  assistantHtmlPreviewShellInitializeMessageType,
  assistantHtmlPreviewShellReadyMessageType,
  assistantHtmlPreviewWheelMessageType,
  buildAssistantHtmlPreviewDocument,
  isAssistantHtmlPreviewFrameMessage,
  isAssistantHtmlPreviewShellReadyMessage,
  maximumAssistantHtmlPreviewCaptureSnapshotLength,
  maximumAssistantHtmlPreviewLength,
} from "@/features/conversations/assistant-html-preview-document"

afterEach(() => vi.useRealTimers())

describe("assistant HTML preview document", () => {
  it.each(["loading", "interactive", "complete"] as const)(
    "shows plain HTML when the document is %s without waiting for a CSS framework",
    (initialState) => {
      vi.useFakeTimers()
      const html = buildAssistantHtmlPreviewDocument(
        '<!doctype html><html><body><p style="color: blue">Plain HTML</p></body></html>',
        { previewId: "plain-html" }
      )
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const bootstrap =
        parsed.querySelector("[data-linksense-preview-bootstrap]")
          ?.textContent ?? ""
      let readyState: DocumentReadyState = initialState
      Object.defineProperty(parsed, "readyState", { get: () => readyState })
      const postMessage = vi.fn()
      // Geometry observation is unrelated to document readiness and must not leak between tests.
      class Observer {
        observe() {}
      }
      new Function(
        "document",
        "window",
        "parent",
        "MutationObserver",
        "ResizeObserver",
        bootstrap
      )(parsed, new EventTarget(), { postMessage }, Observer, undefined)
      if (initialState === "loading") {
        expect(postMessage).not.toHaveBeenCalled()
        readyState = "interactive"
        parsed.dispatchEvent(new Event("DOMContentLoaded"))
      }
      expect(postMessage).toHaveBeenCalledWith(
        { type: assistantHtmlPreviewReadyMessageType, previewId: "plain-html" },
        "*"
      )
      expect(
        parsed.documentElement.hasAttribute(
          "data-linksense-assistant-preview-loading"
        )
      ).toBe(false)
      expect(parsed.querySelector("script[src]")).toBeNull()
      vi.advanceTimersByTime(9000)
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: assistantHtmlPreviewErrorMessageType }),
        "*"
      )
    }
  )

  it("preserves authored resources and adds only a scoped readiness bridge", () => {
    const safeDocument = buildAssistantHtmlPreviewDocument(
      `<!doctype html>
        <html>
          <head>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
          </head>
          <body>
            <form id="filters"><input name="query"></form>
            <button class="rounded-xl bg-blue-600 px-4 py-2 text-white">
              Continue
            </button>
            <script type="module" src="https://cdn.example/app.mjs"></script>
          </body>
        </html>`,
      {
        previewId: "preview-1",
      }
    )
    const parsed = new DOMParser().parseFromString(safeDocument, "text/html")
    const runtimes = parsed.querySelectorAll<HTMLScriptElement>(
      "script[data-linksense-trusted-preview-runtime]"
    )
    const bootstrap = parsed.querySelector(
      "script[data-linksense-preview-bootstrap]"
    )

    expect(runtimes).toHaveLength(0)
    expect(
      parsed.querySelector(
        'script[src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"]'
      )
    ).not.toBeNull()
    expect(safeDocument).toContain("https://cdn.example/app.mjs")
    expect(parsed.querySelector("form#filters")).not.toBeNull()
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewReadyMessageType)
    )
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewErrorMessageType)
    )
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewResizeMessageType)
    )
    expect(bootstrap?.textContent).toContain("ResizeObserver")
    expect(bootstrap?.textContent).toContain("scrollHeight")
    expect(bootstrap?.textContent).toContain("min-h-screen")
    expect(bootstrap?.textContent).toContain(
      "data-linksense-preview-sizing-style"
    )
    expect(bootstrap?.textContent).toContain('addEventListener("wheel"')
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewWheelMessageType)
    )
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewCaptureRequestMessageType)
    )
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewCaptureSnapshotMessageType)
    )
    expect(bootstrap?.textContent).toContain(
      JSON.stringify(assistantHtmlPreviewCaptureErrorMessageType)
    )
    expect(bootstrap?.textContent).toContain("buildCaptureSnapshot")
    expect(bootstrap?.textContent).toContain("syncCaptureState")
    expect(bootstrap?.textContent).toContain(
      "data-linksense-capture-scroll-top"
    )
    expect(bootstrap?.textContent).toContain('source.toDataURL("image/png")')
    expect(bootstrap?.textContent).toContain('querySelectorAll("script, iframe')
    expect(bootstrap?.textContent).toContain("script-src 'none'")
    expect(bootstrap?.textContent).toContain("frame-src 'self' data: blob:")
    expect(bootstrap?.textContent).toContain(
      'const html = "<!doctype html>\\n" + clone.outerHTML'
    )
    expect(() => new Function(bootstrap?.textContent ?? "")).not.toThrow()
    expect(bootstrap?.textContent).not.toContain("window.html2canvas")
    expect(bootstrap?.textContent).toContain('const previewId = "preview-1"')
    expect(bootstrap?.textContent).not.toMatch(/tailwind/i)
    expect(bootstrap?.textContent).toContain(
      'document.readyState !== "loading"'
    )
    expect(bootstrap?.textContent).toContain(
      "data-linksense-assistant-preview-loading"
    )
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')
    ).toBeNull()
  })

  it("accepts only scoped lifecycle, resize, and wheel messages", () => {
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewWheelMessageType,
          previewId: "preview-1",
          deltaX: 0,
          deltaY: 240,
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewWheelMessageType,
          previewId: "preview-1",
          deltaX: 0,
          deltaY: Number.POSITIVE_INFINITY,
        },
        "preview-1"
      )
    ).toBe(false)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewCaptureSnapshotMessageType,
          previewId: "preview-1",
          requestId: "capture-1",
          html: "<!doctype html><html><body>Preview</body></html>",
          viewportWidth: 1_200,
          width: 1_200,
          height: 800,
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewCaptureSnapshotMessageType,
          previewId: "preview-1",
          requestId: "capture-1",
          html: "x".repeat(
            maximumAssistantHtmlPreviewCaptureSnapshotLength + 1
          ),
          viewportWidth: 1_200,
          width: 1_200,
          height: 800,
        },
        "preview-1"
      )
    ).toBe(false)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewCaptureErrorMessageType,
          previewId: "preview-1",
          requestId: "capture-1",
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewResizeMessageType,
          previewId: "preview-1",
          height: 1_280,
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewResizeMessageType,
          previewId: "preview-1",
          height: Number.POSITIVE_INFINITY,
        },
        "preview-1"
      )
    ).toBe(false)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewReadyMessageType,
          previewId: "preview-1",
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewErrorMessageType,
          previewId: "preview-1",
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: assistantHtmlPreviewReadyMessageType,
          previewId: "preview-2",
        },
        "preview-1"
      )
    ).toBe(false)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        { type: "linksense:unexpected", previewId: "preview-1" },
        "preview-1"
      )
    ).toBe(false)
  })

  it("accepts only the matching isolated shell readiness message", () => {
    expect(
      isAssistantHtmlPreviewShellReadyMessage(
        {
          type: assistantHtmlPreviewShellReadyMessageType,
          previewId: "preview-1",
        },
        "preview-1"
      )
    ).toBe(true)
    expect(
      isAssistantHtmlPreviewShellReadyMessage(
        {
          type: assistantHtmlPreviewShellInitializeMessageType,
          previewId: "preview-1",
        },
        "preview-1"
      )
    ).toBe(false)
  })

  it("rejects oversized message previews before sanitization", () => {
    expect(() =>
      buildAssistantHtmlPreviewDocument(
        "x".repeat(maximumAssistantHtmlPreviewLength + 1),
        {
          previewId: "preview-large",
        }
      )
    ).toThrow("Assistant HTML preview is too large")
  })
})
