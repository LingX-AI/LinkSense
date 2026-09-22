import { autoUpdate } from "@floating-ui/react-dom"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  clickToPositionDom,
  getSelectionRectsFromDom,
  type DomSelectionRect,
} from "@eigenpal/docx-editor-core/layout-bridge/clickToPositionDom"
import {
  extractSelectionState,
  TextSelection,
} from "@eigenpal/docx-editor-core/prosemirror"
import {
  DocxEditor,
  type DocxEditorProps,
  type DocxEditorRef,
} from "@eigenpal/docx-editor-react"
import { wordPreviewLocale } from "@/components/media/word-preview/word-preview-i18n"
import {
  animate,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "framer-motion"
import { useTranslation } from "react-i18next"

import "@eigenpal/docx-editor-react/styles.css"

import { OfficeAnnotationNumberBubble } from "@/components/media/office-preview/office-annotation-number-bubble"
import { OfficeAnnotationHover } from "@/components/media/office-preview/office-annotation-hover"
import { officeDocumentSessionKey } from "@/components/media/office-preview/office-document-session"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"
import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import type {
  OfficeAnnotationNavigationRequest,
  OfficePreviewUpdateAction,
  OfficeSelectionAnchor,
} from "@/components/media/office-preview/office-preview.types"
import {
  DOCX_MIME_TYPE,
  type WordAnnotationMarker,
  type WordDocumentState,
  type WordSelection,
  type WordSelectionAction,
} from "@/components/media/word-preview/word-preview.types"
import {
  calculateWordPreviewFitZoom,
  clampWordPreviewZoom,
  maximumWordPreviewZoom,
  minimumWordPreviewZoom,
} from "@/components/media/word-preview/word-preview-zoom"
import { normalizeLanguage } from "@/i18n"

const selectionTextLimit = 4_000
const paragraphTextLimit = 8_000
const selectionContextLimit = 1_000
const maximumDocumentPosition = 1_000_000
const emptyWordAnnotationMarkers: readonly WordAnnotationMarker[] = []

type WordEditorView = Parameters<
  NonNullable<DocxEditorProps["onEditorViewReady"]>
>[0]

type WordEditorSelectionState = Parameters<
  NonNullable<DocxEditorProps["onSelectionChange"]>
>[0]

type WordSelectionLocation = Readonly<{
  hasSelection: boolean
  isMultiParagraph: boolean
  startParagraphIndex: number
  endParagraphIndex: number
}>

type WordSelectionRange = Readonly<{
  from: number
  to: number
}>

export type WordPreviewProps = Readonly<{
  document: WordDocumentState
  fileName: string
  selectionAction?: WordSelectionAction
  annotationControls?: ReactNode
  annotationSessionKey?: number
  annotationMarkers?: readonly WordAnnotationMarker[]
  annotationNavigation?: OfficeAnnotationNavigationRequest | null
  floatingContent?: ReactNode
  onRetry?: () => void
  onDownload?: () => void
  updateAction?: OfficePreviewUpdateAction
  onClose?: () => void
  className?: string
}>

function selectionKey(selection: WordSelection) {
  return [
    selection.paraId ?? "",
    selection.startParagraphIndex,
    selection.endParagraphIndex,
    selection.positionFrom ?? "",
    selection.positionTo ?? "",
    selection.selectedText,
  ].join(":")
}

function normalizeWordSelectionState(
  state: WordEditorSelectionState
): WordSelectionLocation | null {
  if (!state) return null
  return {
    hasSelection: state.hasSelection,
    isMultiParagraph: state.isMultiParagraph,
    startParagraphIndex: state.startParagraphIndex,
    endParagraphIndex: state.endParagraphIndex,
  }
}

function getWordParagraphSelectionRange(
  view: WordEditorView,
  position: number
): WordSelectionRange | null {
  try {
    const resolvedPosition = view.state.doc.resolve(position)
    if (!resolvedPosition.parent.isTextblock) return null

    const from = resolvedPosition.start(resolvedPosition.depth)
    const to = resolvedPosition.end(resolvedPosition.depth)
    return Number.isInteger(from) && Number.isInteger(to) && from < to
      ? { from, to }
      : null
  } catch {
    return null
  }
}

function hasNativeSelectionInPages(pages: HTMLElement) {
  const nativeSelection = window.getSelection()
  return Boolean(
    nativeSelection &&
    nativeSelection.rangeCount > 0 &&
    !nativeSelection.isCollapsed &&
    nativeSelection.anchorNode &&
    nativeSelection.focusNode &&
    pages.contains(nativeSelection.anchorNode) &&
    pages.contains(nativeSelection.focusNode)
  )
}

function selectionRectsEqual(
  current: readonly DomSelectionRect[],
  next: readonly DomSelectionRect[]
) {
  return (
    current.length === next.length &&
    current.every((rect, index) => {
      const nextRect = next[index]
      return (
        nextRect !== undefined &&
        rect.x === nextRect.x &&
        rect.y === nextRect.y &&
        rect.width === nextRect.width &&
        rect.height === nextRect.height &&
        rect.pageIndex === nextRect.pageIndex
      )
    })
  )
}

function getWordSelectionFrames(
  rects: readonly DomSelectionRect[]
): readonly DomSelectionRect[] {
  const framesByPage = new Map<number, DomSelectionRect>()
  for (const rect of rects) {
    const current = framesByPage.get(rect.pageIndex)
    if (!current) {
      framesByPage.set(rect.pageIndex, rect)
      continue
    }

    const x = Math.min(current.x, rect.x)
    const y = Math.min(current.y, rect.y)
    const right = Math.max(current.x + current.width, rect.x + rect.width)
    const bottom = Math.max(current.y + current.height, rect.y + rect.height)
    framesByPage.set(rect.pageIndex, {
      x,
      y,
      width: right - x,
      height: bottom - y,
      pageIndex: rect.pageIndex,
    })
  }

  return Array.from(framesByPage.values()).sort(
    (current, next) => current.pageIndex - next.pageIndex
  )
}

type WordAnnotationMarkerFrame = Readonly<{
  id: string
  index: number
  rects: readonly DomSelectionRect[]
}>

function wordAnnotationMarkerFramesEqual(
  current: readonly WordAnnotationMarkerFrame[],
  next: readonly WordAnnotationMarkerFrame[]
) {
  return (
    current.length === next.length &&
    current.every((frame, index) => {
      const nextFrame = next[index]
      return (
        nextFrame !== undefined &&
        frame.id === nextFrame.id &&
        frame.index === nextFrame.index &&
        selectionRectsEqual(frame.rects, nextFrame.rects)
      )
    })
  )
}

function getWordAnnotationScrollTarget(
  surface: HTMLElement,
  frame: WordAnnotationMarkerFrame
) {
  const viewport = surface.querySelector<HTMLElement>(
    ".docx-editor__scroll-container"
  )
  if (!viewport || frame.rects.length === 0) return null

  const firstTop = Math.min(...frame.rects.map((rect) => rect.y))
  const lastBottom = Math.max(
    ...frame.rects.map((rect) => rect.y + rect.height)
  )
  const surfaceBounds = surface.getBoundingClientRect()
  const viewportBounds = viewport.getBoundingClientRect()
  const viewportHeight = viewport.clientHeight || viewportBounds.height
  const targetCenter = surfaceBounds.top + (firstTop + lastBottom) / 2
  const viewportCenter = viewportBounds.top + viewportHeight / 2
  const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewportHeight)
  const nextScrollTop = Math.min(
    maximumScrollTop,
    Math.max(0, viewport.scrollTop + targetCenter - viewportCenter)
  )

  return { viewport, scrollTop: nextScrollTop }
}

