import { afterEach, describe, expect, it, vi } from "vitest"

import {
  assistantHtmlPreviewCaptureErrorMessageType,
  assistantHtmlPreviewCaptureRequestMessageType,
  assistantHtmlPreviewCaptureSnapshotMessageType,
  assistantHtmlPreviewErrorMessageType,
  assistantHtmlPreviewReadyMessageType,
  assistantHtmlPreviewShellInitializeMessageType,
  assistantHtmlPreviewShellReadyMessageType,
  assistantHtmlPreviewWheelMessageType,
  buildAssistantHtmlPreviewDocument,
  isAssistantHtmlPreviewFrameMessage,
  isAssistantHtmlPreviewShellReadyMessage,
  maximumAssistantHtmlPreviewCaptureSnapshotLength,
  maximumAssistantHtmlPreviewLength,
} from "@/features/conversations/assistant-html-preview-document"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function createPreviewRuntime() {
  vi.useFakeTimers()
  const html = buildAssistantHtmlPreviewDocument(
    '<html><head><style id="authored">body { height: 100vh; overflow: auto; }</style></head><body><input value="initial"><main class="min-h-screen">Interactive scene</main></body></html>',
    { previewId: "fullscreen-preview" }
  )
  const document = new DOMParser().parseFromString(html, "text/html")
  Object.defineProperty(document, "readyState", { value: "complete" })
  const frameWindow = new EventTarget()
  const postMessage = vi.fn()
  const parent = { postMessage }
  new Function(
    "document",
    "window",
    "parent",
    document.querySelector("[data-linksense-preview-bootstrap]")?.textContent ??
      ""
  )(document, frameWindow, parent)
  const sendLayout = (
    mode: unknown,
    {
      source = parent,
      previewId = "fullscreen-preview",
    }: { source?: object; previewId?: string } = {}
  ) => {
    const event = new MessageEvent("message", {
      data: {
        type: "linksense:assistant-html-preview:layout",
        previewId,
        mode,
      },
    })
    Object.defineProperty(event, "source", { value: source })
    frameWindow.dispatchEvent(event)
  }
  const sendCapture = (requestId: string) => {
    const event = new MessageEvent("message", {
      data: {
        type: assistantHtmlPreviewCaptureRequestMessageType,
        previewId: "fullscreen-preview",
        requestId,
      },
    })
    Object.defineProperty(event, "source", { value: parent })
    frameWindow.dispatchEvent(event)
  }
  return { document, frameWindow, postMessage, sendLayout, sendCapture }
}

