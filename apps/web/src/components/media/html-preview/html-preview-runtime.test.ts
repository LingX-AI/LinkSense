import { afterEach, describe, expect, it, vi } from "vitest"
import { buildUnrestrictedHtmlPreviewDocument } from "./html-preview-sanitizer"
import {
  buildAssistantHtmlPreviewDocument,
  assistantHtmlPreviewReadyMessageType,
} from "@/features/conversations/assistant-html-preview-document"
import { htmlPreviewReadyMessageType } from "./html-preview-fit"

const frames: HTMLIFrameElement[] = []
afterEach(() => {
  frames.splice(0).forEach((frame) => {
    frame.contentWindow?.dispatchEvent(new Event("pagehide"))
    frame.remove()
  })
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe.each(["file", "inline"] as const)(
  "serialized %s HTML preview runtime",
  (kind) => {
    function setup() {
      vi.useFakeTimers()
      const raw =
        '<!doctype html><head><link rel="stylesheet" href="assets/style.css"></head><body><button>Keep state</button><img src="pending.png"></body>'
      const html =
        kind === "file"
          ? buildUnrestrictedHtmlPreviewDocument(raw, "/selecto.js")
          : buildAssistantHtmlPreviewDocument(raw, {
              previewId: "runtime-test",
            })
      const parsed = new DOMParser().parseFromString(html, "text/html")
      const bootstrap = parsed.querySelector(
        "[data-linksense-preview-bootstrap]"
      )?.textContent
      parsed.querySelectorAll("script").forEach((script) => script.remove())
      const frame = document.createElement("iframe")
      document.body.append(frame)
      frames.push(frame)
      const target = frame.contentWindow!
      target.document.open()
      target.document.write(parsed.documentElement.outerHTML)
      target.document.close()
      // Drive real document events with a deterministic clock; no network request
      // or authored script is needed to exercise the shipped bootstrap itself.
      target.requestAnimationFrame = window.requestAnimationFrame.bind(window)
      target.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
      target.setTimeout = window.setTimeout.bind(window)
      target.clearTimeout = window.clearTimeout.bind(window)
      let readyState = "loading"
      Object.defineProperty(target.document, "readyState", {
        get: () => readyState,
      })
      const post = vi
        .spyOn(target.parent, "postMessage")
        .mockImplementation(() => {})
      expect(bootstrap).toBeTruthy()
      const evaluate: unknown = Reflect.get(target, "eval")
      if (typeof evaluate !== "function")
        throw new Error("Preview frame must provide a script context")
      evaluate.call(target, bootstrap)
      const readyType =
        kind === "file"
          ? htmlPreviewReadyMessageType
          : assistantHtmlPreviewReadyMessageType
      const readyMessages = () =>
        post.mock.calls
          .map((call) => {
            const message: unknown = call[0]
            return message
          })
          .filter(
            (message) =>
              typeof message === "object" &&
              message !== null &&
              "type" in message &&
              message.type === readyType
          )
      readyState = "interactive"
      target.document.dispatchEvent(new Event("DOMContentLoaded"))
      return { target, readyMessages }
    }

    it("reveals only after CSS and initial layout, keeping the same document", async () => {
      const f = setup()
      const button = f.target.document.querySelector("button")!
      button.dataset.state = "preserved"
      await vi.advanceTimersByTimeAsync(2_000)
      expect(f.readyMessages()).toEqual([])
      f.target.document.querySelector("link")!.dispatchEvent(new Event("load"))
      await vi.advanceTimersByTimeAsync(40)
      expect(f.readyMessages()).toEqual([
        expect.objectContaining({ resourceState: "complete" }),
      ])
      expect(f.target.document.querySelector("button")).toBe(button)
      expect(button.dataset.state).toBe("preserved")
      if (kind === "file")
        expect(
          f.target.document.documentElement.dataset.linksenseAppliedScale
        ).toBe("1")
      else
        expect(
          f.target.document.documentElement.hasAttribute(
            "data-linksense-assistant-preview-loading"
          )
        ).toBe(false)
    })
    it.each(["error", "timeout"] as const)(
      "reveals available content after a resource %s",
      async (failure) => {
        const f = setup()
        if (failure === "error")
          f.target.document
            .querySelector("link")!
            .dispatchEvent(new Event("error"))
        await vi.advanceTimersByTimeAsync(failure === "timeout" ? 4_040 : 40)
        expect(f.readyMessages()).toEqual([
          expect.objectContaining({
            resourceState: failure === "timeout" ? "timeout" : "incomplete",
          }),
        ])
        expect(f.target.document.body.textContent).toContain("Keep state")
        if (kind === "inline")
          expect(
            f.target.document.documentElement.hasAttribute(
              "data-linksense-assistant-preview-loading"
            )
          ).toBe(false)
      }
    )
  }
)
