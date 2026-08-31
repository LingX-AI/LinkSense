import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent as ReactSyntheticEvent,
  type TouchEvent as ReactTouchEvent,
} from "react"
import { useDrag, usePinch } from "@use-gesture/react"
import {
  PowerPointViewer,
  type PowerPointViewerHandle,
} from "pptx-react-viewer"
import { I18nextProvider, useTranslation } from "react-i18next"

import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
import { createPresentationViewerI18n } from "@/components/media/presentation-preview/pptx-viewer-i18n"
import type { OfficeSelectionAnchor } from "@/components/media/office-preview/office-preview.types"
import type {
  PresentationAnnotationMarker,
  PresentationElementBounds,
  PresentationElementSelection,
  PresentationSelection,
} from "@/components/media/presentation-preview/presentation-preview.types"
import { Button } from "@/components/ui/button"

export type PresentationSelectionAnchor = OfficeSelectionAnchor

type PresentationSelectionFrame = Readonly<{
  key: string
  kind: "selection" | "annotation"
  elementId: string
  annotationId?: string
  annotationIndex?: number
  left: number
  top: number
  width: number
  height: number
}>

type PresentationPanOffset = Readonly<{
  x: number
  y: number
}>

type PresentationPanBounds = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

type PresentationWheelAnchor = Readonly<{
  viewport: HTMLElement
  clientX: number
  clientY: number
  ratioX: number
  ratioY: number
}>

export type PptxViewerAdapterHandle = Readonly<{
  goToSlide: (slideIndex: number) => void
  zoomIn: () => void
  zoomOut: () => void
  zoomReset: () => void
}>

type PptxViewerAdapterProps = Readonly<{
  content: Uint8Array
  fileName: string
  selectElementLabel: string
  selectionEnabled: boolean
  annotationMarkers?: readonly PresentationAnnotationMarker[]
  onSelectionChange: (selection: PresentationSelection | null) => void
  onSelectionAnchorChange: (anchor: PresentationSelectionAnchor | null) => void
  onActiveSlideChange: (slideIndex: number) => void
  onZoomChange: (zoom: number) => void
  onSlideCountChange: (count: number) => void
}>

type UnknownRecord = Record<string, unknown>

const selectionTextLimit = 2_000
const textPropertyNames = new Set([
  "alttext",
  "category",
  "label",
  "text",
  "title",
])
const ignoredPropertyPattern =
  /(base64|binary|dataurl|image|rawxml|src|svg|xml)/iu
const mobileActionsSelector = "[data-pptx-viewer] > div > .contents > nav"
const desktopSlidesNavigationSelector =
  '[data-pptx-viewer] > div > .relative.z-10 > aside[role="navigation"]'
const compactSlidesSurfaceSelector =
  "[data-pptx-compact-slides-trigger], [data-pptx-mobile-slides-sheet]"
const compactSlidesCloseDelay = 140
const minimumZoom = 0.2
const maximumZoom = 5
const minimumVisibleSlidePixels = 64
const initialLayoutStableFrameCount = 2
const emptyPresentationAnnotationMarkers: readonly PresentationAnnotationMarker[] =
  []

function measuredElementSize(element: HTMLElement) {
  const bounds = element.getBoundingClientRect()
  return {
    width: element.clientWidth || bounds.width,
    height: element.clientHeight || bounds.height,
  }
}

function presentationViewerLayoutFits(root: HTMLElement) {
  const viewport = root.querySelector<HTMLElement>("[data-pptx-viewport]")
  const slideWrapper = viewport?.firstElementChild
  if (!viewport || !(slideWrapper instanceof HTMLElement)) return false

  const viewportSize = measuredElementSize(viewport)
  const slideSize = measuredElementSize(slideWrapper)
  if (
    viewportSize.width <= 0 ||
    viewportSize.height <= 0 ||
    slideSize.width <= 0 ||
    slideSize.height <= 0
  ) {
    // DOM-only test environments do not calculate layout. The consecutive
    // frame check still prevents exposing the viewer in its mount frame.
    return true
  }

  return (
    slideSize.width <= viewportSize.width + 1 &&
    slideSize.height <= viewportSize.height + 1
  )
}

function findMobileActions(root: HTMLElement) {
  return root.querySelector<HTMLElement>(mobileActionsSelector)
}

function findDesktopSlidesNavigation(root: HTMLElement) {
  return root.querySelector<HTMLElement>(desktopSlidesNavigationSelector)
}

function findSlidesPaneToggle(root: HTMLElement, accessibleLabel: string) {
  return [
    ...root.querySelectorAll<HTMLButtonElement>(
      '[role="toolbar"] button[aria-label]'
    ),
  ].find((button) => button.getAttribute("aria-label") === accessibleLabel)
}

function findMobileSlidesSheet(root: HTMLElement) {
  const marked = root.querySelector<HTMLElement>(
    "[data-pptx-mobile-slides-sheet]"
  )
  if (marked) return marked
  return [...root.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
    (dialog) => Boolean(dialog.querySelector('aside[role="navigation"]'))
  )
}

function closestCompactSlidesSurface(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(compactSlidesSurfaceSelector)
    : null
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readIdentifier(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function collectElementText(
  value: unknown,
  output: string[],
  seen: Set<object>,
  depth = 0,
  propertyName = ""
) {
  if (depth > 6 || output.join("\n").length >= selectionTextLimit) return
  if (typeof value === "string") {
    const normalizedName = propertyName.toLowerCase()
    if (
      textPropertyNames.has(normalizedName) ||
      normalizedName.endsWith("text") ||
      normalizedName.endsWith("title") ||
      normalizedName.endsWith("label")
    ) {
      const text = value.trim()
      if (text) output.push(text)
    }
    return
  }
  if (!isRecord(value) && !Array.isArray(value)) return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      collectElementText(item, output, seen, depth + 1, propertyName)
    }
    return
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (ignoredPropertyPattern.test(key)) continue
    collectElementText(nestedValue, output, seen, depth + 1, key)
  }
}

function summarizeText(element: unknown) {
  const values: string[] = []
  collectElementText(element, values, new Set())
  const unique = [...new Set(values)]
  const text = unique.join("\n").slice(0, selectionTextLimit).trim()
  return text || undefined
}

