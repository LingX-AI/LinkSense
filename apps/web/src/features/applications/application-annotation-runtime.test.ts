import Selecto from "selecto"
import { fireEvent } from "@testing-library/react"
import { parseHtmlPreviewSelectionMessage } from "@/components/media/html-preview/html-preview-selection"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationAnnotationPagePath,
  installApplicationAnnotationRuntime,
} from "./application-annotation-runtime"
import { htmlPreviewAnnotationModeMessageType } from "@/components/media/html-preview/html-preview-selection"

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
const source = "/api/v1/interactive-app-runtime/private-ticket/index.html"

describe("application preview annotation runtime", () => {
  it("uses a relative page path without leaking runtime tickets or query strings", () => {
    expect(
      applicationAnnotationPagePath(
        source,
        `${source}?token=private#details`,
        window.location.origin
      )
    ).toBe("index.html")
    expect(
      applicationAnnotationPagePath(
        source,
        source.replace("index.html", "pages/detail.html"),
        window.location.origin
      )
    ).toBe("pages/detail.html")
  })
  it.each([
    "https://other.example/index.html",
    "/api/v1/interactive-app-runtime/other-ticket/index.html",
    "/conversations",
    "/api/v1/interactive-app-runtime/private-ticket/%2e%2e/index.html",
  ])("rejects a page outside the expected runtime: %s", (current) => {
    expect(
      applicationAnnotationPagePath(source, current, window.location.origin)
    ).toBeNull()
  })
  it("prevents app button activation while selecting in an actual child window and restores it on exit", () => {
    const frame = document.createElement("iframe")
    frame.src = source
    document.body.append(frame)
    const target = frame.contentWindow!
    const previewDocument = target.document
    target.document.open()
    target.document.write(
      '<!doctype html><html><head></head><body><button id="run">Run task</button></body></html>'
    )
    target.document.close()
    const clicked = vi.fn()
    const button = target.document.querySelector("button")!
    button.addEventListener("click", clicked)
    const originalLibrary = () => "app-owned library"
    Reflect.set(target, "Selecto", originalLibrary)
    const ready = vi.fn()
    const error = vi.fn()
    const report = vi.fn()
    const destroy = installApplicationAnnotationRuntime(
      frame,
      source,
      ready,
      error,
      report
    )
    cleanups.push(destroy)
    Reflect.set(target, "Selecto", Selecto)
    target.document.querySelector("script")!.dispatchEvent(new Event("load"))
    expect(Reflect.get(target, "Selecto")).toBe(originalLibrary)
    expect(ready).toHaveBeenCalledWith("index.html")
    const mode = (enabled: boolean) =>
      target.dispatchEvent(
        new MessageEvent("message", {
          source: target.parent,
          data: {
            type: htmlPreviewAnnotationModeMessageType,
            enabled,
            selectionColor: "#0b73e0",
          },
        })
      )
    mode(true)
    expect(target.document.body).toHaveAttribute(
      "data-office-annotation-scope",
      "true"
    )
    button.getBoundingClientRect = () => new DOMRect(20, 30, 100, 40)
    fireEvent.mouseDown(button, {
      clientX: 40,
      clientY: 50,
      button: 0,
      buttons: 1,
    })
    fireEvent.mouseUp(target, {
      clientX: 40,
      clientY: 50,
      button: 0,
      buttons: 0,
    })
    button.click()
    expect(clicked).not.toHaveBeenCalled()
    const selection = report.mock.calls
      .map((call) => parseHtmlPreviewSelectionMessage(call[0]))
      .find((message) =>
        message?.selection?.elements.some(
          (element) => element.selector === "#run"
        )
      )
    expect(selection?.selection?.elements).toEqual([
      expect.objectContaining({
        selector: "#run",
        tagName: "button",
        text: "Run task",
      }),
    ])
    mode(false)
    button.click()
    expect(clicked).toHaveBeenCalledOnce()
    const updatedLibrary = () => "updated app-owned library"
    Reflect.set(target, "Selecto", updatedLibrary)
    const reportCount = report.mock.calls.length
    frame.remove()
    destroy()
    expect(previewDocument.querySelector("script")).toBeNull()
    expect(report).toHaveBeenCalledTimes(reportCount)
    expect(Reflect.get(target, "Selecto")).toBe(updatedLibrary)
    expect(error).not.toHaveBeenCalled()
  })
  it("does not inject a script after navigating outside the app", () => {
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const error = vi.fn()
    cleanups.push(
      installApplicationAnnotationRuntime(
        frame,
        source,
        vi.fn(),
        error,
        vi.fn()
      )
    )
    expect(error).toHaveBeenCalledOnce()
    expect(frame.contentDocument?.querySelector("script")).toBeNull()
  })
})
