import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installHtmlPreviewReadiness } from "./html-preview-readiness"

const disposals: Array<() => void> = []
let readyState: DocumentReadyState
beforeEach(() => {
  vi.useFakeTimers()
  readyState = "loading"
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => readyState,
  })
  document.head.innerHTML = ""
  document.body.innerHTML = "<p>Available content</p>"
})
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose())
  Reflect.deleteProperty(document, "fonts")
  Reflect.deleteProperty(document, "readyState")
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function setup() {
  const prepare = vi.fn()
  const onReady = vi.fn()
  disposals.push(
    installHtmlPreviewReadiness(window, { timeoutMs: 4_000, prepare, onReady })
  )
  return { prepare, onReady }
}
function addStylesheet() {
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = "/assets/style.css"
  document.head.append(link)
  return link
}
function parsed() {
  readyState = "interactive"
  document.dispatchEvent(new Event("DOMContentLoaded"))
}
async function paint() {
  await vi.advanceTimersByTimeAsync(40)
}

describe("bounded HTML preview readiness", () => {
  it("waits for delayed CSS and fonts before fitting and revealing the document", async () => {
    let finishFonts: (() => void) | undefined
    const fonts = Object.assign(new EventTarget(), {
      ready: new Promise<void>((resolve) => {
        finishFonts = resolve
      }),
    })
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    })
    const f = setup()
    const link = addStylesheet()
    parsed()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(f.onReady).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
    link.dispatchEvent(new Event("load"))
    await paint()
    expect(f.onReady).not.toHaveBeenCalled()
    finishFonts?.()
    await paint()
    expect(f.prepare).toHaveBeenCalledOnce()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
    expect(f.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      f.onReady.mock.invocationCallOrder[0]!
    )
  })
  it("reveals available HTML after a stylesheet fails without waiting for the deadline", async () => {
    const f = setup()
    const link = addStylesheet()
    parsed()
    link.dispatchEvent(new Event("error"))
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("incomplete")
    expect(document.body.textContent).toBe("Available content")
    await vi.advanceTimersByTimeAsync(5_000)
    expect(f.onReady).toHaveBeenCalledOnce()
  })
  it.each(["CSS", "fonts", "parsing"])(
    "reveals available HTML when %s never finishes",
    async (resource) => {
      if (resource === "fonts")
        Object.defineProperty(document, "fonts", {
          configurable: true,
          value: Object.assign(new EventTarget(), {
            ready: new Promise(() => {}),
          }),
        })
      const f = setup()
      if (resource === "CSS") addStylesheet()
      if (resource !== "parsing") parsed()
      await vi.advanceTimersByTimeAsync(3_999)
      expect(f.onReady).not.toHaveBeenCalled()
      await paint()
      expect(f.onReady).toHaveBeenCalledExactlyOnceWith("timeout")
      expect(f.prepare).toHaveBeenCalledOnce()
    }
  )
  it("does not wait for images, video or arbitrary background requests", async () => {
    const f = setup()
    document.body.innerHTML +=
      '<img src="pending.png"><video src="pending.mp4"></video>'
    parsed()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("releases the loading state even when the document never receives an animation frame", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1)
    const f = setup()
    addStylesheet()
    parsed()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("timeout")
    expect(f.prepare).toHaveBeenCalledOnce()
  })
  it("handles cached CSS and a document parsed before installation", async () => {
    readyState = "complete"
    addStylesheet()
    const f = setup()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("waits for a stylesheet inserted while fonts are loading", async () => {
    let finishFonts: (() => void) | undefined
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        ready: new Promise<void>((resolve) => {
          finishFonts = resolve
        }),
      }),
    })
    const f = setup()
    parsed()
    const link = addStylesheet()
    await Promise.resolve()
    finishFonts?.()
    await paint()
    expect(f.onReady).not.toHaveBeenCalled()
    link.dispatchEvent(new Event("load"))
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("treats a font failure as recoverable", async () => {
    const fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() })
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: fonts,
    })
    const f = setup()
    fonts.dispatchEvent(new Event("loadingerror"))
    parsed()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("incomplete")
  })
  it("waits for inline CSS imports and releases the document if an import fails", async () => {
    const f = setup()
    const style = document.createElement("style")
    style.textContent = '@import url("/assets/imported.css");'
    document.head.append(style)
    parsed()
    await paint()
    expect(f.onReady).not.toHaveBeenCalled()
    style.dispatchEvent(new Event("error"))
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("incomplete")
  })
  it("does not wait for an inline CSS import whose media does not match", async () => {
    const f = setup()
    const style = document.createElement("style")
    style.textContent = '@import url("/assets/print.css") print;'
    document.head.append(style)
    parsed()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("ignores disabled stylesheets that do not affect the first view", async () => {
    const f = setup()
    const link = addStylesheet()
    link.disabled = true
    parsed()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("ignores stylesheet placeholders without a resource URL", async () => {
    const f = setup()
    const link = addStylesheet()
    link.removeAttribute("href")
    parsed()
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("waits again when a loaded stylesheet URL changes before the first view", async () => {
    let finishFonts: (() => void) | undefined
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        ready: new Promise<void>((resolve) => {
          finishFonts = resolve
        }),
      }),
    })
    const f = setup()
    const link = addStylesheet()
    parsed()
    link.dispatchEvent(new Event("load"))
    await Promise.resolve()
    link.href = "/assets/replacement.css"
    finishFonts?.()
    await paint()
    expect(f.onReady).not.toHaveBeenCalled()
    link.dispatchEvent(new Event("load"))
    await paint()
    expect(f.onReady).toHaveBeenCalledExactlyOnceWith("complete")
  })
  it("cancels preparation and timers when the document is replaced", async () => {
    const f = setup()
    parsed()
    disposals[0]?.()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(f.onReady).not.toHaveBeenCalled()
    expect(f.prepare).not.toHaveBeenCalled()
  })
})