function elementBounds(element: UnknownRecord): PresentationElementBounds {
  const rotation = readNumber(element.rotation, Number.NaN)
  return {
    x: readNumber(element.x),
    y: readNumber(element.y),
    width: readNumber(element.width),
    height: readNumber(element.height),
    ...(Number.isFinite(rotation) ? { rotation } : {}),
  }
}

function summarizeElement(
  elementId: string,
  element: unknown
): PresentationElementSelection {
  const record = isRecord(element) ? element : {}
  const text = summarizeText(record)
  const shapeId = readIdentifier(record.shapeId)
  const name = readString(record.name)
  return {
    elementId,
    ...(shapeId ? { shapeId } : {}),
    type: readString(record.type) ?? "unknown",
    ...(name ? { name } : {}),
    ...(text ? { text } : {}),
    bounds: elementBounds(record),
  }
}

function elementIdFromValue(value: unknown) {
  return isRecord(value) ? readIdentifier(value.id) : undefined
}

function isSelectionLocked(value: unknown) {
  if (!isRecord(value) || !isRecord(value.locks)) return false
  return value.locks.noSelect === true
}

function closestElementNode(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(
        "[data-pptx-viewport] [data-pptx-element][data-element-id]"
      )
    : null
}

function closestViewport(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>("[data-pptx-viewport]")
    : null
}

function selectionFramesEqual(
  current: readonly PresentationSelectionFrame[],
  next: readonly PresentationSelectionFrame[]
) {
  return (
    current.length === next.length &&
    current.every((frame, index) => {
      const candidate = next[index]
      return (
        candidate !== undefined &&
        frame.key === candidate.key &&
        frame.kind === candidate.kind &&
        frame.elementId === candidate.elementId &&
        frame.annotationId === candidate.annotationId &&
        frame.annotationIndex === candidate.annotationIndex &&
        frame.left === candidate.left &&
        frame.top === candidate.top &&
        frame.width === candidate.width &&
        frame.height === candidate.height
      )
    })
  )
}

function selectionFrameStyle(frame: PresentationSelectionFrame): CSSProperties {
  return {
    left: frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
  }
}

function isTouchPointerEvent(event: UIEvent) {
  return "pointerType" in event && event.pointerType === "touch"
}

function clampZoom(zoom: number) {
  return Math.min(maximumZoom, Math.max(minimumZoom, zoom))
}

function clampValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function presentationSlideWrapper(viewport: HTMLElement) {
  return viewport.firstElementChild instanceof HTMLElement
    ? viewport.firstElementChild
    : null
}

function presentationPanBounds(
  viewport: HTMLElement,
  offset: PresentationPanOffset
): PresentationPanBounds | null {
  const slide = presentationSlideWrapper(viewport)
  if (!slide) return null

  const viewportRect = viewport.getBoundingClientRect()
  const slideRect = slide.getBoundingClientRect()
  if (
    viewportRect.width <= 0 ||
    viewportRect.height <= 0 ||
    slideRect.width <= 0 ||
    slideRect.height <= 0
  ) {
    return null
  }

  const slideLeftWithoutPan = slideRect.left - offset.x
  const slideTopWithoutPan = slideRect.top - offset.y
  const visibleWidth = Math.min(minimumVisibleSlidePixels, slideRect.width / 2)
  const visibleHeight = Math.min(
    minimumVisibleSlidePixels,
    slideRect.height / 2
  )

  return {
    left:
      viewportRect.left +
      visibleWidth -
      (slideLeftWithoutPan + slideRect.width),
    right: viewportRect.right - visibleWidth - slideLeftWithoutPan,
    top:
      viewportRect.top +
      visibleHeight -
      (slideTopWithoutPan + slideRect.height),
    bottom: viewportRect.bottom - visibleHeight - slideTopWithoutPan,
  }
}

function clampPanOffset(
  offset: PresentationPanOffset,
  bounds: PresentationPanBounds | null
): PresentationPanOffset {
  if (!bounds) return offset
  return {
    x: clampValue(offset.x, bounds.left, bounds.right),
    y: clampValue(offset.y, bounds.top, bounds.bottom),
  }
}

function stopCapturedEvent(event: ReactSyntheticEvent<HTMLDivElement>) {
  event.preventDefault()
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation?.()
}

export const PptxViewerAdapter = forwardRef<
  PptxViewerAdapterHandle,
  PptxViewerAdapterProps