describe("assistant HTML preview document", () => {
  it("does not measure animated descendants or report their height back to the message", () => {
    const runtime = createPreviewRuntime()
    const scene = runtime.document.querySelector("main")!
    const measure = vi
      .spyOn(scene, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 800, 100_000))
    runtime.postMessage.mockClear()

    scene.style.transform = "translateY(10000px)"
    runtime.frameWindow.dispatchEvent(new Event("resize"))

    expect(measure).not.toHaveBeenCalled()
    expect(runtime.postMessage).not.toHaveBeenCalled()
    measure.mockRestore()
  })

  it("lets the document consume wheel movement until its own scroll boundary", () => {
    const runtime = createPreviewRuntime()
    const root = runtime.document.documentElement
    root.style.overflowY = "auto"
    Object.defineProperties(root, {
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 200 },
    })
    Object.defineProperty(runtime.document, "scrollingElement", {
      configurable: true,
      value: root,
    })
    const wheel = (deltaY = 120) => {
      const event = new WheelEvent("wheel", {
        cancelable: true,
        deltaY,
      })
      Object.defineProperty(event, "target", {
        value: runtime.document.querySelector("main"),
      })
      runtime.frameWindow.dispatchEvent(event)
      return event
    }
    runtime.postMessage.mockClear()

    expect(wheel().defaultPrevented).toBe(false)
    expect(runtime.postMessage).not.toHaveBeenCalled()

    root.scrollTop = 800
    expect(wheel().defaultPrevented).toBe(true)
    expect(runtime.postMessage).toHaveBeenLastCalledWith(
      {
        type: assistantHtmlPreviewWheelMessageType,
        previewId: "fullscreen-preview",
        deltaX: 0,
        deltaY: 120,
      },
      "*"
    )
    expect(wheel(-120).defaultPrevented).toBe(false)
    root.scrollTop = 0
    expect(wheel(-120).defaultPrevented).toBe(true)
  })

  it.each([
    { rootOverflow: "visible", bodyOverflow: "visible", consumed: true },
    { rootOverflow: "visible", bodyOverflow: "hidden", consumed: false },
    { rootOverflow: "visible", bodyOverflow: "clip", consumed: false },
    { rootOverflow: "auto", bodyOverflow: "hidden", consumed: true },
  ])(
    "respects root $rootOverflow and body $bodyOverflow when routing document scrolling",
    ({ rootOverflow, bodyOverflow, consumed }) => {
      const runtime = createPreviewRuntime()
      const root = runtime.document.documentElement
      root.style.overflowY = rootOverflow
      runtime.document.body.style.overflowY = bodyOverflow
      Object.defineProperties(root, {
        scrollHeight: { configurable: true, value: 1_200 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: { configurable: true, value: 200 },
      })
      Object.defineProperty(runtime.document, "scrollingElement", {
        configurable: true,
        value: root,
      })
      const event = new WheelEvent("wheel", { cancelable: true, deltaY: 120 })
      Object.defineProperty(event, "target", {
        value: runtime.document.querySelector("main"),
      })
      runtime.frameWindow.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(!consumed)
      expect(root.style.overflowY).toBe(rootOverflow)
      expect(runtime.document.body.style.overflowY).toBe(bodyOverflow)
    }
  )

  it("forwards wheel movement at the document boundary when body overflow belongs to the viewport", () => {
    const runtime = createPreviewRuntime()
    const root = runtime.document.documentElement
    root.style.overflowX = "visible"
    root.style.overflowY = "visible"
    runtime.document.body.style.overflowY = "auto"
    for (const element of [root, runtime.document.body]) {
      Object.defineProperties(element, {
        scrollHeight: { configurable: true, value: 1_200 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: { configurable: true, value: element === root ? 800 : 0 },
      })
    }
    Object.defineProperty(runtime.document, "scrollingElement", {
      configurable: true,
      value: root,
    })
    const event = new WheelEvent("wheel", { cancelable: true, deltaY: 120 })
    Object.defineProperty(event, "target", {
      value: runtime.document.querySelector("main"),
    })
    runtime.frameWindow.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(runtime.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: assistantHtmlPreviewWheelMessageType }),
      "*"
    )
  })

  it("captures the original viewport separately from the full document dimensions", () => {
    const runtime = createPreviewRuntime()
    Object.defineProperties(runtime.document.documentElement, {
      clientWidth: { value: 800 },
      clientHeight: { value: 480 },
      scrollWidth: { value: 800 },
      scrollHeight: { value: 1_200 },
    })
    runtime.sendCapture("capture-1")
    expect(runtime.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: assistantHtmlPreviewCaptureSnapshotMessageType,
        requestId: "capture-1",
        viewportWidth: 800,
        viewportHeight: 480,
        width: 800,
        height: 1_200,
      }),
      "*"
    )
  })

  it("preserves authored viewport sizing and interaction state in inline and fullscreen modes", () => {
    const runtime = createPreviewRuntime()
    const input = runtime.document.querySelector("input")!
    input.value = "retained interaction"
    const authoredStyle =
      runtime.document.querySelector("#authored")?.textContent

    for (const mode of ["inline", "fullscreen", "inline"]) {
      runtime.sendLayout(mode)
      expect(
        runtime.document.querySelector("[data-linksense-preview-sizing-style]")
      ).toBeNull()
      expect(runtime.document.querySelector("input")).toBe(input)
      expect(input.value).toBe("retained interaction")
      expect(runtime.document.querySelector("#authored")?.textContent).toBe(
        authoredStyle
      )
      expect(
        runtime.document.querySelector("main")?.getAttribute("class")
      ).toBe("min-h-screen")
    }
  })

  it("allows native document scrolling in fullscreen and forwards wheel events again after returning inline", () => {
    const runtime = createPreviewRuntime()
    runtime.sendLayout("fullscreen")
    runtime.postMessage.mockClear()
    const fullscreenWheel = new WheelEvent("wheel", {
      cancelable: true,
      deltaY: 120,
    })
    runtime.frameWindow.dispatchEvent(fullscreenWheel)
    expect(fullscreenWheel.defaultPrevented).toBe(false)
    expect(runtime.postMessage).not.toHaveBeenCalled()

    runtime.sendLayout("inline")
    const inlineWheel = new WheelEvent("wheel", {
      cancelable: true,
      deltaY: 120,
    })
    runtime.frameWindow.dispatchEvent(inlineWheel)
    expect(inlineWheel.defaultPrevented).toBe(true)
    expect(runtime.postMessage).toHaveBeenCalledWith(
      {
        type: assistantHtmlPreviewWheelMessageType,
        previewId: "fullscreen-preview",
        deltaX: 0,
        deltaY: 120,
      },
      "*"
    )
  })

  it("ignores layout changes from another window, a different preview, or an invalid mode", () => {
    const runtime = createPreviewRuntime()
    runtime.sendLayout("fullscreen")

    runtime.sendLayout("inline", { source: {} })
    runtime.sendLayout("inline", { previewId: "another-preview" })
    for (const mode of [null, true, "other", {}]) runtime.sendLayout(mode)

    const fullscreenWheel = new WheelEvent("wheel", {
      cancelable: true,
      deltaY: 120,
    })
    runtime.frameWindow.dispatchEvent(fullscreenWheel)
    expect(fullscreenWheel.defaultPrevented).toBe(false)
    runtime.sendLayout("inline")
    const inlineWheel = new WheelEvent("wheel", {
      cancelable: true,
      deltaY: 120,
    })
    runtime.frameWindow.dispatchEvent(inlineWheel)
    expect(inlineWheel.defaultPrevented).toBe(true)
  })

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
    expect(bootstrap?.textContent).not.toContain("ResizeObserver")
    expect(bootstrap?.textContent).not.toContain("MutationObserver")
    expect(bootstrap?.textContent).toContain("scrollHeight")
    expect(bootstrap?.textContent).not.toContain(
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

  it("accepts only scoped lifecycle, capture, and wheel messages", () => {
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
          viewportHeight: 480,
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
          viewportHeight: 480,
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
          type: "linksense:assistant-html-preview:resize",
          previewId: "preview-1",
          height: 1_280,
        },
        "preview-1"
      )
    ).toBe(false)
    expect(
      isAssistantHtmlPreviewFrameMessage(
        {
          type: "linksense:assistant-html-preview:resize",
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

  it.each([undefined, 0, -1, 100_001, Number.POSITIVE_INFINITY])(
    "rejects capture snapshots with an invalid viewport height %s",
    (viewportHeight) => {
      expect(
        isAssistantHtmlPreviewFrameMessage(
          {
            type: assistantHtmlPreviewCaptureSnapshotMessageType,
            previewId: "preview-1",
            requestId: "capture-1",
            html: "<!doctype html><html><body>Preview</body></html>",
            viewportWidth: 800,
            viewportHeight,
            width: 800,
            height: 1_200,
          },
          "preview-1"
        )
      ).toBe(false)
    }
  )

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
