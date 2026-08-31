import { z } from "zod"

import type { HtmlSelection } from "@/components/media/html-preview/html-preview.types"
import type { OfficeSelectionAnchor } from "@/components/media/office-preview/office-preview.types"

export const htmlSelectableAttribute = "data-linksense-selectable"
export const htmlSelectedAttribute = "data-linksense-selected"
export const htmlSelectionOverlayAttribute = "data-linksense-overlay-root"
export const maximumHtmlSelectionCount = 20
export const htmlPreviewAnnotationModeMessageType =
  "linksense:html-preview:annotation-mode"
export const htmlPreviewAnnotationFocusMessageType =
  "linksense:html-preview:annotation-focus"
export const htmlPreviewSelectionMessageType =
  "linksense:html-preview:selection-change"

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
  on: (
    event: "selectEnd",
    listener: (event: Readonly<{ selected: readonly Element[] }>) => void
  ) => SelectoInstance
  setSelectedTargets: (elements: readonly Element[]) => unknown
  findSelectableTargets?: () => unknown
  destroy: () => void
}>

type SelectoConstructor = new (
  options: Readonly<Record<string, unknown>>
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
    { type: htmlPreviewAnnotationModeMessageType, enabled },
    "*"
  )
}

export function postHtmlPreviewAnnotationFocus(
  frame: HTMLIFrameElement,
  selection: HtmlSelection
) {
  const bounds = selection.elements
    .map((element) => element.bounds)
    .filter(
      (candidate) =>
        Number.isFinite(candidate.x) &&
        Number.isFinite(candidate.y) &&
        Number.isFinite(candidate.width) &&
        Number.isFinite(candidate.height) &&
        candidate.width > 0 &&
        candidate.height > 0
    )
  if (bounds.length === 0) return
  const left = Math.min(...bounds.map((candidate) => candidate.x))
  const top = Math.min(...bounds.map((candidate) => candidate.y))
  const right = Math.max(
    ...bounds.map((candidate) => candidate.x + candidate.width)
  )
  const bottom = Math.max(
    ...bounds.map((candidate) => candidate.y + candidate.height)
  )
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewAnnotationFocusMessageType,
      bounds: { left, top, width: right - left, height: bottom - top },
    },
    "*"
  )
}

export function parseHtmlPreviewSelectionMessage(value: unknown) {
  const parsed = htmlPreviewSelectionMessageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function htmlSelectionAnchor(
  pane: HTMLElement,
  frame: HTMLIFrameElement,
  anchor: HtmlPreviewSelectionViewportAnchor | null
): OfficeSelectionAnchor | null {
  if (anchor === null) return null
  const frameRect = frame.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  return {
    left: Math.min(
      pane.clientWidth - 8,
      Math.max(8, frameRect.left - paneRect.left + anchor.right)
    ),
    top: Math.min(
      pane.clientHeight - 48,
      Math.max(
        8,
        frameRect.top -
          paneRect.top +
          anchor.top +
          (anchor.bottom - anchor.top) / 2
      )
    ),
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
    focusMessageType: string
    modeMessageType: string
    selectionMessageType: string
    selectableAttribute: string
    selectedAttribute: string
    overlayAttribute: string
    maximumSelectionCount: number
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
  let selecto: SelectoInstance | null = null
  let overlayRoot: HTMLElement | null = null
  let annotationStyles: HTMLStyleElement | null = null
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
    const rects = selectedElements
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    if (rects.length === 0) return null
    return {
      right: Math.max(...rects.map((rect) => rect.right)),
      top: Math.min(...rects.map((rect) => rect.top)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    }
  }

  const postSelection = () => {
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

  const disable = () => {
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
    updateSelectionMarkers([])
    for (const element of markedElements) {
      if (element.getAttribute(config.selectableAttribute) === markerValue) {
        element.removeAttribute(config.selectableAttribute)
      }
    }
    markedElements.clear()
    overlayRoot?.remove()
    overlayRoot = null
    annotationStyles?.remove()
    annotationStyles = null
    postSelection()
  }

  let selectoLoadAttempts = 0
  const enable = () => {
    if (destroyed) return
    annotationRequested = true
    if (selecto !== null) {
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
    annotationStyles.textContent = `
      ${selectableTargetSelector} { cursor: crosshair !important; }
      ${attributeSelector(config.selectedAttribute)} {
        outline: 2px dashed Highlight !important;
        outline-offset: 2px !important;
      }
      ${attributeSelector(config.overlayAttribute)} {
        position: fixed !important;
        z-index: 2147483647 !important;
        inset: 0 !important;
        pointer-events: none !important;
      }
      ${attributeSelector(config.overlayAttribute)} .selecto-selection {
        border: 1px solid Highlight !important;
        background: color-mix(in srgb, Highlight 12%, transparent) !important;
      }
    `
    document.head.append(annotationStyles)

    overlayRoot = document.createElement("div")
    overlayRoot.setAttribute(config.overlayAttribute, markerValue)
    overlayRoot.setAttribute("aria-hidden", "true")
    body.append(overlayRoot)
    refreshSelectableElements()

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
    selecto.on("selectEnd", (event) => {
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
      bounds?: unknown
    }
    if (message.type === config.focusMessageType) {
      if (typeof message.bounds !== "object" || message.bounds === null) {
        return
      }
      const bounds = message.bounds as Record<string, unknown>
      const left = bounds.left
      const top = bounds.top
      const width = bounds.width
      const height = bounds.height
      if (
        typeof left !== "number" ||
        !Number.isFinite(left) ||
        typeof top !== "number" ||
        !Number.isFinite(top) ||
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        width <= 0 ||
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        height <= 0
      ) {
        return
      }
      targetWindow.scrollTo({
        left: Math.max(0, left + width / 2 - targetWindow.innerWidth / 2),
        top: Math.max(0, top + height / 2 - targetWindow.innerHeight / 2),
        behavior: "smooth",
      })
      return
    }
    if (
      message.type !== config.modeMessageType ||
      typeof message.enabled !== "boolean"
    ) {
      return
    }
    if (message.enabled) enable()
    else disable()
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