>(function PptxViewerAdapter(
  {
    content,
    fileName,
    selectElementLabel,
    selectionEnabled,
    annotationMarkers = emptyPresentationAnnotationMarkers,
    onSelectionChange,
    onSelectionAnchorChange,
    onActiveSlideChange,
    onZoomChange,
    onSlideCountChange,
  },
  ref
) {
  const { t, i18n: appI18n } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PowerPointViewerHandle>(null)
  const selectedIdsRef = useRef<readonly string[]>([])
  const anchorFrameRef = useRef<number | null>(null)
  const panOffsetRef = useRef<PresentationPanOffset>({ x: 0, y: 0 })
  const panningViewportRef = useRef<HTMLElement | null>(null)
  const panConstraintFrameRef = useRef<number | null>(null)
  const wheelAnchorRef = useRef<PresentationWheelAnchor | null>(null)
  const wheelAnchorFrameRef = useRef<number | null>(null)
  const zoomRef = useRef(1)
  const pinchingRef = useRef(false)
  const dirtyRecoveryRef = useRef(false)
  const compactSlidesTriggerRef = useRef<HTMLButtonElement>(null)
  const restoringCompactSlidesFocusRef = useRef(false)
  const compactSlidesOpenRef = useRef(false)
  const compactSlidesCloseTimerRef = useRef<number | null>(null)
  const mobileSlidesSyncingRef = useRef(false)
  const desktopSlidesRestoringRef = useRef(false)
  const lastTriggerPointerTypeRef = useRef<string | null>(null)
  const viewerSurfaceReadyRef = useRef(false)
  const viewerLayoutFrameRef = useRef<number | null>(null)
  const viewerLayoutStableFramesRef = useRef(0)
  const [viewerRevision, setViewerRevision] = useState(0)
  const [compactSlidesOpen, setCompactSlidesOpen] = useState(false)
  const [activeSlideIndex, setActiveSlideIndex] = useState(0)
  const [slideCount, setSlideCount] = useState(0)
  const [viewerSurfaceReady, setViewerSurfaceReady] = useState(false)
  const [selectionFrames, setSelectionFrames] = useState<
    readonly PresentationSelectionFrame[]
  >([])
  const compactSlidesPanelId = `pptx-compact-slides-${useId()}`
  const viewerI18n = useMemo(
    () => createPresentationViewerI18n(appI18n.resolvedLanguage),
    [appI18n.resolvedLanguage]
  )
  const viewerReady = slideCount > 0 && viewerSurfaceReady

  const resetViewerSurfaceReady = useCallback(() => {
    if (viewerLayoutFrameRef.current !== null) {
      window.cancelAnimationFrame(viewerLayoutFrameRef.current)
      viewerLayoutFrameRef.current = null
    }
    viewerLayoutStableFramesRef.current = 0
    viewerSurfaceReadyRef.current = false
    setViewerSurfaceReady(false)
  }, [])

  const scheduleViewerSurfaceReady = useCallback(() => {
    if (
      viewerSurfaceReadyRef.current ||
      viewerLayoutFrameRef.current !== null
    ) {
      return
    }

    const inspectLayout = () => {
      viewerLayoutFrameRef.current = null
      const root = rootRef.current
      if (!root?.querySelector("[data-pptx-viewport]")) {
        viewerLayoutStableFramesRef.current = 0
        return
      }
      if (!presentationViewerLayoutFits(root)) {
        viewerLayoutStableFramesRef.current = 0
        viewerLayoutFrameRef.current =
          window.requestAnimationFrame(inspectLayout)
        return
      }

      viewerLayoutStableFramesRef.current += 1
      if (viewerLayoutStableFramesRef.current < initialLayoutStableFrameCount) {
        viewerLayoutFrameRef.current =
          window.requestAnimationFrame(inspectLayout)
        return
      }

      viewerSurfaceReadyRef.current = true
      setViewerSurfaceReady(true)
    }

    viewerLayoutFrameRef.current = window.requestAnimationFrame(inspectLayout)
  }, [])

  const updateCompactSlidesOpen = useCallback((open: boolean) => {
    compactSlidesOpenRef.current = open
    setCompactSlidesOpen(open)
  }, [])

  const restoreCompactSlidesTriggerFocus = useCallback(() => {
    restoringCompactSlidesFocusRef.current = true
    compactSlidesTriggerRef.current?.focus({ preventScroll: true })
    queueMicrotask(() => {
      restoringCompactSlidesFocusRef.current = false
    })
  }, [])

  const cancelCompactSlidesClose = useCallback(() => {
    if (compactSlidesCloseTimerRef.current === null) return
    window.clearTimeout(compactSlidesCloseTimerRef.current)
    compactSlidesCloseTimerRef.current = null
  }, [])

  const scheduleCompactSlidesClose = useCallback(() => {
    cancelCompactSlidesClose()
    compactSlidesCloseTimerRef.current = window.setTimeout(() => {
      compactSlidesCloseTimerRef.current = null
      if (closestCompactSlidesSurface(document.activeElement)) return
      updateCompactSlidesOpen(false)
    }, compactSlidesCloseDelay)
  }, [cancelCompactSlidesClose, updateCompactSlidesOpen])

  const topLevelElementMap = useCallback(() => {
    const elements = viewerRef.current?.getElements() ?? []
    return new Map(
      elements.flatMap((element) => {
        const id = elementIdFromValue(element)
        return id ? [[id, element] as const] : []
      })
    )
  }, [])

  const resolveTopLevelElement = useCallback(
    (node: HTMLElement) => {
      const elements = topLevelElementMap()
      let current: HTMLElement | null = node
      while (current && rootRef.current?.contains(current)) {
        const id = current.dataset.elementId
        const element = id ? elements.get(id) : undefined
        if (id && element) return { id, element }
        current =
          current.parentElement?.closest<HTMLElement>(
            "[data-pptx-element][data-element-id]"
          ) ?? null
      }
      return null
    },
    [topLevelElementMap]
  )

  const updateSelectionGeometry = useCallback(() => {
    if (anchorFrameRef.current !== null) {
      window.cancelAnimationFrame(anchorFrameRef.current)
    }
    anchorFrameRef.current = window.requestAnimationFrame(() => {
      anchorFrameRef.current = null
      const root = rootRef.current
      if (!root) {
        setSelectionFrames((current) => (current.length ? [] : current))
        onSelectionAnchorChange(null)
        return
      }
      const selectedIds = selectionEnabled ? selectedIdsRef.current : []
      const selectedIdSet = new Set(selectedIds)
      const elementNodes = [
        ...root.querySelectorAll<HTMLElement>(
          "[data-pptx-viewport] [data-pptx-element][data-element-id]"
        ),
      ]
      const selectableNodes = elementNodes.filter(
        (node) => node.dataset.pptxSelectable === "true"
      )
      const elementNodesById = new Map<string, HTMLElement[]>()
      for (const node of elementNodes) {
        const elementId = node.dataset.elementId
        if (!elementId) continue
        const current = elementNodesById.get(elementId) ?? []
        current.push(node)
        elementNodesById.set(elementId, current)
      }
      const activeSlideIndex = viewerRef.current?.getActiveSlideIndex()
      const visibleAnnotationMarkers =
        activeSlideIndex === undefined
          ? []
          : annotationMarkers.filter(
              (marker) => marker.selection.slideIndex === activeSlideIndex
            )
      for (const node of selectableNodes) {
        if (selectedIdSet.has(node.dataset.elementId ?? "")) {
          node.dataset.pptxSelectionActive = "true"
        } else {
          delete node.dataset.pptxSelectionActive
        }
      }
      for (const node of elementNodes) {
        if (node.dataset.pptxSelectable === "true") continue
        delete node.dataset.pptxSelectionActive
      }
      if (selectedIds.length === 0 && visibleAnnotationMarkers.length === 0) {
        setSelectionFrames((current) => (current.length ? [] : current))
        onSelectionAnchorChange(null)
        return
      }
      const rootRect = root.getBoundingClientRect()
      const viewportRect = root
        .querySelector<HTMLElement>("[data-pptx-viewport]")
        ?.getBoundingClientRect()
      const hasRootBounds = rootRect.width > 0 && rootRect.height > 0
      const hasViewportBounds =
        viewportRect && viewportRect.width > 0 && viewportRect.height > 0
      const visibleLeft = hasViewportBounds
        ? Math.max(0, viewportRect.left - rootRect.left)
        : hasRootBounds
          ? 0
          : Number.NEGATIVE_INFINITY
      const visibleTop = hasViewportBounds
        ? Math.max(0, viewportRect.top - rootRect.top)
        : hasRootBounds
          ? 0
          : Number.NEGATIVE_INFINITY
      const visibleRight = hasViewportBounds
        ? Math.min(rootRect.width, viewportRect.right - rootRect.left)
        : hasRootBounds
          ? rootRect.width
          : Number.POSITIVE_INFINITY
      const visibleBottom = hasViewportBounds
        ? Math.min(rootRect.height, viewportRect.bottom - rootRect.top)
        : hasRootBounds
          ? rootRect.height
          : Number.POSITIVE_INFINITY
      const frameForNode = (
        node: HTMLElement,
        metadata: Pick<
          PresentationSelectionFrame,
          "key" | "kind" | "annotationId" | "annotationIndex"
        >
      ): PresentationSelectionFrame | null => {
        const rect = node.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return null
        const left = Math.max(visibleLeft, rect.left - rootRect.left)
        const top = Math.max(visibleTop, rect.top - rootRect.top)
        const right = Math.min(visibleRight, rect.right - rootRect.left)
        const bottom = Math.min(visibleBottom, rect.bottom - rootRect.top)
        if (right <= left || bottom <= top) return null
        return {
          ...metadata,
          elementId: node.dataset.elementId ?? "",
          left,
          top,
          width: right - left,
          height: bottom - top,
        }
      }
      const selectedFrames = selectableNodes.flatMap((node) => {
        const elementId = node.dataset.elementId ?? ""
        if (!selectedIdSet.has(elementId)) return []
        const frame = frameForNode(node, {
          key: `selection:${elementId}`,
          kind: "selection",
        })
        return frame ? [frame] : []
      })
      const annotationFrames = visibleAnnotationMarkers.flatMap((marker) =>
        marker.selection.elementIds.flatMap((elementId, elementIndex) =>
          (elementNodesById.get(elementId) ?? []).flatMap((node, nodeIndex) => {
            const frame = frameForNode(node, {
              key: `annotation:${marker.id}:${elementId}:${elementIndex}:${nodeIndex}`,
              kind: "annotation",
              annotationId: marker.id,
              annotationIndex: marker.index,
            })
            return frame ? [frame] : []
          })
        )
      )
      const nextFrames = [...selectedFrames, ...annotationFrames]
      setSelectionFrames((current) =>
        selectionFramesEqual(current, nextFrames) ? current : nextFrames
      )
      if (!selectedFrames.length) {
        onSelectionAnchorChange(null)
        return
      }
      const selectedRight = Math.max(
        ...selectedFrames.map((frame) => frame.left + frame.width)
      )
      const selectedBottom = Math.max(
        ...selectedFrames.map((frame) => frame.top + frame.height)
      )
      onSelectionAnchorChange({
        left: Math.min(
          Math.max(selectedRight, 136),
          Math.max(8, rootRect.width - 8)
        ),
        top: Math.min(
          Math.max(selectedBottom, 0),
          Math.max(0, rootRect.height - 40)
        ),
      })
    })
  }, [annotationMarkers, onSelectionAnchorChange, selectionEnabled])

  const applyPanOffset = useCallback(
    ({ x, y }: PresentationPanOffset) => {
      const nextOffset = {
        x: Math.round(x * 1_000) / 1_000,
        y: Math.round(y * 1_000) / 1_000,
      }
      panOffsetRef.current = nextOffset
      const root = rootRef.current
      if (!root) return
      root.style.setProperty("--presentation-pan-x", `${nextOffset.x}px`)
      root.style.setProperty("--presentation-pan-y", `${nextOffset.y}px`)
      updateSelectionGeometry()
    },
    [updateSelectionGeometry]
  )

  const constrainCurrentPan = useCallback(
    (viewport?: HTMLElement | null) => {
      const resolvedViewport =
        viewport ??
        rootRef.current?.querySelector<HTMLElement>("[data-pptx-viewport]")
      if (!resolvedViewport) return
      const currentOffset = panOffsetRef.current
      const nextOffset = clampPanOffset(
        currentOffset,
        presentationPanBounds(resolvedViewport, currentOffset)
      )
      if (
        nextOffset.x === currentOffset.x &&
        nextOffset.y === currentOffset.y
      ) {
        return
      }
      applyPanOffset(nextOffset)
    },
    [applyPanOffset]
  )

  const cancelWheelAnchor = useCallback(() => {
    wheelAnchorRef.current = null
    if (wheelAnchorFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelAnchorFrameRef.current)
    }
    wheelAnchorFrameRef.current = null
  }, [])

  const resetPanOffset = useCallback(() => {
    cancelWheelAnchor()
    if (panConstraintFrameRef.current !== null) {
      window.cancelAnimationFrame(panConstraintFrameRef.current)
      panConstraintFrameRef.current = null
    }
    panningViewportRef.current = null
    if (rootRef.current) rootRef.current.dataset.pptxPanning = "false"
    applyPanOffset({ x: 0, y: 0 })
  }, [applyPanOffset, cancelWheelAnchor])

  const schedulePanConstraint = useCallback(() => {
    if (wheelAnchorFrameRef.current !== null) return
    if (panConstraintFrameRef.current !== null) {
      window.cancelAnimationFrame(panConstraintFrameRef.current)
    }
    panConstraintFrameRef.current = window.requestAnimationFrame(() => {
      panConstraintFrameRef.current = null
      if (wheelAnchorFrameRef.current !== null) return
      constrainCurrentPan()
    })
  }, [constrainCurrentPan])

  const scheduleWheelAnchor = useCallback(
    (anchor: PresentationWheelAnchor) => {
      const pendingAnchor = wheelAnchorRef.current
      if (pendingAnchor) {
        wheelAnchorRef.current = {
          ...pendingAnchor,
          viewport: anchor.viewport,
          clientX: anchor.clientX,
          clientY: anchor.clientY,
        }
        return
      }

      wheelAnchorRef.current = anchor
      wheelAnchorFrameRef.current = window.requestAnimationFrame(() => {
        wheelAnchorFrameRef.current = window.requestAnimationFrame(() => {
          const resolvedAnchor = wheelAnchorRef.current
          wheelAnchorRef.current = null
          wheelAnchorFrameRef.current = null
          const root = rootRef.current
          if (
            !root ||
            !resolvedAnchor ||
            !root.contains(resolvedAnchor.viewport)
          ) {
            return
          }
          const slide = presentationSlideWrapper(resolvedAnchor.viewport)
          if (!slide) return
          const slideRect = slide.getBoundingClientRect()
          if (slideRect.width <= 0 || slideRect.height <= 0) return

          const currentOffset = panOffsetRef.current
          const anchoredOffset = {
            x:
              currentOffset.x +
              resolvedAnchor.clientX -
              (slideRect.left + resolvedAnchor.ratioX * slideRect.width),
            y:
              currentOffset.y +
              resolvedAnchor.clientY -
              (slideRect.top + resolvedAnchor.ratioY * slideRect.height),
          }
          applyPanOffset(
            clampPanOffset(
              anchoredOffset,
              presentationPanBounds(resolvedAnchor.viewport, currentOffset)
            )
          )
        })
      })
    },
    [applyPanOffset]
  )

  const emitSelection = useCallback(
    (ids: readonly string[]) => {
      const viewer = viewerRef.current
      const nextIds = selectionEnabled ? ids : []
      selectedIdsRef.current = nextIds
      if (!selectionEnabled && ids.length > 0) {
        viewer?.clearSelection()
      }
      if (!viewer || nextIds.length === 0) {
        if (annotationMarkers.length === 0) {
          setSelectionFrames((current) => (current.length ? [] : current))
        }
        onSelectionChange(null)
        onSelectionAnchorChange(null)
        updateSelectionGeometry()
        return
      }
      const slideIndex = viewer.getActiveSlideIndex()
      const elements = nextIds.map((id) =>
        summarizeElement(id, viewer.getElementById(id, slideIndex))
      )
      onSelectionChange({
        slideIndex,
        slideNumber: slideIndex + 1,
        elementIds: [...nextIds],
        elements,
      })
      updateSelectionGeometry()
    },
    [
      annotationMarkers.length,
      onSelectionAnchorChange,
      onSelectionChange,
      selectionEnabled,
      updateSelectionGeometry,
    ]
  )

  const selectNode = useCallback(
    (node: HTMLElement, additive: boolean) => {
      if (!selectionEnabled) return
      const resolved = resolveTopLevelElement(node)
      if (!resolved || isSelectionLocked(resolved.element)) return
      const current = additive ? selectedIdsRef.current : []
      const next = current.includes(resolved.id)
        ? current.filter((id) => id !== resolved.id)
        : [...current, resolved.id]
      viewerRef.current?.selectElements(next)
      emitSelection(next)
    },
    [emitSelection, resolveTopLevelElement, selectionEnabled]
  )

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    const compactSlideItem =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-pptx-compact-slide-item]")
        : null
    if (compactSlideItem) {
      const slideIndex = Number.parseInt(
        compactSlideItem.dataset.pptxCompactSlideIndex ?? "",
        10
      )
      if (
        !Number.isInteger(slideIndex) ||
        slideIndex < 0 ||
        slideIndex >= slideCount
      ) {
        return
      }
      stopCapturedEvent(event)
      cancelCompactSlidesClose()
      viewerRef.current?.goTo(slideIndex)
      return
    }
    if (!selectionEnabled) return
    const node = closestElementNode(event.target)
    if (node) {
      stopCapturedEvent(event)
      node.focus({ preventScroll: true })
      selectNode(node, event.shiftKey || event.metaKey || event.ctrlKey)
      return
    }
    if (
      event.target instanceof Element &&
      event.target.closest("[data-pptx-viewport]")
    ) {
      stopCapturedEvent(event)
      viewerRef.current?.clearSelection()
      emitSelection([])
    }
  }

  const blockElementAction = (event: ReactSyntheticEvent<HTMLDivElement>) => {
    if (!selectionEnabled) return
    if (!closestElementNode(event.target)) return
    stopCapturedEvent(event)
  }

  const handlePointerOverCapture = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (closestCompactSlidesSurface(event.target)) {
      cancelCompactSlidesClose()
    }
    blockElementAction(event)
  }

  const handlePointerOutCapture = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (
      event.pointerType !== "touch" &&
      closestCompactSlidesSurface(event.target) &&
      !closestCompactSlidesSurface(event.relatedTarget)
    ) {
      scheduleCompactSlidesClose()
    }
  }

  const handleFocusCapture = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (closestCompactSlidesSurface(event.target)) {
      cancelCompactSlidesClose()
    }
  }

  const handleBlurCapture = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (
      closestCompactSlidesSurface(event.target) &&
      !closestCompactSlidesSurface(event.relatedTarget)
    ) {
      scheduleCompactSlidesClose()
    }
  }

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!selectionEnabled) return
    const node = closestElementNode(event.target)
    if (node && (event.key === "Enter" || event.key === " ")) {
      stopCapturedEvent(event)
      selectNode(node, event.shiftKey || event.metaKey || event.ctrlKey)
      return
    }
    const targetInViewport =
      event.target instanceof Element &&
      Boolean(event.target.closest("[data-pptx-viewport]"))
    const mutationShortcut =
      (event.metaKey || event.ctrlKey) &&
      ["v", "x"].includes(event.key.toLowerCase())
    if (
      targetInViewport &&
      (["Backspace", "Delete"].includes(event.key) || mutationShortcut)
    ) {
      stopCapturedEvent(event)
    }
  }

  const bindCanvasDrag = useDrag(
    ({ offset: [x, y], distance, event, last }) => {
      const root = rootRef.current
      const viewport =
        panningViewportRef.current ?? closestViewport(event.target)
      if (
        !root ||
        !viewport ||
        !root.contains(viewport) ||
        isTouchPointerEvent(event)
      ) {
        if (last) {
          panningViewportRef.current = null
          if (root) root.dataset.pptxPanning = "false"
        }
        return
      }

      const dragging = Math.max(...distance) > 4
      if (dragging) applyPanOffset({ x, y })
      root.dataset.pptxPanning = String(dragging && !last)
      if (last) panningViewportRef.current = null
    },
    {
      eventOptions: { capture: true },
      filterTaps: true,
      tapsThreshold: 4,
      threshold: 0,
      from: () => [panOffsetRef.current.x, panOffsetRef.current.y],
      bounds: () => {
        const viewport =
          panningViewportRef.current ??
          rootRef.current?.querySelector<HTMLElement>("[data-pptx-viewport]")
        return viewport
          ? (presentationPanBounds(viewport, panOffsetRef.current) ?? {})
          : {}
      },
      rubberband: 0,
      pointer: { buttons: 1, capture: false, keys: false },
    }
  )
  const canvasDragHandlers = bindCanvasDrag()

  usePinch(
    ({ active, offset: [nextScale], origin: [clientX, clientY], event }) => {
      pinchingRef.current = active
      const root = rootRef.current
      const viewport = closestViewport(event.target)
      const viewer = viewerRef.current
      if (!root || !viewport || !root.contains(viewport) || !viewer) return

      if (event.cancelable) event.preventDefault()
      const currentZoom = zoomRef.current
      const nextZoom = Math.round(clampZoom(nextScale) * 1_000) / 1_000
      if (nextZoom === currentZoom) return

      const slide = presentationSlideWrapper(viewport)
      const slideRect = slide?.getBoundingClientRect()
      if (slideRect && slideRect.width > 0 && slideRect.height > 0) {
        scheduleWheelAnchor({
          viewport,
          clientX,
          clientY,
          ratioX: (clientX - slideRect.left) / slideRect.width,
          ratioY: (clientY - slideRect.top) / slideRect.height,
        })
      } else {
        cancelWheelAnchor()
      }

      zoomRef.current = nextZoom
      viewer.setZoom(nextZoom)
    },
    {
      target: rootRef,
      eventOptions: { capture: true, passive: false },
      from: () => [zoomRef.current, 0],
      scaleBounds: { min: minimumZoom, max: maximumZoom },
      rubberband: 0,
      pointer: { touch: true },
    }
  )

  const handleTouchCapture = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (pinchingRef.current || event.touches.length >= 2) return
    blockElementAction(event)
  }

  const handleGesturePointerDownCapture = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const viewport = closestViewport(event.target)
    if (
      viewport &&
      event.pointerType !== "touch" &&
      (event.buttons & 1) === 1
    ) {
      panningViewportRef.current = viewport
      canvasDragHandlers.onPointerDownCapture?.(event)
    }
    blockElementAction(event)
  }

  const handleGestureClickCapture = (
    event: ReactMouseEvent<HTMLDivElement>
  ) => {
    if (closestViewport(event.target)) {
      canvasDragHandlers.onClickCapture?.(event)
      if (event.defaultPrevented || event.isPropagationStopped()) return
    }
    handleClickCapture(event)
  }

  const decorateElements = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const elements = topLevelElementMap()
    let index = 0
    for (const node of root.querySelectorAll<HTMLElement>(
      "[data-pptx-viewport] [data-pptx-element][data-element-id]"
    )) {
      const id = node.dataset.elementId
      const element = id ? elements.get(id) : undefined
      if (!selectionEnabled || !id || !element || isSelectionLocked(element)) {
        delete node.dataset.pptxSelectable
        delete node.dataset.pptxSelectionActive
        node.tabIndex = -1
        continue
      }
      node.dataset.pptxSelectable = "true"
      node.tabIndex = 0
      if (!node.getAttribute("aria-label")) {
        node.setAttribute("aria-label", `${selectElementLabel} ${index + 1}`)
      }
      index += 1
    }
  }, [selectElementLabel, selectionEnabled, topLevelElementMap])

  const decorateMobileChrome = useCallback(() => {
    const root = rootRef.current
    if (!root) return

    const mobileActions = findMobileActions(root)
    if (mobileActions) mobileActions.dataset.pptxMobileActions = "true"

    const sheet = findMobileSlidesSheet(root)
    if (!sheet) return
    sheet.dataset.pptxMobileSlidesSheet = "true"
    sheet.id = compactSlidesPanelId
    sheet.setAttribute("aria-label", t("presentation.slideNavigator"))
    sheet.setAttribute("aria-modal", "false")

    const items = [
      ...sheet.querySelectorAll<HTMLElement>('aside[role="navigation"] .group'),
    ]
    items.forEach((item, index) => {
      const parsedSlideNumber = Number.parseInt(
        item.querySelector("span")?.textContent?.trim() ?? "",
        10
      )
      const slideNumber = Number.isFinite(parsedSlideNumber)
        ? parsedSlideNumber
        : index + 1
      item.dataset.pptxCompactSlideItem = "true"
      item.dataset.pptxCompactSlideIndex = String(slideNumber - 1)
      const isCurrent = Boolean(
        item.querySelector('[class~="border-primary/60"]')
      )
      item.tabIndex = isCurrent ? 0 : -1
      item.setAttribute("role", "button")
      item.setAttribute(
        "aria-label",
        t("presentation.goToSlide", { slide: slideNumber })
      )
      if (isCurrent) {
        item.setAttribute("aria-current", "page")
      } else {
        item.removeAttribute("aria-current")
      }
      item.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          item.click()
          return
        }
        const nextIndex =
          event.key === "ArrowDown"
            ? Math.min(index + 1, items.length - 1)
            : event.key === "ArrowUp"
              ? Math.max(index - 1, 0)
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : null
        if (nextIndex === null) return
        event.preventDefault()
        items[nextIndex]?.focus({ preventScroll: true })
      }
    })
  }, [compactSlidesPanelId, t])

  const syncCompactSlidesSheet = useCallback(() => {
    const root = rootRef.current
    if (!root || mobileSlidesSyncingRef.current) return
    const slidesButton = findMobileActions(
      root
    )?.querySelector<HTMLButtonElement>(":scope > button:first-of-type")
    if (!slidesButton) return
    const internalOpen = slidesButton.getAttribute("aria-pressed") === "true"
    if (internalOpen === compactSlidesOpenRef.current) return

    mobileSlidesSyncingRef.current = true
    slidesButton.click()
    queueMicrotask(() => {
      mobileSlidesSyncingRef.current = false
    })
  }, [])

  const ensureDesktopSlidesPane = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    if (findDesktopSlidesNavigation(root)) {
      desktopSlidesRestoringRef.current = false
      return
    }
    if (desktopSlidesRestoringRef.current) return

    const toggle = findSlidesPaneToggle(
      root,
      viewerI18n.t("pptx.toolbar.toggleSlidesPanel")
    )
    if (!toggle) return

    desktopSlidesRestoringRef.current = true
    toggle.click()
    queueMicrotask(() => {
      desktopSlidesRestoringRef.current = false
    })
  }, [viewerI18n])

  const refreshViewerDom = useCallback(() => {
    decorateElements()
    decorateMobileChrome()
    const root = rootRef.current
    if (!root) return
    const hasRenderedViewport = Boolean(
      root.querySelector("[data-pptx-viewport]")
    )
    if (hasRenderedViewport) scheduleViewerSurfaceReady()
    else resetViewerSurfaceReady()
    const compactLayout = Boolean(findMobileActions(root))
    root.dataset.pptxCompactLayout = String(compactLayout)
    updateSelectionGeometry()
    if (!compactLayout) {
      if (compactSlidesOpenRef.current) updateCompactSlidesOpen(false)
      ensureDesktopSlidesPane()
      return
    }
    desktopSlidesRestoringRef.current = false
    syncCompactSlidesSheet()
  }, [
    decorateElements,
    decorateMobileChrome,
    ensureDesktopSlidesPane,
    resetViewerSurfaceReady,
    scheduleViewerSurfaceReady,
    syncCompactSlidesSheet,
    updateCompactSlidesOpen,
    updateSelectionGeometry,
  ])

  const handleViewerActiveSlideChange = useCallback(
    (slideIndex: number) => {
      resetPanOffset()
      viewerRef.current?.clearSelection()
      emitSelection([])
      setActiveSlideIndex(slideIndex)
      onActiveSlideChange(slideIndex)
      window.requestAnimationFrame(refreshViewerDom)
    },
    [emitSelection, onActiveSlideChange, refreshViewerDom, resetPanOffset]
  )

  const handleViewerZoomChange = useCallback(
    (zoom: number) => {
      zoomRef.current = zoom
      onZoomChange(zoom)
      updateSelectionGeometry()
      schedulePanConstraint()
    },
    [onZoomChange, schedulePanConstraint, updateSelectionGeometry]
  )

  const handleViewerSlideCountChange = useCallback(
    (count: number) => {
      setSlideCount(count)
      if (count <= 0) resetViewerSurfaceReady()
      onSlideCountChange(count)
      window.requestAnimationFrame(refreshViewerDom)
    },
    [onSlideCountChange, refreshViewerDom, resetViewerSurfaceReady]
  )

  const handleViewerDirtyChange = useCallback(
    (dirty: boolean) => {
      if (!dirty) {
        dirtyRecoveryRef.current = false
        return
      }
      if (dirtyRecoveryRef.current) return
      dirtyRecoveryRef.current = true
      viewerRef.current?.clearSelection()
      emitSelection([])
      setSlideCount(0)
      resetViewerSurfaceReady()
      setViewerRevision((current) => current + 1)
    },
    [emitSelection, resetViewerSurfaceReady]
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new MutationObserver(() => refreshViewerDom())
    observer.observe(root, { childList: true, subtree: true })
    const handleGeometryChange = () => {
      updateSelectionGeometry()
      schedulePanConstraint()
    }
    root.addEventListener("scroll", handleGeometryChange, true)
    window.addEventListener("resize", handleGeometryChange)
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            handleGeometryChange()
            refreshViewerDom()
          })
    resizeObserver?.observe(root)
    refreshViewerDom()
    return () => {
      observer.disconnect()
      resizeObserver?.disconnect()
      root.removeEventListener("scroll", handleGeometryChange, true)
      window.removeEventListener("resize", handleGeometryChange)
    }
  }, [refreshViewerDom, schedulePanConstraint, updateSelectionGeometry])

  useEffect(() => {
    syncCompactSlidesSheet()
  }, [compactSlidesOpen, syncCompactSlidesSheet])

  useEffect(() => {
    if (selectionEnabled) return
    selectedIdsRef.current = []
    viewerRef.current?.clearSelection()
    onSelectionChange(null)
    onSelectionAnchorChange(null)
    updateSelectionGeometry()
  }, [
    onSelectionAnchorChange,
    onSelectionChange,
    selectionEnabled,
    updateSelectionGeometry,
  ])

  useEffect(() => {
    if (!compactSlidesOpen) return
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (closestCompactSlidesSurface(event.target)) return
      updateCompactSlidesOpen(false)
    }
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      updateCompactSlidesOpen(false)
      restoreCompactSlidesTriggerFocus()
    }
    document.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [
    compactSlidesOpen,
    restoreCompactSlidesTriggerFocus,
    updateCompactSlidesOpen,
  ])

  useEffect(
    () => () => {
      if (anchorFrameRef.current !== null) {
        window.cancelAnimationFrame(anchorFrameRef.current)
      }
      cancelWheelAnchor()
      if (panConstraintFrameRef.current !== null) {
        window.cancelAnimationFrame(panConstraintFrameRef.current)
      }
      if (compactSlidesCloseTimerRef.current !== null) {
        window.clearTimeout(compactSlidesCloseTimerRef.current)
      }
      if (viewerLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(viewerLayoutFrameRef.current)
      }
    },
    [cancelWheelAnchor]
  )

  useImperativeHandle(
    ref,
    () => ({
      goToSlide: (slideIndex: number) => {
        cancelWheelAnchor()
        viewerRef.current?.goTo(slideIndex)
      },
      zoomIn: () => {
        cancelWheelAnchor()
        viewerRef.current?.zoomIn()
      },
      zoomOut: () => {
        cancelWheelAnchor()
        viewerRef.current?.zoomOut()
      },
      zoomReset: () => {
        resetPanOffset()
        viewerRef.current?.zoomReset()
      },
    }),
    [cancelWheelAnchor, resetPanOffset]
  )

  return (
    <div
      {...canvasDragHandlers}
      ref={rootRef}
      className="pptx-viewer-adapter"
      data-testid="pptx-viewer-adapter"
      data-pptx-ready={viewerReady ? "true" : "false"}
      aria-busy={!viewerReady}
      onPointerDownCapture={handleGesturePointerDownCapture}
      onPointerOverCapture={handlePointerOverCapture}
      onPointerOutCapture={handlePointerOutCapture}
      onMouseDownCapture={blockElementAction}
      onMouseOverCapture={blockElementAction}
      onDragStartCapture={blockElementAction}
      onDropCapture={blockElementAction}
      onTouchStartCapture={handleTouchCapture}
      onTouchMoveCapture={handleTouchCapture}
      onTouchEndCapture={handleTouchCapture}
      onClickCapture={handleGestureClickCapture}
      onDoubleClickCapture={blockElementAction}
      onContextMenuCapture={blockElementAction}
      onKeyDownCapture={handleKeyDownCapture}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
    >
      {!viewerReady && (
        <OfficePreviewLoadingState
          className="presentation-preview-loading-state"
          label={t("officePreview.loading")}
        />
      )}
      {slideCount > 0 && (
        <Button
          ref={compactSlidesTriggerRef}
          type="button"
          variant="ghost"
          size="icon"
          className="presentation-preview-compact-slides-trigger"
          data-pptx-compact-slides-trigger="true"
          aria-label={t("presentation.toggleSlideNavigator")}
          aria-controls={compactSlidesPanelId}
          aria-expanded={compactSlidesOpen}
          onPointerEnter={(event) => {
            if (event.pointerType === "touch") return
            cancelCompactSlidesClose()
            updateCompactSlidesOpen(true)
          }}
          onPointerDown={(event) => {
            lastTriggerPointerTypeRef.current = event.pointerType
            if (event.pointerType !== "mouse") {
              updateCompactSlidesOpen(!compactSlidesOpenRef.current)
            }
          }}
          onClick={() => {
            const pointerType = lastTriggerPointerTypeRef.current
            lastTriggerPointerTypeRef.current = null
            if (pointerType === "mouse") {
              updateCompactSlidesOpen(true)
            } else if (pointerType === null) {
              updateCompactSlidesOpen(!compactSlidesOpenRef.current)
            }
          }}
          onFocus={() => {
            if (!restoringCompactSlidesFocusRef.current) {
              updateCompactSlidesOpen(true)
            }
          }}
        >
          <span
            className="presentation-preview-compact-slide-rail"
            data-pptx-compact-slide-rail="true"
            aria-hidden="true"
          >
            {Array.from({ length: slideCount }, (_, index) => (
              <span
                key={index}
                className="presentation-preview-compact-slide-line"
                data-pptx-compact-slide-line="true"
                data-active={index === activeSlideIndex ? "true" : "false"}
              />
            ))}
          </span>
        </Button>
      )}
      <div
        className="presentation-preview-pptx-surface"
        aria-hidden={viewerReady ? undefined : true}
      >
        <I18nextProvider i18n={viewerI18n}>
          <PowerPointViewer
            key={viewerRevision}
            ref={viewerRef}
            content={content}
            fileName={fileName}
            canEdit={false}
            loadingState={null}
            onOpenFile={() => undefined}
            onSelectionChange={emitSelection}
            onActiveSlideChange={handleViewerActiveSlideChange}
            onZoomChange={handleViewerZoomChange}
            onSlideCountChange={handleViewerSlideCountChange}
            onDirtyChange={handleViewerDirtyChange}
            theme={{
              colors: {
                background: "var(--presentation-viewer-canvas)",
                foreground: "var(--app-text)",
                card: "var(--app-canvas)",
                cardForeground: "var(--app-text)",
                popover: "var(--app-popover)",
                popoverForeground: "var(--app-text)",
                primary: "var(--app-selection)",
                primaryForeground: "#ffffff",
                secondary: "var(--presentation-viewer-sidebar)",
                secondaryForeground: "var(--app-text)",
                muted: "var(--app-control-surface)",
                mutedForeground: "var(--app-muted)",
                accent: "var(--app-hover)",
                accentForeground: "var(--app-text)",
                destructive: "var(--destructive)",
                destructiveForeground: "var(--destructive-foreground)",
                border: "var(--app-border)",
                input: "var(--input)",
                ring: "var(--app-selection)",
              },
              radius: "8px",
            }}
          />
        </I18nextProvider>
      </div>
      <div
        className="presentation-selection-overlay"
        data-pptx-selection-overlay="true"
        aria-hidden="true"
      >
        {selectionFrames.map((frame) => (
          <span
            key={frame.key}
            className={
              frame.kind === "annotation"
                ? "presentation-selection-frame presentation-annotation-frame"
                : "presentation-selection-frame"
            }
            data-pptx-selection-frame={
              frame.kind === "selection" ? frame.elementId : undefined
            }
            data-pptx-annotation-frame={
              frame.kind === "annotation" ? frame.annotationId : undefined
            }
            style={selectionFrameStyle(frame)}
          >
            {frame.kind === "annotation" && frame.annotationIndex ? (
              <OfficeAnnotationNumberBubble
                index={frame.annotationIndex}
                className="presentation-annotation-index"
              />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  )
})