export function WordPreview(props: WordPreviewProps) {
  return (
    <WordPreviewSession
      key={officeDocumentSessionKey(props.fileName, props.document)}
      {...props}
    />
  )
}

function WordPreviewSession({
  document,
  fileName,
  selectionAction,
  annotationControls,
  annotationSessionKey = 0,
  annotationMarkers = emptyWordAnnotationMarkers,
  annotationNavigation,
  floatingContent,
  onRetry,
  onDownload,
  updateAction,
  onClose,
  className,
}: WordPreviewProps) {
  const { t, i18n } = useTranslation()
  const paneRef = useRef<HTMLElement>(null)
  const editorSurfaceRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<DocxEditorRef>(null)
  const editorViewRef = useRef<WordEditorView | null>(null)
  const annotationScrollAnimationRef = useRef<AnimationPlaybackControls | null>(
    null
  )
  const latestSelectionStateRef = useRef<WordSelectionLocation | null>(null)
  const pointerSelectionActiveRef = useRef(false)
  const pointerSelectionTimerRef = useRef<number | null>(null)
  const pointerSelectionPagesRef = useRef<HTMLElement | null>(null)
  const pointerSelectionAnchorPositionRef = useRef<number | null>(null)
  const pointerSelectionHeadPositionRef = useRef<number | null>(null)
  const selectionOverlayFrameRef = useRef<number | null>(null)
  const handledAnnotationNavigationSequenceRef = useRef<number | null>(null)
  const selectionOverlaySuspendedRef = useRef(false)
  const fitWidthFrameRef = useRef<number | null>(null)
  const horizontalCenterFrameRef = useRef<number | null>(null)
  const layoutReadyFrameRef = useRef<number | null>(null)
  const layoutReadyRef = useRef(false)
  const manualZoomRef = useRef(false)
  const zoomRef = useRef(1)
  const [zoom, setZoom] = useState(1)
  const [fitWidthEnabled, setFitWidthEnabled] = useState(true)
  const [layoutReady, setLayoutReady] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [selection, setSelection] = useState<WordSelection | null>(null)
  const [selectionSessionKey, setSelectionSessionKey] = useState<number | null>(
    null
  )
  const [selectionAnchor, setSelectionAnchor] =
    useState<OfficeSelectionAnchor | null>(null)
  const [selectionRects, setSelectionRects] = useState<
    readonly DomSelectionRect[]
  >([])
  const annotationOverlayRef = useRef<HTMLDivElement>(null)
  const [annotationFrames, setAnnotationFrames] = useState<
    readonly WordAnnotationMarkerFrame[]
  >([])
  const [viewerFailed, setViewerFailed] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  const selectionEnabled = Boolean(selectionAction)
  const activeSelection =
    selectionEnabled && selectionSessionKey === annotationSessionKey
      ? selection
      : null

  const updatePageInfo = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    setCurrentPage(Math.max(1, editor.getCurrentPage()))
    setPageCount(Math.max(0, editor.getTotalPages()))
  }, [])

  const centerDocumentHorizontally = useCallback(() => {
    const surface = editorSurfaceRef.current
    const viewport = surface?.querySelector<HTMLElement>(
      ".docx-editor__scroll-container"
    )
    const page = surface?.querySelector<HTMLElement>(".layout-page")
    if (!viewport || !page) return

    const viewportRect = viewport.getBoundingClientRect()
    const pageRect = page.getBoundingClientRect()
    if (viewportRect.width <= 0 || pageRect.width <= 0) return

    const viewportCenter = viewportRect.left + viewportRect.width / 2
    const pageCenter = pageRect.left + pageRect.width / 2
    const maximumScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth
    )
    viewport.scrollLeft = Math.min(
      maximumScrollLeft,
      Math.max(0, viewport.scrollLeft + pageCenter - viewportCenter)
    )
  }, [])

  const scheduleHorizontalCenter = useCallback(() => {
    if (horizontalCenterFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(horizontalCenterFrameRef.current)
    }
    horizontalCenterFrameRef.current = globalThis.requestAnimationFrame(() => {
      horizontalCenterFrameRef.current = null
      centerDocumentHorizontally()
    })
  }, [centerDocumentHorizontally])

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const normalizedZoom = clampWordPreviewZoom(nextZoom)
      zoomRef.current = normalizedZoom
      editorRef.current?.setZoom(normalizedZoom)
      setZoom(normalizedZoom)
      scheduleHorizontalCenter()
    },
    [scheduleHorizontalCenter]
  )

  const scheduleLayoutReady = useCallback(() => {
    if (layoutReadyRef.current) return
    if (layoutReadyFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(layoutReadyFrameRef.current)
    }
    layoutReadyFrameRef.current = globalThis.requestAnimationFrame(() => {
      layoutReadyFrameRef.current = globalThis.requestAnimationFrame(() => {
        layoutReadyFrameRef.current = null
        layoutReadyRef.current = true
        setLayoutReady(true)
      })
    })
  }, [])

  const updateZoom = useCallback(
    (nextZoom: number) => {
      manualZoomRef.current = true
      setFitWidthEnabled(false)
      applyZoom(nextZoom)
      scheduleLayoutReady()
    },
    [applyZoom, scheduleLayoutReady]
  )

  const fitDocumentToWidth = useCallback(() => {
    if (manualZoomRef.current) return false

    const surface = editorSurfaceRef.current
    const editor = editorRef.current
    if (!surface || !editor) return false

    const viewport =
      surface.querySelector<HTMLElement>(".docx-editor__scroll-container") ??
      surface
    const availableWidth =
      viewport.clientWidth || viewport.getBoundingClientRect().width
    const pageWidths = Array.from(
      surface.querySelectorAll<HTMLElement>(".layout-page")
    ).map((page) => {
      if (page.offsetWidth > 0) return page.offsetWidth
      return page.getBoundingClientRect().width / zoomRef.current
    })
    const pageWidth = Math.max(0, ...pageWidths)
    const fitZoom = calculateWordPreviewFitZoom(availableWidth, pageWidth)
    if (fitZoom === null) return false

    applyZoom(fitZoom)
    scheduleLayoutReady()
    return true
  }, [applyZoom, scheduleLayoutReady])

  const scheduleFitDocumentToWidth = useCallback(() => {
    if (manualZoomRef.current || fitWidthFrameRef.current !== null) return
    fitWidthFrameRef.current = globalThis.requestAnimationFrame(() => {
      fitWidthFrameRef.current = null
      fitDocumentToWidth()
    })
  }, [fitDocumentToWidth])

  const resetZoom = useCallback(() => {
    manualZoomRef.current = false
    setFitWidthEnabled(true)
    if (!fitDocumentToWidth()) scheduleFitDocumentToWidth()
  }, [fitDocumentToWidth, scheduleFitDocumentToWidth])

  useEffect(() => {
    return () => annotationScrollAnimationRef.current?.stop()
  }, [])

  useEffect(() => {
    if (document.status !== "ready" || viewerFailed) return
    const surface = editorSurfaceRef.current
    if (!surface) return

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleFitDocumentToWidth)
    resizeObserver?.observe(surface)

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleFitDocumentToWidth)
    mutationObserver?.observe(surface, { childList: true, subtree: true })
    scheduleFitDocumentToWidth()

    return () => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      if (fitWidthFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(fitWidthFrameRef.current)
        fitWidthFrameRef.current = null
      }
      if (horizontalCenterFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(horizontalCenterFrameRef.current)
        horizontalCenterFrameRef.current = null
      }
      if (layoutReadyFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(layoutReadyFrameRef.current)
        layoutReadyFrameRef.current = null
      }
    }
  }, [document.status, scheduleFitDocumentToWidth, viewerFailed])

  const applySelectionState = useCallback(
    (state: WordSelectionLocation | null) => {
      if (!state?.hasSelection) {
        setSelection(null)
        setSelectionSessionKey(null)
        setSelectionAnchor(null)
        setSelectionRects([])
        return
      }

      const selectionInfo = editorRef.current?.getSelectionInfo()
      if (!selectionInfo?.selectedText.trim()) {
        setSelection(null)
        setSelectionSessionKey(null)
        setSelectionAnchor(null)
        setSelectionRects([])
        return
      }

      const pageNumber = editorRef.current?.getCurrentPage()
      const editorSelection = editorViewRef.current?.state.selection
      const hasBoundedPositions =
        editorSelection !== undefined &&
        Number.isInteger(editorSelection.from) &&
        Number.isInteger(editorSelection.to) &&
        editorSelection.from >= 0 &&
        editorSelection.to >= editorSelection.from &&
        editorSelection.to <= maximumDocumentPosition

      setSelection({
        type: "text",
        ...(selectionInfo.paraId ? { paraId: selectionInfo.paraId } : {}),
        selectedText: selectionInfo.selectedText.slice(0, selectionTextLimit),
        paragraphText: selectionInfo.paragraphText.slice(0, paragraphTextLimit),
        before: selectionInfo.before.slice(-selectionContextLimit),
        after: selectionInfo.after.slice(0, selectionContextLimit),
        startParagraphIndex: state.startParagraphIndex,
        endParagraphIndex: state.endParagraphIndex,
        isMultiParagraph: state.isMultiParagraph,
        ...(pageNumber && pageNumber > 0 ? { pageNumber } : {}),
        ...(hasBoundedPositions
          ? {
              positionFrom: editorSelection.from,
              positionTo: editorSelection.to,
            }
          : {}),
      })
      setSelectionSessionKey(annotationSessionKey)
      updatePageInfo()
    },
    [annotationSessionKey, updatePageInfo]
  )

  const handleSelectionChange: NonNullable<
    DocxEditorProps["onSelectionChange"]
  > = useCallback(
    (state) => {
      if (!selectionEnabled) {
        latestSelectionStateRef.current = null
        return
      }
      const normalizedState = normalizeWordSelectionState(state)
      latestSelectionStateRef.current = normalizedState
      if (
        pointerSelectionActiveRef.current ||
        pointerSelectionTimerRef.current !== null
      ) {
        return
      }
      applySelectionState(normalizedState)
    },
    [applySelectionState, selectionEnabled]
  )

  const clearPendingPointerSelection = useCallback(() => {
    if (pointerSelectionTimerRef.current === null) return
    window.clearTimeout(pointerSelectionTimerRef.current)
    pointerSelectionTimerRef.current = null
  }, [])

  const clearPointerSelectionPositions = useCallback(() => {
    pointerSelectionPagesRef.current = null
    pointerSelectionAnchorPositionRef.current = null
    pointerSelectionHeadPositionRef.current = null
  }, [])

  const updatePointerSelectionPosition = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      if (!pointerSelectionActiveRef.current) return
      const pages = pointerSelectionPagesRef.current
      if (
        !pages ||
        !(target instanceof Element) ||
        !target.closest(".layout-page-content") ||
        !pages.contains(target)
      ) {
        return
      }
      const position = clickToPositionDom(pages, clientX, clientY, zoom)
      if (position !== null) {
        pointerSelectionHeadPositionRef.current = position
      }
    },
    [zoom]
  )

  const startPointerSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!selectionEnabled) return
      if (event.button !== 0) return
      clearPendingPointerSelection()
      clearPointerSelectionPositions()
      latestSelectionStateRef.current = null
      setSelection(null)
      setSelectionSessionKey(null)
      setSelectionAnchor(null)
      setSelectionRects([])

      const pages = editorSurfaceRef.current?.querySelector<HTMLElement>(
        ".paged-editor__pages"
      )
      if (
        !pages ||
        !(event.target instanceof Element) ||
        !event.target.closest(".layout-page-content") ||
        !pages.contains(event.target)
      ) {
        pointerSelectionActiveRef.current = false
        return
      }
      const position = clickToPositionDom(
        pages,
        event.clientX,
        event.clientY,
        zoom
      )
      if (position === null) {
        pointerSelectionActiveRef.current = false
        return
      }

      pointerSelectionPagesRef.current = pages
      pointerSelectionAnchorPositionRef.current = position
      pointerSelectionHeadPositionRef.current = position
      pointerSelectionActiveRef.current = true
    },
    [
      clearPendingPointerSelection,
      clearPointerSelectionPositions,
      selectionEnabled,
      zoom,
    ]
  )

  const completePointerSelection = useCallback(
    (
      clientX: number,
      clientY: number,
      button: number,
      target: EventTarget | null
    ) => {
      if (!selectionEnabled) return
      if (button !== 0 || !pointerSelectionActiveRef.current) return

      updatePointerSelectionPosition(clientX, clientY, target)
      pointerSelectionActiveRef.current = false
      const pages = pointerSelectionPagesRef.current
      const anchorPosition = pointerSelectionAnchorPositionRef.current
      const headPosition = pointerSelectionHeadPositionRef.current
      clearPointerSelectionPositions()
      if (!pages || anchorPosition === null || headPosition === null) {
        latestSelectionStateRef.current = null
        setSelection(null)
        setSelectionSessionKey(null)
        setSelectionAnchor(null)
        setSelectionRects([])
        return
      }
      clearPendingPointerSelection()
      pointerSelectionTimerRef.current = window.setTimeout(() => {
        const finishSelection = (state: WordSelectionLocation | null) => {
          applySelectionState(state)
          pointerSelectionTimerRef.current = null
        }
        const view = editorViewRef.current
        if (!view) {
          finishSelection(null)
          return
        }

        const pointerRange =
          anchorPosition !== headPosition
            ? { from: anchorPosition, to: headPosition }
            : getWordParagraphSelectionRange(view, anchorPosition)
        const hasNativeSelection = hasNativeSelectionInPages(pages)
        if (!pointerRange && !hasNativeSelection) {
          finishSelection(null)
          return
        }

        if (pointerRange) {
          try {
            const textSelection = TextSelection.between(
              view.state.doc.resolve(pointerRange.from),
              view.state.doc.resolve(pointerRange.to)
            )
            view.dispatch(view.state.tr.setSelection(textSelection))
          } catch {
            finishSelection(null)
            return
          }
        }

        finishSelection(
          normalizeWordSelectionState(extractSelectionState(view.state)) ??
            latestSelectionStateRef.current
        )
      }, 0)
    },
    [
      applySelectionState,
      clearPendingPointerSelection,
      clearPointerSelectionPositions,
      selectionEnabled,
      updatePointerSelectionPosition,
    ]
  )

  const finishPointerSelection = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      completePointerSelection(
        event.clientX,
        event.clientY,
        event.button,
        event.target
      )
    },
    [completePointerSelection]
  )

  const cancelPointerSelection = useCallback(() => {
    if (
      !pointerSelectionActiveRef.current &&
      pointerSelectionTimerRef.current === null
    ) {
      return
    }
    pointerSelectionActiveRef.current = false
    latestSelectionStateRef.current = null
    clearPendingPointerSelection()
    clearPointerSelectionPositions()
    setSelection(null)
    setSelectionSessionKey(null)
    setSelectionAnchor(null)
    setSelectionRects([])
  }, [clearPendingPointerSelection, clearPointerSelectionPositions])

  const clearSelectionOverlay = useCallback(() => {
    setSelectionRects((current) => (current.length === 0 ? current : []))
    setSelectionAnchor(null)
  }, [])

  const clearAnnotationFrames = useCallback(() => {
    setAnnotationFrames((current) => (current.length === 0 ? current : []))
  }, [])

  const refreshAnnotationFrames = useCallback(() => {
    const surface = editorSurfaceRef.current
    const pages = surface?.querySelector<HTMLElement>(".paged-editor__pages")
    if (
      !surface ||
      !pages ||
      annotationMarkers.length === 0 ||
      selectionOverlaySuspendedRef.current
    ) {
      clearAnnotationFrames()
      return
    }

    const surfaceBounds = annotationOverlayRef.current?.getBoundingClientRect()
    if (!surfaceBounds) return
    const nextFrames = annotationMarkers.flatMap((marker) => {
      const { positionFrom, positionTo } = marker.selection
      if (
        positionFrom === undefined ||
        positionTo === undefined ||
        positionFrom === positionTo
      ) {
        return []
      }

      try {
        const rects = getSelectionRectsFromDom(
          pages,
          positionFrom,
          positionTo,
          surfaceBounds
        ).filter(
          (rect) =>
            Number.isFinite(rect.x) &&
            Number.isFinite(rect.y) &&
            Number.isFinite(rect.width) &&
            Number.isFinite(rect.height) &&
            rect.width > 0 &&
            rect.height > 0
        )
        const frames = getWordSelectionFrames(rects)
        return frames.length > 0
          ? [
              {
                id: marker.id,
                index: marker.index,
                rects: frames,
              },
            ]
          : []
      } catch {
        return []
      }
    })
    setAnnotationFrames((current) =>
      wordAnnotationMarkerFramesEqual(current, nextFrames)
        ? current
        : nextFrames
    )
  }, [annotationMarkers, clearAnnotationFrames])

  const refreshSelectionOverlay = useCallback(() => {
    if (!selectionEnabled) {
      clearSelectionOverlay()
      return
    }
    const surface = editorSurfaceRef.current
    const pages = surface?.querySelector<HTMLElement>(".paged-editor__pages")
    const positionFrom = activeSelection?.positionFrom
    const positionTo = activeSelection?.positionTo
    if (
      !surface ||
      !pages ||
      selectionOverlaySuspendedRef.current ||
      positionFrom === undefined ||
      positionTo === undefined ||
      positionFrom === positionTo
    ) {
      clearSelectionOverlay()
      return
    }

    try {
      const surfaceRect = surface.getBoundingClientRect()
      const nextRects = getSelectionRectsFromDom(
        pages,
        positionFrom,
        positionTo,
        surfaceRect
      ).filter(
        (rect) =>
          Number.isFinite(rect.x) &&
          Number.isFinite(rect.y) &&
          Number.isFinite(rect.width) &&
          Number.isFinite(rect.height) &&
          rect.width > 0 &&
          rect.height > 0
      )
      setSelectionRects((current) =>
        selectionRectsEqual(current, nextRects) ? current : nextRects
      )
      const nextAnchor = nextRects.length
        ? {
            left:
              surfaceRect.left +
              Math.max(...nextRects.map((rect) => rect.x + rect.width)),
            top:
              surfaceRect.top +
              Math.max(...nextRects.map((rect) => rect.y + rect.height)),
          }
        : null
      setSelectionAnchor((current) =>
        current?.left === nextAnchor?.left && current?.top === nextAnchor?.top
          ? current
          : nextAnchor
      )
    } catch {
      clearSelectionOverlay()
    }
  }, [
    clearSelectionOverlay,
    activeSelection?.positionFrom,
    activeSelection?.positionTo,
    selectionEnabled,
  ])

  const refreshPreviewOverlays = useCallback(() => {
    refreshSelectionOverlay()
    refreshAnnotationFrames()
  }, [refreshAnnotationFrames, refreshSelectionOverlay])

  const scheduleSelectionOverlayRefresh = useCallback(() => {
    if (selectionOverlayFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionOverlayFrameRef.current)
    }
    selectionOverlayFrameRef.current = window.requestAnimationFrame(() => {
      selectionOverlayFrameRef.current = null
      refreshPreviewOverlays()
    })
  }, [refreshPreviewOverlays])

  useEffect(() => {
    if (
      document.status !== "ready" ||
      viewerFailed ||
      (!activeSelection && annotationMarkers.length === 0)
    ) {
      return
    }
    const surface = editorSurfaceRef.current
    const pages = surface?.querySelector<HTMLElement>(".paged-editor__pages")
    if (!surface || !pages) return

    pages.addEventListener("painter:painted", scheduleSelectionOverlayRefresh)
    globalThis.document.addEventListener(
      "selectionchange",
      scheduleSelectionOverlayRefresh
    )
    const isEditorScaleTransition = (event: TransitionEvent) =>
      event.propertyName === "transform" &&
      event.target instanceof HTMLElement &&
      event.target.contains(pages)
    const handleScaleTransitionRun = (event: TransitionEvent) => {
      if (!isEditorScaleTransition(event)) return
      selectionOverlaySuspendedRef.current = true
      clearSelectionOverlay()
      clearAnnotationFrames()
    }
    const handleScaleTransitionComplete = (event: TransitionEvent) => {
      if (!isEditorScaleTransition(event)) return
      selectionOverlaySuspendedRef.current = false
      scheduleSelectionOverlayRefresh()
    }
    surface.addEventListener("transitionrun", handleScaleTransitionRun)
    surface.addEventListener("transitionend", handleScaleTransitionComplete)
    surface.addEventListener("transitioncancel", handleScaleTransitionComplete)

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSelectionOverlayRefresh)
    resizeObserver?.observe(surface)
    resizeObserver?.observe(pages)
    const mutationObserver = new MutationObserver(
      scheduleSelectionOverlayRefresh
    )
    mutationObserver.observe(pages, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    })
    const overlay = annotationOverlayRef.current
    const stopTracking = overlay
      ? autoUpdate(pages, overlay, scheduleSelectionOverlayRefresh, {
          animationFrame: true,
        })
      : undefined
    scheduleSelectionOverlayRefresh()

    return () => {
      pages.removeEventListener(
        "painter:painted",
        scheduleSelectionOverlayRefresh
      )
      globalThis.document.removeEventListener(
        "selectionchange",
        scheduleSelectionOverlayRefresh
      )
      surface.removeEventListener("transitionrun", handleScaleTransitionRun)
      surface.removeEventListener(
        "transitionend",
        handleScaleTransitionComplete
      )
      surface.removeEventListener(
        "transitioncancel",
        handleScaleTransitionComplete
      )
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      stopTracking?.()
      selectionOverlaySuspendedRef.current = false
      if (selectionOverlayFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionOverlayFrameRef.current)
        selectionOverlayFrameRef.current = null
      }
    }
  }, [
    clearSelectionOverlay,
    clearAnnotationFrames,
    document.status,
    scheduleSelectionOverlayRefresh,
    annotationMarkers.length,
    activeSelection,
    viewerFailed,
  ])

  useEffect(() => {
    if (activeSelection || annotationMarkers.length > 0) {
      scheduleSelectionOverlayRefresh()
    }
  }, [
    activeSelection,
    annotationMarkers.length,
    scheduleSelectionOverlayRefresh,
    zoom,
  ])

  useEffect(() => {
    if (
      !annotationNavigation ||
      handledAnnotationNavigationSequenceRef.current ===
        annotationNavigation.sequence
    ) {
      return
    }
    const marker = annotationMarkers.find(
      (candidate) => candidate.id === annotationNavigation.id
    )
    const frame = annotationFrames.find(
      (candidate) => candidate.id === annotationNavigation.id
    )
    const editor = editorRef.current
    const surface = editorSurfaceRef.current
    if (!marker || !frame || !editor || !surface) return

    const { paraId, pageNumber, positionFrom } = marker.selection
    const scrollTarget = getWordAnnotationScrollTarget(surface, frame)
    if (scrollTarget) {
      annotationScrollAnimationRef.current?.stop()
      if (
        prefersReducedMotion ||
        Math.abs(scrollTarget.viewport.scrollTop - scrollTarget.scrollTop) < 1
      ) {
        scrollTarget.viewport.scrollTop = scrollTarget.scrollTop
      } else {
        annotationScrollAnimationRef.current = animate(
          scrollTarget.viewport.scrollTop,
          scrollTarget.scrollTop,
          {
            duration: 0.26,
            ease: "easeOut",
            onUpdate: (scrollTop) => {
              scrollTarget.viewport.scrollTop = scrollTop
            },
          }
        )
      }
    } else {
      if (paraId && editor.scrollToParaId(paraId)) {
        // The editor already navigated to the exact paragraph.
      } else if (pageNumber !== undefined) {
        editor.scrollToPage(pageNumber)
      } else if (positionFrom !== undefined) {
        editor.scrollToPosition(positionFrom)
      } else {
        return
      }
    }

    handledAnnotationNavigationSequenceRef.current =
      annotationNavigation.sequence
    scheduleSelectionOverlayRefresh()
  }, [
    annotationFrames,
    annotationMarkers,
    annotationNavigation,
    prefersReducedMotion,
    scheduleSelectionOverlayRefresh,
  ])

  const handleEditorScroll = useCallback(() => {
    updatePageInfo()
    if (activeSelection || annotationMarkers.length > 0) {
      scheduleSelectionOverlayRefresh()
    }
  }, [
    activeSelection,
    annotationMarkers.length,
    scheduleSelectionOverlayRefresh,
    updatePageInfo,
  ])

  useEffect(() => {
    if (!selectionEnabled) return
    const handleWindowPointerMove = (event: PointerEvent) => {
      updatePointerSelectionPosition(event.clientX, event.clientY, event.target)
    }
    const handleWindowPointerUp = (event: PointerEvent) => {
      completePointerSelection(
        event.clientX,
        event.clientY,
        event.button,
        event.target
      )
    }
    window.addEventListener("pointermove", handleWindowPointerMove)
    window.addEventListener("pointerup", handleWindowPointerUp)
    window.addEventListener("pointercancel", cancelPointerSelection)
    window.addEventListener("blur", cancelPointerSelection)
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove)
      window.removeEventListener("pointerup", handleWindowPointerUp)
      window.removeEventListener("pointercancel", cancelPointerSelection)
      window.removeEventListener("blur", cancelPointerSelection)
      clearPendingPointerSelection()
    }
  }, [
    cancelPointerSelection,
    clearPendingPointerSelection,
    completePointerSelection,
    selectionEnabled,
    updatePointerSelectionPosition,
  ])

  const normalizedLanguage = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const shellDocument = viewerFailed ? ({ status: "error" } as const) : document
  const selectionFrames = getWordSelectionFrames(selectionRects)

  return (
    <OfficePreviewShell
      ref={paneRef}
      document={shellDocument}
      fileName={fileName}
      mimeType={DOCX_MIME_TYPE}
      className={className}
      bodyClassName="word-preview-body"
      onRetry={
        onRetry
          ? () => {
              setViewerFailed(false)
              onRetry()
            }
          : undefined
      }
      onDownload={onDownload}
      updateAction={updateAction}
      onClose={onClose}
      floatingContent={floatingContent}
      controls={
        <>
          {annotationControls}
          <OfficePreviewZoomControls
            zoomPercent={Math.round(zoom * 100)}
            zoomOutLabel={t("wordPreview.zoomOut")}
            zoomInLabel={t("wordPreview.zoomIn")}
            resetZoomLabel={t("wordPreview.resetZoom")}
            canZoomOut={zoom > minimumWordPreviewZoom}
            canZoomIn={zoom < maximumWordPreviewZoom}
            onZoomOut={() => updateZoom(zoom - 0.1)}
            onZoomIn={() => updateZoom(zoom + 0.1)}
            onResetZoom={resetZoom}
            trailing={
              pageCount > 0 ? (
                <span className="office-preview-location-count">
                  {t("wordPreview.pageCount", {
                    current: currentPage,
                    total: pageCount,
                  })}
                </span>
              ) : null
            }
          />
        </>
      }
    >
      {document.status === "ready" && !viewerFailed && (
        <div
          ref={editorSurfaceRef}
          className="word-preview-editor-surface"
          data-fit-width={fitWidthEnabled}
          data-layout-ready={layoutReady}
          aria-hidden={layoutReady ? undefined : true}
          onPointerDownCapture={
            selectionEnabled ? startPointerSelection : undefined
          }
          onPointerUpCapture={
            selectionEnabled ? finishPointerSelection : undefined
          }
          onPointerCancelCapture={
            selectionEnabled ? cancelPointerSelection : undefined
          }
          onScrollCapture={handleEditorScroll}
        >
          <DocxEditor
            key={fileName}
            ref={editorRef}
            className="word-preview-editor"
            documentBuffer={document.content}
            documentName={fileName}
            documentNameEditable={false}
            loadingIndicator={
              <OfficePreviewLoadingState label={t("officePreview.loading")} />
            }
            readOnly
            mode="viewing"
            showToolbar={false}
            showFileOpen={false}
            showHelpMenu={false}
            showZoomControl={false}
            showOutline={false}
            showOutlineButton={false}
            colorMode={
              globalThis.document.documentElement.classList.contains("dark")
                ? "dark"
                : "light"
            }
            i18n={wordPreviewLocale(normalizedLanguage)}
            onEditorViewReady={(view) => {
              editorViewRef.current = view
            }}
            onSelectionChange={
              selectionEnabled ? handleSelectionChange : undefined
            }
            onFontsLoaded={() => {
              globalThis.requestAnimationFrame(() => {
                fitDocumentToWidth()
                updatePageInfo()
                scheduleSelectionOverlayRefresh()
              })
            }}
            onError={() => setViewerFailed(true)}
          />
          <OfficeAnnotationHover
            scopeRef={editorSurfaceRef}
            scopeSelector=".docx-editor__scroll-container"
            enabled={selectionEnabled && layoutReady}
            resolve={(point, target) => {
              const paragraph = target.closest<HTMLElement>(
                ".layout-page-content .layout-paragraph"
              )
              const pages =
                editorSurfaceRef.current?.querySelector<HTMLElement>(
                  ".paged-editor__pages"
                )
              const view = editorViewRef.current
              if (
                !paragraph ||
                !pages ||
                !view ||
                pointerSelectionActiveRef.current
              )
                return []
              const position = clickToPositionDom(pages, point.x, point.y, zoom)
              const range =
                position === null
                  ? null
                  : getWordParagraphSelectionRange(view, position)
              if (!range) return []
              const selections = [
                activeSelection,
                ...annotationMarkers.map((marker) => marker.selection),
              ]
              if (
                selections.some(
                  (selected) =>
                    selected?.positionFrom !== undefined &&
                    selected.positionTo !== undefined &&
                    selected.positionFrom < range.to &&
                    selected.positionTo > range.from
                )
              )
                return []
              const origin = new DOMRect()
              return getWordSelectionFrames(
                getSelectionRectsFromDom(pages, range.from, range.to, origin)
              ).map((rect) => ({
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
              }))
            }}
          />
          {activeSelection && selectionFrames.length > 0 && (
            <svg
              className="word-preview-selection-overlay"
              data-testid="word-selection-overlay"
              aria-hidden="true"
              focusable="false"
            >
              {selectionFrames.map((frame) => (
                <rect
                  key={frame.pageIndex}
                  className="word-preview-selection-frame"
                  x={frame.x}
                  y={frame.y}
                  width={frame.width}
                  height={frame.height}
                  data-page-index={frame.pageIndex}
                />
              ))}
            </svg>
          )}
          {annotationMarkers.length > 0 && (
            <div
              ref={annotationOverlayRef}
              className="office-annotation-overlay word-preview-annotation-overlay"
              data-testid={
                annotationFrames.length ? "word-annotation-overlay" : undefined
              }
              aria-hidden="true"
            >
              {annotationFrames.flatMap((frame) =>
                frame.rects.map((rect) => (
                  <span
                    key={`${frame.id}:${rect.pageIndex}`}
                    className="office-annotation-frame word-preview-annotation-highlight"
                    data-word-annotation-frame={frame.id}
                    data-page-index={rect.pageIndex}
                    style={{
                      left: rect.x,
                      top: rect.y,
                      width: rect.width,
                      height: rect.height,
                    }}
                  >
                    <OfficeAnnotationNumberBubble
                      index={frame.index}
                      className="word-preview-annotation-index"
                      data-word-annotation-marker={frame.id}
                    />
                  </span>
                ))
              )}
            </div>
          )}
        </div>
      )}
      {document.status === "ready" && !viewerFailed && !layoutReady && (
        <OfficePreviewLoadingState
          className="word-preview-loading-state"
          label={t("officePreview.loading")}
        />
      )}
      {activeSelection && selectionAction && (
        <OfficeSelectionPrompt
          key={selectionKey(activeSelection)}
          scopeRef={paneRef}
          selection={activeSelection}
          anchor={selectionAnchor}
          action={selectionAction}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {activeSelection
          ? t("wordPreview.selectionStatus", {
              text: activeSelection.selectedText,
            })
          : ""}
      </span>
    </OfficePreviewShell>
  )
}

export default WordPreview
