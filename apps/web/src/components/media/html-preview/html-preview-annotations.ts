import { maximumOfficeAnnotationCount } from "@linksense/shared"
import { z } from "zod"

import type { getHtmlPreviewBoundingRect } from "./html-preview-geometry"
import type { HtmlAnnotationMarker, HtmlSelection } from "./html-preview.types"

export const htmlPreviewAnnotationsMessageType =
  "linksense:html-preview:annotations"
export const htmlPreviewAnnotationFramesMessageType =
  "linksense:html-preview:annotation-frames"
export const htmlPreviewAnnotationFocusMessageType =
  "linksense:html-preview:annotation-focus"

const annotationFrameSchema = z
  .object({
    id: z.string().min(1).max(500),
    index: z.number().int().positive(),
    left: z.number().finite(),
    top: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()
const framesMessageSchema = z
  .object({
    type: z.literal(htmlPreviewAnnotationFramesMessageType),
    frames: z.array(annotationFrameSchema).max(maximumOfficeAnnotationCount),
  })
  .strict()
export type HtmlAnnotationFrame = z.infer<typeof annotationFrameSchema>

export function parseHtmlPreviewAnnotationFrames(
  value: unknown
): HtmlAnnotationFrame[] | null {
  const result = framesMessageSchema.safeParse(value)
  return result.success ? result.data.frames : null
}

export function postHtmlPreviewAnnotations(
  frame: HTMLIFrameElement,
  markers: readonly HtmlAnnotationMarker[]
): void {
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewAnnotationsMessageType,
      markers: markers.map(({ id, index, selection }) => ({
        id,
        index,
        selectors: selection.elements.map((element) => element.selector),
      })),
    },
    "*"
  )
}

export function postHtmlPreviewAnnotationFocus(
  frame: HTMLIFrameElement,
  selection: HtmlSelection
): void {
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewAnnotationFocusMessageType,
      selectors: selection.elements.map((element) => element.selector),
    },
    "*"
  )
}

/** Serialized into the opaque iframe: all geometry comes from its live DOM. */
export function installHtmlPreviewAnnotationsController(
  targetWindow: Window,
  config: Readonly<{
    markersMessageType: string
    framesMessageType: string
    focusMessageType: string
    maximumMarkers: number
    maximumElements: number
    annotatedAttribute: string
    getBoundingRect: typeof getHtmlPreviewBoundingRect
  }>
): Readonly<{ refresh: () => void; destroy: () => void }> {
  type Marker = { id: string; index: number; selectors: string[] }
  let markers: Marker[] = []
  const elements = new Map<string, Element>()
  let markedElements = new Set<Element>()
  let animationFrame: number | null = null
  let lastFrames = ""
  let destroyed = false

  const resolveElement = (selector: string) => {
    const cached = elements.get(selector)
    if (cached?.isConnected) return cached
    try {
      const matches = targetWindow.document.querySelectorAll(selector)
      if (matches.length !== 1) return null
      const element = matches[0]
      elements.set(selector, element)
      return element
    } catch {
      return null
    }
  }

  const visibleBounds = (element: Element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    let left = Math.max(0, rect.left)
    let top = Math.max(0, rect.top)
    let right = Math.min(targetWindow.innerWidth, rect.right)
    let bottom = Math.min(targetWindow.innerHeight, rect.bottom)
    for (
      let parent: Element | null = element;
      parent;
      parent = parent.parentElement
    ) {
      const style = targetWindow.getComputedStyle(parent)
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.opacity === "0" ||
        parent.hasAttribute("hidden")
      )
        return null
      if (
        parent === element ||
        parent === targetWindow.document.documentElement ||
        parent === targetWindow.document.body
      )
        continue
      const bounds = parent.getBoundingClientRect()
      if (/auto|scroll|hidden|clip/u.test(style.overflowX)) {
        left = Math.max(left, bounds.left)
        right = Math.min(right, bounds.right)
      }
      if (/auto|scroll|hidden|clip/u.test(style.overflowY)) {
        top = Math.max(top, bounds.top)
        bottom = Math.min(bottom, bounds.bottom)
      }
    }
    return right > left && bottom > top
      ? { left, top, width: right - left, height: bottom - top }
      : null
  }

  const refresh = () => {
    if (destroyed) return
    const nextMarkedElements = new Set<Element>()
    const frames = markers.flatMap((marker) => {
      const rects = marker.selectors.flatMap((selector) => {
        const element = resolveElement(selector)
        if (element) nextMarkedElements.add(element)
        const bounds = element && visibleBounds(element)
        return bounds ? [bounds] : []
      })
      const bounds = config.getBoundingRect(rects)
      return bounds ? [{ id: marker.id, index: marker.index, ...bounds }] : []
    })
    for (const element of markedElements)
      if (!nextMarkedElements.has(element))
        element.removeAttribute(config.annotatedAttribute)
    for (const element of nextMarkedElements)
      if (element.getAttribute(config.annotatedAttribute) !== "true")
        element.setAttribute(config.annotatedAttribute, "true")
    markedElements = nextMarkedElements
    const serialized = JSON.stringify(frames)
    if (serialized !== lastFrames) {
      lastFrames = serialized
      targetWindow.parent.postMessage(
        { type: config.framesMessageType, frames },
        "*"
      )
    }
  }
  const track = () => {
    animationFrame = null
    if (destroyed || markers.length === 0) return
    refresh()
    animationFrame = targetWindow.requestAnimationFrame(track)
  }
  const isSelectors = (value: unknown): value is string[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= config.maximumElements &&
    value.every(
      (selector) =>
        typeof selector === "string" &&
        selector.length > 0 &&
        selector.length <= 1000
    )
  const handleMessage = (event: MessageEvent<unknown>) => {
    if (
      event.source !== targetWindow.parent ||
      !event.data ||
      typeof event.data !== "object"
    )
      return
    const message = event.data as Record<string, unknown>
    if (
      message.type === config.focusMessageType &&
      isSelectors(message.selectors)
    ) {
      const element = message.selectors
        .map(resolveElement)
        .find((candidate) => candidate !== null)
      element?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      })
      refresh()
    }
    if (
      message.type !== config.markersMessageType ||
      !Array.isArray(message.markers) ||
      message.markers.length > config.maximumMarkers
    )
      return
    const next: Marker[] = []
    for (const candidate of message.markers) {
      if (!candidate || typeof candidate !== "object") return
      const value = candidate as Record<string, unknown>
      if (
        typeof value.id !== "string" ||
        !value.id ||
        value.id.length > 500 ||
        typeof value.index !== "number" ||
        !Number.isInteger(value.index) ||
        value.index <= 0 ||
        !isSelectors(value.selectors)
      )
        return
      next.push({
        id: value.id,
        index: value.index,
        selectors: value.selectors,
      })
    }
    markers = next
    const selectors = new Set(markers.flatMap((marker) => marker.selectors))
    for (const selector of elements.keys())
      if (!selectors.has(selector)) elements.delete(selector)
    refresh()
    if (animationFrame !== null)
      targetWindow.cancelAnimationFrame(animationFrame)
    animationFrame = markers.length
      ? targetWindow.requestAnimationFrame(track)
      : null
  }
  targetWindow.addEventListener("message", handleMessage)
  return {
    refresh,
    destroy: () => {
      destroyed = true
      if (animationFrame !== null)
        targetWindow.cancelAnimationFrame(animationFrame)
      elements.clear()
      for (const element of markedElements)
        element.removeAttribute(config.annotatedAttribute)
      markedElements.clear()
      targetWindow.removeEventListener("message", handleMessage)
    },
  }
}
