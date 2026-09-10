import { z } from "zod"
import type { SelectoEvents, SelectoOptions } from "selecto"
import type {
  getHtmlPreviewBoundingRect,
  HtmlPreviewRect,
} from "./html-preview-geometry"

import type { HtmlSelection } from "@/components/media/html-preview/html-preview.types"
import type { OfficeSelectionAnchor } from "@/components/media/office-preview/office-preview.types"
import type { installOfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover-controller"

export const htmlSelectableAttribute = "data-linksense-selectable"
export const htmlSelectedAttribute = "data-linksense-selected"
export const htmlAnnotatedAttribute = "data-linksense-annotated"
export const htmlSelectionOverlayAttribute = "data-linksense-overlay-root"
export const maximumHtmlSelectionCount = 20
export const htmlPreviewAnnotationModeMessageType =
  "linksense:html-preview:annotation-mode"
export const htmlPreviewSelectionMessageType =
  "linksense:html-preview:selection-change"
export const htmlPreviewSelectionClearMessageType =
  "linksense:html-preview:selection-clear"

const finiteNumberSchema = z.number().finite()
const htmlElementBoundsSchema = z
  .object({
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    width: finiteNumberSchema.nonnegative(),
    height: finiteNumberSchema.nonnegative(),
  })
  .strict()
const htmlSelectionSchema = z
  .object({
    elements: z
      .array(
        z
          .object({
            selector: z.string().min(1).max(1_000),
            domPath: z.array(z.number().int().nonnegative()).max(128),
            tagName: z.string().min(1).max(80),
            id: z.string().max(500).optional(),
            classNames: z.array(z.string().max(120)).max(50),
            text: z.string().max(4_000).optional(),
            outerHtml: z.string().max(8_000).optional(),
            attributes: z
              .record(z.string().max(80), z.string().max(500))
              .refine((value) => Object.keys(value).length <= 20),
            bounds: htmlElementBoundsSchema,
          })
          .strict()
      )
      .min(1)
      .max(maximumHtmlSelectionCount),
  })
  .strict()
const htmlPreviewSelectionViewportAnchorSchema = z
  .object({
    right: finiteNumberSchema,
    top: finiteNumberSchema,
    bottom: finiteNumberSchema,
  })
  .strict()
const htmlPreviewSelectionMessageSchema = z
  .object({
    type: z.literal(htmlPreviewSelectionMessageType),
    selection: htmlSelectionSchema.nullable(),
    anchor: htmlPreviewSelectionViewportAnchorSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => (value.selection === null) === (value.anchor === null),
    "Selection and anchor must be present together"
  )

export type HtmlPreviewSelectionMessage = z.infer<
  typeof htmlPreviewSelectionMessageSchema
>
export type HtmlPreviewSelectionViewportAnchor = NonNullable<
  HtmlPreviewSelectionMessage["anchor"]
>

type SelectoInstance = Readonly<{
  on: <Name extends "drag" | "dragEnd" | "selectEnd">(
    event: Name,
    listener: (event: SelectoEvents[Name]) => void
  ) => SelectoInstance
  setSelectedTargets: (elements: readonly Element[]) => unknown
  findSelectableTargets?: () => unknown
  destroy: () => void
}>

type SelectoConstructor = new (
  options: Partial<SelectoOptions>
) => SelectoInstance

export type HtmlPreviewAnnotationController = Readonly<{
  refresh: () => void
  destroy: () => void
}>

export function postHtmlPreviewAnnotationMode(
  frame: HTMLIFrameElement,
  enabled: boolean
) {
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewAnnotationModeMessageType,
      enabled,
      selectionColor: window
        .getComputedStyle(frame.ownerDocument.documentElement)
        .getPropertyValue("--app-selection")
        .trim(),
    },
    "*"
  )
}

export function postHtmlPreviewSelectionClear(
  frame: HTMLIFrameElement,
  selection: HtmlSelection
): void {
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewSelectionClearMessageType,
      selectors: selection.elements.map((element) => element.selector),
    },
    "*"
  )
}

