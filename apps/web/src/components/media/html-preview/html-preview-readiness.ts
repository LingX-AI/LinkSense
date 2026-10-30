import { z } from "zod"

export const htmlPreviewResourceWaitMs = 4_000
export const htmlPreviewRuntimeStartedMessageType =
  "linksense:html-preview:runtime-started"
export const htmlPreviewResourceStateSchema = z.enum([
  "complete",
  "incomplete",
  "timeout",
])
export type HtmlPreviewResourceState = z.infer<
  typeof htmlPreviewResourceStateSchema
>

/** Serialized into the isolated document. Use only native browser APIs and
 * arguments here; module-scope values are not available inside the iframe. */
export function installHtmlPreviewReadiness(
  target: Window,
  options: Readonly<{
    timeoutMs: number
    prepare: () => void
    onReady: (state: HtmlPreviewResourceState) => void
  }>
) {
  const document = target.document
  const terminalResources = new WeakSet<EventTarget>()
  const previousResources = new WeakSet(
    document.querySelectorAll("link, style")
  )
  const initiallyComplete = document.readyState === "complete"
  let stopped = false
  let incomplete = false
  let version = 0
  let fontVersion = -1
  let fontsSettled = false
  let measureFrame = 0
  let revealFrame = 0

  const stylesPending = () => {
    for (const element of document.querySelectorAll<HTMLLinkElement>(
      "link[rel~='stylesheet' i]"
    )) {
      if (
        !element.getAttribute("href")?.trim() ||
        element.disabled ||
        (element.media && !target.matchMedia(element.media).matches) ||
        (element.relList.contains("alternate") &&
          (!element.sheet || element.sheet.disabled))
      )
        continue
      if (
        !terminalResources.has(element) &&
        !(
          previousResources.has(element) &&
          (initiallyComplete || element.sheet)
        )
      )
        return true
    }
    for (const element of document.querySelectorAll<HTMLStyleElement>(
      "style"
    )) {
      if (
        terminalResources.has(element) ||
        (initiallyComplete && previousResources.has(element))
      )
        continue
      // Native CSSOM identifies real @imports without mistaking comments or
      // string literals for pending network requests.
      if (
        element.sheet?.disabled ||
        (element.media && !target.matchMedia(element.media).matches)
      )
        continue
      const imports = Array.from(element.sheet?.cssRules ?? []).some(
        (rule) => rule.type === CSSRule.IMPORT_RULE
      )
      if (imports) return true
    }
    return false
  }

  const cancelFrames = () => {
    target.cancelAnimationFrame(measureFrame)
    target.cancelAnimationFrame(revealFrame)
    measureFrame = 0
    revealFrame = 0
  }
  const dispose = () => {
    stopped = true
    target.clearTimeout(deadline)
    cancelFrames()
    observer.disconnect()
    document.removeEventListener("DOMContentLoaded", check)
    document.removeEventListener("load", resourceEnded, true)
    document.removeEventListener("error", resourceEnded, true)
    document.fonts?.removeEventListener("loadingerror", fontFailed)
    target.removeEventListener("pagehide", dispose)
  }
  const readyToMeasure = () =>
    document.readyState !== "loading" &&
    !stylesPending() &&
    fontsSettled &&
    fontVersion === version
  const reveal = () => {
    if (stopped || measureFrame || revealFrame) return
    measureFrame = target.requestAnimationFrame(() => {
      measureFrame = 0
      if (!readyToMeasure()) return check()
      options.prepare()
      revealFrame = target.requestAnimationFrame(() => {
        revealFrame = 0
        if (!readyToMeasure()) return check()
        const result = incomplete ? "incomplete" : "complete"
        dispose()
        options.onReady(result)
      })
    })
  }
  const fontFailed = () => {
    incomplete = true
  }
  const resourceEnded = (event: Event) => {
    if (!event.target) return
    terminalResources.add(event.target)
    if (event.type === "error") incomplete = true
    check()
  }
  function check() {
    if (stopped) return
    if (document.readyState === "loading" || stylesPending()) return
    if (fontVersion !== version) {
      fontVersion = version
      fontsSettled = false
      const currentVersion = version
      // Flush layout after CSS so fonts.ready includes fonts used by this page.
      document.documentElement.getBoundingClientRect()
      const ready = document.fonts?.ready
      if (ready) {
        void ready.then(
          () => {
            if (stopped || currentVersion !== version) return
            fontsSettled = true
            check()
          },
          () => {
            if (stopped || currentVersion !== version) return
            incomplete = true
            fontsSettled = true
            check()
          }
        )
      } else fontsSettled = true
    }
    if (fontsSettled) reveal()
  }
  const hasStyle = (node: Node) =>
    node.nodeType === 1 &&
    ((node instanceof Element && node.matches("style, link")) ||
      (node instanceof Element && node.querySelector("style, link") !== null))
  const observer = new MutationObserver((records) => {
    if (
      !records.some(
        (record) =>
          (record.type === "attributes" && hasStyle(record.target)) ||
          record.target.parentElement?.closest("style") ||
          (record.target instanceof Element &&
            record.target.matches("style")) ||
          [...record.addedNodes, ...record.removedNodes].some(hasStyle)
      )
    )
      return
    for (const record of records) {
      if (
        record.type === "attributes" ||
        (record.target instanceof Element && record.target.matches("style"))
      ) {
        terminalResources.delete(record.target)
        if (record.target instanceof Element)
          previousResources.delete(record.target)
      }
    }
    version++
    cancelFrames()
    check()
  })
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["href", "rel", "media", "disabled"],
  })
  document.addEventListener("DOMContentLoaded", check)
  document.addEventListener("load", resourceEnded, true)
  document.addEventListener("error", resourceEnded, true)
  document.fonts?.addEventListener("loadingerror", fontFailed)
  target.addEventListener("pagehide", dispose)
  const deadline = target.setTimeout(() => {
    // A blocked stylesheet or background tab can also delay animation frames.
    // The deadline must reveal available content without waiting for a paint.
    options.prepare()
    dispose()
    options.onReady("timeout")
  }, options.timeoutMs)
  check()
  return dispose
}