export function parseHtmlPreviewSelectionMessage(value: unknown) {
  const parsed = htmlPreviewSelectionMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function htmlSelectionAnchor(
  frame: HTMLIFrameElement,
  anchor: HtmlPreviewSelectionViewportAnchor | null
): OfficeSelectionAnchor | null {
  if (anchor === null) return null
  const frameRect = frame.getBoundingClientRect()
  return {
    left: frameRect.left + anchor.right,
    top: frameRect.top + anchor.bottom,
  }
}

/**
 * Installs element selection directly into the live, opaque-origin preview.
 *
 * Keep this function self-contained: its source is injected into the preview
 * runtime, where it can operate on the real DOM without granting the parent
 * application same-origin access.
 */
export function installHtmlPreviewAnnotationController(
  targetWindow: Window,
  config: Readonly<{
    modeMessageType: string
    selectionMessageType: string
    clearMessageType: string
    selectableAttribute: string
    selectedAttribute: string
    annotatedAttribute: string
    overlayAttribute: string
    maximumSelectionCount: number
    annotationCursor: string
    installHover: typeof installOfficeAnnotationHover
    getBoundingRect: typeof getHtmlPreviewBoundingRect
  }>
): HtmlPreviewAnnotationController {
  const selectableElementSelector = [
    "article",
    "aside",
    "blockquote",
    "button",
    "canvas",
    "code",
    "dd",
    "details",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "img",
    "input",
    "label",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "picture",
    "pre",
    "section",
    "select",
    "span",
    "summary",
    "svg",
    "table",
    "tbody",
    "td",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    "video",
  ].join(",")
  const metadataAttributeNames = [
    "alt",
    "aria-label",
    "aria-labelledby",
    "colspan",
    "data-id",
    "data-key",
    "data-testid",
    "height",
    "name",
    "placeholder",
    "role",
    "rowspan",
    "title",
    "type",
    "width",
  ]
  const markerValue = `linksense-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`
  const attributeSelector = (name: string) => `[${name}="${markerValue}"]`
  const selectableTargetSelector = attributeSelector(config.selectableAttribute)
  const markedElements = new Set<Element>()
  let selectedElements: Element[] = []
  let dragSelection: HtmlPreviewRect | null = null
  let selecto: SelectoInstance | null = null
  let overlayRoot: HTMLElement | null = null
  let overlayShadow: ShadowRoot | null = null
  let overlayStyles: HTMLStyleElement | null = null
  let selectionFillOverlay: SVGSVGElement | null = null
  let selectionFillAnimationFrame: number | null = null
  let annotationStyles: HTMLStyleElement | null = null
  let selectionColor = ""
  let mutationObserver: MutationObserver | null = null
  let retryAnimationFrame: number | null = null
  let annotationRequested = false
  let destroyed = false

  const boundedText = (
    value: string | null | undefined,
    maximumLength: number
  ) => {
    const bounded = value?.replace(/\s+/gu, " ").trim().slice(0, maximumLength)
    return bounded || undefined
  }

  const cssEscape = (value: string) => {
    const css = Reflect.get(targetWindow, "CSS") as
      { escape?: (input: string) => string } | undefined
    if (typeof css?.escape === "function") return css.escape(value)
    return value.replace(/[^a-zA-Z0-9_-]/gu, (character) => {
      const codePoint = character.codePointAt(0)?.toString(16) ?? "0"
      return `\\${codePoint} `
    })
  }

  const isMeaningfulElement = (element: Element) => {
    if (element.closest(`[${config.overlayAttribute}="${markerValue}"]`)) {
      return false
    }
    if (element.closest('[hidden], [aria-hidden="true"]')) return false
    if (element.closest("[data-linksense-preview-styles]")) return false
    const tagName = element.tagName.toLowerCase()
    if (
      [
        "canvas",
        "hr",
        "img",
        "input",
        "select",
        "svg",
        "textarea",
        "video",
      ].includes(tagName)
    ) {
      return true
    }
    return (
      (element.textContent ?? "").trim().length > 0 ||
      element.children.length > 0
    )
  }

  const refreshSelectableElements = () => {
    const document = targetWindow.document
    const nextElements = new Set(
      [...document.querySelectorAll(selectableElementSelector)].filter(
        isMeaningfulElement
      )
    )
    for (const element of markedElements) {
      if (nextElements.has(element) && element.isConnected) continue
      if (element.getAttribute(config.selectableAttribute) === markerValue) {
        element.removeAttribute(config.selectableAttribute)
      }
      markedElements.delete(element)
    }
    for (const element of nextElements) {
      element.setAttribute(config.selectableAttribute, markerValue)
      markedElements.add(element)
    }
    selecto?.findSelectableTargets?.()
  }

  const normalizeSelectionTargets = (elements: readonly Element[]) => {
    const unique = [...new Set(elements)].filter(
      (element) =>
        element.isConnected &&
        element.getAttribute(config.selectableAttribute) === markerValue
    )
    return unique
      .filter(
        (candidate) =>
          !unique.some(
            (other) => candidate !== other && candidate.contains(other)
          )
      )
      .slice(0, config.maximumSelectionCount)
  }

  const updateSelectionMarkers = (nextElements: readonly Element[]) => {
    for (const element of selectedElements) {
      if (
        !nextElements.includes(element) &&
        element.getAttribute(config.selectedAttribute) === markerValue
      ) {
        element.removeAttribute(config.selectedAttribute)
      }
    }
    for (const element of nextElements) {
      element.setAttribute(config.selectedAttribute, markerValue)
    }
    selectedElements = [...nextElements]
  }

  const uniqueSelector = (element: Element) => {
    const document = targetWindow.document
    const id = element.id.trim()
    if (id) {
      const selector = `#${cssEscape(id)}`
      if (document.querySelectorAll(selector).length === 1) return selector
    }

    for (const attributeName of ["data-testid", "data-id", "data-key"]) {
      const value = element.getAttribute(attributeName)?.trim()
      if (!value) continue
      const selector = `${element.tagName.toLowerCase()}[${attributeName}="${cssEscape(value)}"]`
      try {
        if (document.querySelectorAll(selector).length === 1) return selector
      } catch {
        // Fall back to the structural selector below.
      }
    }

    const segments: string[] = []
    let current: Element | null = element
    while (current && current !== document.body) {
      const tagName = current.tagName.toLowerCase()
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(
            (sibling) => sibling.tagName === current?.tagName
          )
        : []
      const position = Math.max(1, siblings.indexOf(current) + 1)
      segments.unshift(`${tagName}:nth-of-type(${position})`)
      const parentId = current.parentElement?.id.trim()
      if (parentId) {
        segments.unshift(`#${cssEscape(parentId)}`)
        break
      }
      current = current.parentElement
    }
    return segments.join(" > ").slice(0, 1_000)
  }

  const domPath = (element: Element) => {
    const document = targetWindow.document
    const path: number[] = []
    let current: Element | null = element
    while (current?.parentElement && current !== document.body) {
      path.unshift([...current.parentElement.children].indexOf(current))
      current = current.parentElement
    }
    return path.slice(-128)
  }

  const selectionAttributes = (element: Element) => {
    const attributes: Record<string, string> = {}
    for (const name of metadataAttributeNames) {
      const value = element.getAttribute(name)?.trim()
      if (value) attributes[name] = value.slice(0, 500)
    }
    return attributes
  }

  const selectionOuterHtml = (element: Element) => {
    const clone = element.cloneNode(true) as Element
    for (const candidate of [clone, ...clone.querySelectorAll("*")]) {
      candidate.removeAttribute(config.selectableAttribute)
      candidate.removeAttribute(config.selectedAttribute)
      candidate.removeAttribute(config.annotatedAttribute)
      candidate.removeAttribute("value")
    }
    return boundedText(clone.outerHTML, 8_000)
  }

  const buildSelection = (): HtmlSelection => {
    return {
      elements: selectedElements.map((element) => {
        const rect = element.getBoundingClientRect()
        const id = boundedText(element.id, 500)
        const text = boundedText(element.textContent, 4_000)
        const outerHtml = selectionOuterHtml(element)
        const classNames = [...element.classList]
          .filter((className) => !className.startsWith("linksense-"))
          .map((className) => className.slice(0, 120))
          .filter(
            (className, index, values) => values.indexOf(className) === index
          )
          .slice(0, 50)
        return {
          selector: uniqueSelector(element),
          domPath: domPath(element),
          tagName: element.tagName.toLowerCase().slice(0, 80),
          ...(id ? { id } : {}),
          classNames,
          ...(text ? { text } : {}),
          ...(outerHtml ? { outerHtml } : {}),
          attributes: selectionAttributes(element),
          bounds: {
            x: rect.left + targetWindow.scrollX,
            y: rect.top + targetWindow.scrollY,
            width: Math.max(0, rect.width),
            height: Math.max(0, rect.height),
          },
        }
      }),
    }
  }

  const selectionAnchor = () => {
    const bounds = config.getBoundingRect(
      selectedElements.map((element) => element.getBoundingClientRect())
    )
    if (!bounds) return null
    return {
      right: bounds.left + bounds.width,
      top: bounds.top,
      bottom: bounds.top + bounds.height,
    }
  }

  // Paint the frame and tint above the content. An outline on the selected
  // element itself can be clipped by a surrounding image or SVG container.
  const paintSelectionFill = () => {
    if (selectionFillAnimationFrame !== null)
      targetWindow.cancelAnimationFrame(selectionFillAnimationFrame)
    selectionFillAnimationFrame = null
    const overlay = selectionFillOverlay
    const path = overlay?.querySelector("path")
    if (!overlay || !path) return
    const origin = overlay.getBoundingClientRect()
    const viewBox = `0 0 ${Math.max(1, origin.width)} ${Math.max(1, origin.height)}`
    if (overlay.getAttribute("viewBox") !== viewBox)
      overlay.setAttribute("viewBox", viewBox)
    const rects = dragSelection
      ? [dragSelection]
      : selectedElements.flatMap((element) => {
          if (
            !element.isConnected ||
            element.getAttribute(config.annotatedAttribute) === "true"
          )
            return []
          const bounds = element.getBoundingClientRect()
          let left = Math.max(bounds.left, origin.left)
          let top = Math.max(bounds.top, origin.top)
          let right = Math.min(bounds.right, origin.right)
          let bottom = Math.min(bounds.bottom, origin.bottom)
          for (
            let parent = element.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = targetWindow.getComputedStyle(parent)
            const clip = parent.getBoundingClientRect()
            if (/auto|scroll|hidden|clip/u.test(style.overflowX)) {
              left = Math.max(left, clip.left)
              right = Math.min(right, clip.right)
            }
            if (/auto|scroll|hidden|clip/u.test(style.overflowY)) {
              top = Math.max(top, clip.top)
              bottom = Math.min(bottom, clip.bottom)
            }
          }
          return right > left && bottom > top
            ? [{ left, top, width: right - left, height: bottom - top }]
            : []
        })
    const bounds = config.getBoundingRect(rects)
    const shape = bounds
      ? `M${bounds.left - origin.left},${bounds.top - origin.top}H${bounds.left + bounds.width - origin.left}V${bounds.top + bounds.height - origin.top}H${bounds.left - origin.left}Z`
      : ""
    if (path.getAttribute("d") !== shape) path.setAttribute("d", shape)
    if (selectedElements.length > 0 || dragSelection !== null)
      selectionFillAnimationFrame =
        targetWindow.requestAnimationFrame(paintSelectionFill)
  }

  const postSelection = () => {
    paintSelectionFill()
    const anchor = selectionAnchor()
    targetWindow.parent.postMessage(
      {
        type: config.selectionMessageType,
        selection:
          selectedElements.length > 0 && anchor !== null
            ? buildSelection()
            : null,
        anchor,
      },
      "*"
    )
  }

  const refresh = () => {
    if (!annotationRequested || selecto === null) return
    refreshSelectableElements()
    const normalized = normalizeSelectionTargets(selectedElements)
    if (
      normalized.length !== selectedElements.length ||
      normalized.some((element, index) => element !== selectedElements[index])
    ) {
      updateSelectionMarkers(normalized)
      selecto.setSelectedTargets(normalized)
    }
    if (selectedElements.length > 0) postSelection()
  }

  const preventInteractiveActivation = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (
      target.closest(
        "a,button,input,select,textarea,label,summary,[contenteditable='true']"
      )
    ) {
      event.preventDefault()
    }
  }

  const handleScrollOrResize = () => refresh()
  let stopHover: (() => void) | null = null

  const disable = () => {
    if (selectionFillAnimationFrame !== null)
      targetWindow.cancelAnimationFrame(selectionFillAnimationFrame)
    selectionFillAnimationFrame = null
    stopHover?.()
    stopHover = null
    annotationRequested = false
    if (retryAnimationFrame !== null) {
      targetWindow.cancelAnimationFrame(retryAnimationFrame)
      retryAnimationFrame = null
    }
    mutationObserver?.disconnect()
    mutationObserver = null
    targetWindow.removeEventListener("resize", handleScrollOrResize)
    targetWindow.document.removeEventListener(
      "scroll",
      handleScrollOrResize,
      true
    )
    targetWindow.document.removeEventListener(
      "submit",
      preventInteractiveActivation,
      true
    )
    targetWindow.document.removeEventListener(
      "click",
      preventInteractiveActivation,
      true
    )
    selecto?.destroy()
    selecto = null
    dragSelection = null
    updateSelectionMarkers([])
    for (const element of markedElements) {
      if (element.getAttribute(config.selectableAttribute) === markerValue) {
        element.removeAttribute(config.selectableAttribute)
      }
    }
    markedElements.clear()
    overlayRoot?.remove()
    overlayRoot = null
    overlayShadow = null
    overlayStyles = null
    selectionFillOverlay = null
    annotationStyles?.remove()
    annotationStyles = null
    postSelection()
  }

  const updateSelectionStyles = () => {
    if (!annotationStyles) return
    annotationStyles.textContent = `
      [data-office-annotation-scope="true"], [data-office-annotation-scope="true"] * {
        cursor: var(--office-annotation-cursor) !important;
      }
    `
    if (!overlayStyles || !overlayShadow) return
    // Artifact SVG selectors must not style the annotation SVGs. The shadow
    // host also resets layout, clipping and transforms from generic page rules.
    overlayStyles.textContent = `
      :host {
        all: initial !important;
        display: block !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        inset: 0 !important;
        pointer-events: none !important;
      }
      svg {
        all: initial;
        display: block;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
      }
    `
    const hoverPath = overlayShadow.querySelector(
      ".office-annotation-hover-frame"
    )
    hoverPath?.setAttribute(
      "fill",
      `color-mix(in srgb, ${selectionColor} 8%, transparent)`
    )
    hoverPath?.setAttribute(
      "stroke",
      `color-mix(in srgb, ${selectionColor} 42%, white)`
    )
    hoverPath?.setAttribute("stroke-width", "1.5")
    hoverPath?.setAttribute("vector-effect", "non-scaling-stroke")
    const selectionPath = selectionFillOverlay?.querySelector("path")
    selectionPath?.setAttribute(
      "fill",
      `color-mix(in srgb, ${selectionColor} 12%, transparent)`
    )
    selectionPath?.setAttribute("stroke", selectionColor)
    selectionPath?.setAttribute("stroke-width", "2")
    selectionPath?.setAttribute("stroke-dasharray", "6 4")
    selectionPath?.setAttribute("vector-effect", "non-scaling-stroke")
  }

  let selectoLoadAttempts = 0
  const enable = () => {
    if (destroyed) return
    annotationRequested = true
    if (selecto !== null) {
      updateSelectionStyles()
      refresh()
      return
    }
    const document = targetWindow.document
    const body = document.body
    const Selecto = Reflect.get(targetWindow, "Selecto") as
      SelectoConstructor | undefined
    if (!body || typeof Selecto !== "function") {
      selectoLoadAttempts += 1
      if (selectoLoadAttempts <= 120) {
        retryAnimationFrame = targetWindow.requestAnimationFrame(enable)
      }
      return
    }
    selectoLoadAttempts = 0
    retryAnimationFrame = null

    annotationStyles = document.createElement("style")
    annotationStyles.setAttribute("data-linksense-preview-styles", markerValue)
    document.head.append(annotationStyles)

    overlayRoot = document.createElement("div")
    overlayRoot.setAttribute(config.overlayAttribute, markerValue)
    overlayRoot.setAttribute("aria-hidden", "true")
    overlayShadow = overlayRoot.attachShadow({ mode: "open" })
    overlayStyles = document.createElement("style")
    overlayShadow.append(overlayStyles)
    // Do not project Selecto's light-DOM rectangle into this shadow tree: its
    // transform-based positioning does not account for CSS zoom. Paint its
    // public drag rect in the SVG's viewport-sized viewBox instead.
    body.append(overlayRoot)
    refreshSelectableElements()

    selectionFillOverlay = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    )
    selectionFillOverlay.classList.add("html-preview-selection-fill-overlay")
    const selectionFillPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    )
    selectionFillPath.classList.add("html-preview-selection-fill")
    selectionFillOverlay.append(selectionFillPath)
    overlayShadow.append(selectionFillOverlay)

    const hoverOverlay = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    )
    hoverOverlay.classList.add("office-annotation-hover-overlay")
    const hoverPath = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    )
    hoverPath.classList.add("office-annotation-hover-frame")
    hoverOverlay.append(hoverPath)
    overlayShadow.append(hoverOverlay)
    updateSelectionStyles()
    stopHover = config.installHover(
      body,
      hoverOverlay,
      (_point, target) => {
        const candidate = target.closest(selectableTargetSelector)
        if (
          !candidate ||
          selectedElements.includes(candidate) ||
          candidate.getAttribute(config.annotatedAttribute) === "true"
        )
          return []
        return [candidate.getBoundingClientRect()]
      },
      config.annotationCursor
    )

    selecto = new Selecto({
      container: overlayRoot,
      rootContainer: document.documentElement,
      dragContainer: body,
      selectableTargets: [selectableTargetSelector],
      selectByClick: true,
      selectFromInside: true,
      continueSelect: false,
      toggleContinueSelect: "shift",
      keyContainer: targetWindow,
      hitRate: 1,
      preventDefault: false,
      preventClickEventOnDrag: true,
      preventClickEventOnDragStart: false,
    })
    selecto.on("drag", (event) => {
      dragSelection = event.isSelect ? event.rect : null
      paintSelectionFill()
    })
    selecto.on("dragEnd", () => {
      dragSelection = null
      paintSelectionFill()
    })
    selecto.on("selectEnd", (event) => {
      dragSelection = null
      const normalized = normalizeSelectionTargets(event.selected)
      selecto?.setSelectedTargets(normalized)
      updateSelectionMarkers(normalized)
      postSelection()
    })

    targetWindow.document.addEventListener(
      "click",
      preventInteractiveActivation,
      true
    )
    targetWindow.document.addEventListener(
      "submit",
      preventInteractiveActivation,
      true
    )
    targetWindow.document.addEventListener("scroll", handleScrollOrResize, true)
    targetWindow.addEventListener("resize", handleScrollOrResize)
    const observer = new MutationObserver(() => refresh())
    mutationObserver = observer
    observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-hidden"],
    })
    postSelection()
  }

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (
      event.source !== targetWindow.parent ||
      typeof event.data !== "object" ||
      event.data === null
    ) {
      return
    }
    const message = event.data as {
      type?: unknown
      enabled?: unknown
      selectionColor?: unknown
      selectors?: unknown
    }
    if (message.type === config.clearMessageType) {
      const selectors = message.selectors
      if (
        !Array.isArray(selectors) ||
        selectors.length === 0 ||
        selectors.length > config.maximumSelectionCount ||
        !selectors.every(
          (selector) =>
            typeof selector === "string" &&
            selector.length > 0 &&
            selector.length <= 1000
        )
      )
        return
      // A completed request must not erase a different selection made while it was pending.
      if (
        selectors.length !== selectedElements.length ||
        !selectedElements.every((element) =>
          selectors.includes(uniqueSelector(element))
        )
      )
        return
      updateSelectionMarkers([])
      selecto?.setSelectedTargets([])
      postSelection()
      return
    }
    if (
      message.type !== config.modeMessageType ||
      typeof message.enabled !== "boolean"
    ) {
      return
    }
    if (message.enabled) {
      if (typeof message.selectionColor !== "string") return
      // Parse the parent theme color before interpolating it into the iframe CSS.
      const colorStyle = targetWindow.document.createElement("span").style
      colorStyle.color = message.selectionColor
      if (!colorStyle.color) return
      selectionColor = colorStyle.color
      enable()
    } else disable()
  }

  targetWindow.addEventListener("message", handleMessage)

  return {
    refresh,
    destroy: () => {
      if (destroyed) return
      disable()
      destroyed = true
      targetWindow.removeEventListener("message", handleMessage)
    },
  }
}
