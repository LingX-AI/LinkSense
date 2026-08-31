import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useDrag, usePinch } from "@use-gesture/react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ImageIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { downloadImagePreviewItem } from "@/components/media/image-preview-download"
import type { ImagePreviewItem } from "@/components/media/image-preview.types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MINIMUM_ZOOM = 50
const MAXIMUM_ZOOM = 300
const ZOOM_STEP = 25
const DEFAULT_ZOOM = 100
const PAN_EDGE_ALLOWANCE_RATIO = 0.16

type ImagePreviewPan = Readonly<{ x: number; y: number }>

export type { ImagePreviewItem } from "@/components/media/image-preview.types"

export function ImageThumbnail({
  item,
  onPreview,
  onRemove,
  removeDisabled,
  className,
}: {
  item: ImagePreviewItem
  onPreview: (id: string) => void
  onRemove?: (id: string) => void
  removeDisabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const loadFailed = failedSource === item.src

  return (
    <div className={cn("image-preview-thumbnail", className)}>
      <Button
        type="button"
        variant="ghost"
        className="image-preview-thumbnail-trigger"
        aria-label={t("conversation.previewImage", { name: item.name })}
        onClick={() => onPreview(item.id)}
      >
        {loadFailed ? (
          <ImageIcon aria-hidden="true" />
        ) : (
          <img
            src={item.src}
            alt=""
            width="68"
            height="68"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedSource(item.src)}
          />
        )}
      </Button>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="image-preview-thumbnail-remove"
          aria-label={t("conversation.removeAttachment", { name: item.name })}
          disabled={removeDisabled}
          onClick={() => onRemove(item.id)}
        >
          <XIcon aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

export function ImagePreviewDialog({
  items,
  activeId,
  onActiveIdChange,
  onDownload,
  downloadingId,
}: {
  items: readonly ImagePreviewItem[]
  activeId: string | null
  onActiveIdChange: (id: string | null) => void
  onDownload?: (item: ImagePreviewItem) => void | Promise<void>
  downloadingId?: string
}) {
  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === activeId),
    [activeId, items]
  )
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined
  const open = Boolean(activeItem)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onActiveIdChange(null)
      }}
    >
      {activeItem && (
        <ImagePreviewDialogContent
          key={`${activeItem.id}:${activeItem.src}`}
          items={items}
          activeItem={activeItem}
          activeIndex={activeIndex}
          onActiveIdChange={onActiveIdChange}
          onDownload={onDownload}
          downloadingId={downloadingId}
        />
      )}
    </Dialog>
  )
}

export function ImagePreviewViewer({
  item,
  className,
  stageClassName,
  onLoadError,
}: Readonly<{
  item: ImagePreviewItem
  className?: string
  stageClassName?: string
  onLoadError?: () => void
}>) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const zoomRef = useRef(DEFAULT_ZOOM)
  const [pan, setPan] = useState<ImagePreviewPan>({ x: 0, y: 0 })
  const panRef = useRef<ImagePreviewPan>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null)
  const stageTarget = useMemo(() => ({ current: stageElement }), [stageElement])
  const [loadFailed, setLoadFailed] = useState(false)

  const getPanBounds = useCallback(() => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return { x: 0, y: 0 }

    const stageRect = stage.getBoundingClientRect()
    const imageWidth = image.clientWidth
    const imageHeight = image.clientHeight
    if (
      stageRect.width <= 0 ||
      stageRect.height <= 0 ||
      imageWidth <= 0 ||
      imageHeight <= 0
    ) {
      return { x: 0, y: 0 }
    }
    const scale = zoomRef.current / 100

    const scaledImageWidth = imageWidth * scale
    const scaledImageHeight = imageHeight * scale

    return {
      x:
        Math.abs(scaledImageWidth - stageRect.width) / 2 +
        Math.min(scaledImageWidth, stageRect.width) * PAN_EDGE_ALLOWANCE_RATIO,
      y:
        Math.abs(scaledImageHeight - stageRect.height) / 2 +
        Math.min(scaledImageHeight, stageRect.height) *
          PAN_EDGE_ALLOWANCE_RATIO,
    }
  }, [])

  const setClampedPan = useCallback(
    (nextPan: ImagePreviewPan) => {
      const bounds = getPanBounds()
      const clampedPan = {
        x: Math.min(bounds.x, Math.max(-bounds.x, nextPan.x)),
        y: Math.min(bounds.y, Math.max(-bounds.y, nextPan.y)),
      }

      if (
        panRef.current.x === clampedPan.x &&
        panRef.current.y === clampedPan.y
      ) {
        return
      }

      panRef.current = clampedPan
      imageRef.current?.style.setProperty(
        "--image-preview-translate-x",
        `${clampedPan.x}px`
      )
      imageRef.current?.style.setProperty(
        "--image-preview-translate-y",
        `${clampedPan.y}px`
      )
      setPan(clampedPan)
    },
    [getPanBounds]
  )

  const setClampedZoom = useCallback(
    (nextZoom: number) => {
      const clampedZoom = Math.min(
        MAXIMUM_ZOOM,
        Math.max(MINIMUM_ZOOM, nextZoom)
      )
      zoomRef.current = clampedZoom
      imageRef.current?.style.setProperty(
        "--image-preview-scale",
        String(clampedZoom / 100)
      )
      setClampedPan(panRef.current)
      setZoom(clampedZoom)
    },
    [setClampedPan]
  )

  const fitImageToStage = useCallback(() => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return

    const stageRect = stage.getBoundingClientRect()
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    if (
      stageRect.width <= 0 ||
      stageRect.height <= 0 ||
      naturalWidth <= 0 ||
      naturalHeight <= 0
    ) {
      return
    }

    const fitScale = Math.min(
      1,
      stageRect.width / naturalWidth,
      stageRect.height / naturalHeight
    )
    image.style.setProperty(
      "--image-preview-fit-width",
      `${Math.max(1, Math.floor(naturalWidth * fitScale))}px`
    )
    image.style.setProperty(
      "--image-preview-fit-height",
      `${Math.max(1, Math.floor(naturalHeight * fitScale))}px`
    )
    panRef.current = { x: 0, y: 0 }
    image.style.setProperty("--image-preview-translate-x", "0px")
    image.style.setProperty("--image-preview-translate-y", "0px")
  }, [])

  const scheduleImageFit = useCallback(() => {
    queueMicrotask(() => fitImageToStage())
  }, [fitImageToStage])

  const setStage = useCallback((element: HTMLDivElement | null) => {
    stageRef.current = element
    setStageElement((current) => (current === element ? current : element))
  }, [])

  useEffect(() => {
    if (stageElement && imageRef.current?.complete) scheduleImageFit()
  }, [item.src, scheduleImageFit, stageElement])

  usePinch(
    ({ offset: [nextScale], event }) => {
      if (event.cancelable) event.preventDefault()
      setClampedZoom(Math.round(nextScale * 100))
    },
    {
      target: stageTarget,
      eventOptions: { capture: true, passive: false },
      from: () => [zoomRef.current / 100, 0],
      scaleBounds: {
        min: MINIMUM_ZOOM / 100,
        max: MAXIMUM_ZOOM / 100,
      },
      rubberband: 0,
      pointer: { touch: true },
    }
  )

  const bindStageDrag = useDrag(
    ({ active, event, offset: [x, y], pinching }) => {
      const isMultiTouchGesture =
        typeof TouchEvent !== "undefined" &&
        event instanceof TouchEvent &&
        event.touches.length > 1

      if (pinching || isMultiTouchGesture) {
        if (!active) setDragging(false)
        return
      }

      if (event.cancelable) event.preventDefault()
      setDragging(active)
      setClampedPan({ x, y })
    },
    {
      from: () => [panRef.current.x, panRef.current.y],
      bounds: () => {
        const bounds = getPanBounds()
        return {
          left: -bounds.x,
          right: bounds.x,
          top: -bounds.y,
          bottom: bounds.y,
        }
      },
      rubberband: 0,
      threshold: 0,
      filterTaps: true,
      pointer: { buttons: 1, capture: false, keys: false },
    }
  )
  const stageDragHandlers = bindStageDrag()

  const changeZoom = (direction: -1 | 1) => {
    setClampedZoom(zoomRef.current + direction * ZOOM_STEP)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      changeZoom(1)
      return
    }
    if (event.key === "-") {
      event.preventDefault()
      changeZoom(-1)
      return
    }
    if (event.key === "0") {
      event.preventDefault()
      setClampedZoom(DEFAULT_ZOOM)
      setClampedPan({ x: 0, y: 0 })
    }
  }

  return (
    <div
      className={cn("image-preview-viewer", className)}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div
        {...stageDragHandlers}
        ref={setStage}
        className={cn("image-preview-stage", stageClassName)}
        data-dragging={dragging || undefined}
        data-pannable={!loadFailed || undefined}
        onWheelCapture={(event) => {
          if (event.ctrlKey) event.preventDefault()
        }}
      >
        {loadFailed ? (
          <div className="image-preview-fallback" role="status">
            <ImageIcon aria-hidden="true" />
            <span>
              {t("conversation.previewLoadFailed", { name: item.name })}
            </span>
          </div>
        ) : (
          <img
            ref={imageRef}
            className="image-preview-image"
            data-pan-x={pan.x}
            data-pan-y={pan.y}
            data-zoom={zoom}
            draggable={false}
            src={item.src}
            alt={item.alt ?? item.name}
            width="1600"
            height="900"
            referrerPolicy="no-referrer"
            onLoad={fitImageToStage}
            onError={() => {
              setLoadFailed(true)
              onLoadError?.()
            }}
          />
        )}
      </div>

      <div className="image-preview-zoom-controls">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="image-preview-zoom-button"
          aria-label={t("conversation.zoomOut")}
          disabled={zoom === MINIMUM_ZOOM}
          onClick={() => changeZoom(-1)}
        >
          <MinusIcon aria-hidden="true" />
        </Button>
        <output className="image-preview-zoom-value" aria-live="polite">
          {zoom}%
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="image-preview-zoom-button"
          aria-label={t("conversation.zoomIn")}
          disabled={zoom === MAXIMUM_ZOOM}
          onClick={() => changeZoom(1)}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function ImagePreviewDialogContent({
  items,
  activeItem,
  activeIndex,
  onActiveIdChange,
  onDownload,
  downloadingId,
}: {
  items: readonly ImagePreviewItem[]
  activeItem: ImagePreviewItem
  activeIndex: number
  onActiveIdChange: (id: string | null) => void
  onDownload?: (item: ImagePreviewItem) => void | Promise<void>
  downloadingId?: string
}) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  const zoomRef = useRef(DEFAULT_ZOOM)
  const [pan, setPan] = useState<ImagePreviewPan>({ x: 0, y: 0 })
  const panRef = useRef<ImagePreviewPan>({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [fallbackDownloading, setFallbackDownloading] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageElement, setStageElement] = useState<HTMLDivElement | null>(null)
  const stageTarget = useMemo(() => ({ current: stageElement }), [stageElement])
  const [loadFailed, setLoadFailed] = useState(false)
  const hasPrevious = activeIndex > 0
  const hasNext = activeIndex < items.length - 1
  const showNavigation = items.length > 1
  const downloading =
    downloadingId === activeItem.id || (!onDownload && fallbackDownloading)

  const getPanBounds = useCallback(() => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return { x: 0, y: 0 }

    const stageRect = stage.getBoundingClientRect()
    const imageWidth = image.clientWidth
    const imageHeight = image.clientHeight
    if (
      stageRect.width <= 0 ||
      stageRect.height <= 0 ||
      imageWidth <= 0 ||
      imageHeight <= 0
    ) {
      return { x: 0, y: 0 }
    }
    const scale = zoomRef.current / 100

    const scaledImageWidth = imageWidth * scale
    const scaledImageHeight = imageHeight * scale

    return {
      x:
        Math.abs(scaledImageWidth - stageRect.width) / 2 +
        Math.min(scaledImageWidth, stageRect.width) * PAN_EDGE_ALLOWANCE_RATIO,
      y:
        Math.abs(scaledImageHeight - stageRect.height) / 2 +
        Math.min(scaledImageHeight, stageRect.height) *
          PAN_EDGE_ALLOWANCE_RATIO,
    }
  }, [])

  const setClampedPan = useCallback(
    (nextPan: ImagePreviewPan) => {
      const bounds = getPanBounds()
      const clampedPan = {
        x: Math.min(bounds.x, Math.max(-bounds.x, nextPan.x)),
        y: Math.min(bounds.y, Math.max(-bounds.y, nextPan.y)),
      }

      if (
        panRef.current.x === clampedPan.x &&
        panRef.current.y === clampedPan.y
      ) {
        return
      }

      panRef.current = clampedPan
      imageRef.current?.style.setProperty(
        "--image-preview-translate-x",
        `${clampedPan.x}px`
      )
      imageRef.current?.style.setProperty(
        "--image-preview-translate-y",
        `${clampedPan.y}px`
      )
      setPan(clampedPan)
    },
    [getPanBounds]
  )

  const setClampedZoom = (nextZoom: number) => {
    const clampedZoom = Math.min(MAXIMUM_ZOOM, Math.max(MINIMUM_ZOOM, nextZoom))
    zoomRef.current = clampedZoom
    imageRef.current?.style.setProperty(
      "--image-preview-scale",
      String(clampedZoom / 100)
    )
    setClampedPan(panRef.current)
    setZoom(clampedZoom)
  }

  const fitImageToStage = useCallback(() => {
    const stage = stageRef.current
    const image = imageRef.current
    if (!stage || !image) return

    const stageRect = stage.getBoundingClientRect()
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    if (
      stageRect.width <= 0 ||
      stageRect.height <= 0 ||
      naturalWidth <= 0 ||
      naturalHeight <= 0
    ) {
      return
    }

    // Keep the original no-upscale behavior, while making the initial image
    // box fit both usable dimensions. This avoids tall images being cropped
    // by the stage before the user starts zooming or dragging.
    const fitScale = Math.min(
      1,
      stageRect.width / naturalWidth,
      stageRect.height / naturalHeight
    )
    image.style.setProperty(
      "--image-preview-fit-width",
      `${Math.max(1, Math.floor(naturalWidth * fitScale))}px`
    )
    image.style.setProperty(
      "--image-preview-fit-height",
      `${Math.max(1, Math.floor(naturalHeight * fitScale))}px`
    )
    // Content is keyed by source, so each newly opened image starts from a
    // zero pan. Updating the DOM directly here avoids turning a cached-image
    // fit into another React render while the image is mounting.
    panRef.current = { x: 0, y: 0 }
    image.style.setProperty("--image-preview-translate-x", "0px")
    image.style.setProperty("--image-preview-translate-y", "0px")
  }, [])

  const scheduleImageFit = useCallback(() => {
    queueMicrotask(() => fitImageToStage())
  }, [fitImageToStage])

  // `use-gesture` attaches target listeners from an effect. Keep this ref
  // callback stable and limit it to one mount-state sync; cached images must
  // never schedule fitting from a ref attachment, otherwise a fit can trigger
  // a render and reattach the ref again.
  const setStage = useCallback((element: HTMLDivElement | null) => {
    stageRef.current = element
    setStageElement((current) => (current === element ? current : element))
  }, [])

  // A browser can serve an image from cache without dispatching `load` after
  // the dialog mounts. Fit it only after the stable stage target is mounted,
  // rather than coupling the fit to ref attachment.
  useEffect(() => {
    if (stageElement && imageRef.current?.complete) scheduleImageFit()
  }, [activeItem.src, scheduleImageFit, stageElement])

  const downloadActiveImage = async () => {
    setFallbackDownloading(true)
    try {
      await downloadImagePreviewItem(activeItem, onDownload)
    } catch {
      // Some third-party image hosts allow rendering but do not grant fetch
      // access. Keep the dialog usable and restore the control in that case.
    } finally {
      setFallbackDownloading(false)
    }
  }

  usePinch(
    ({ offset: [nextScale], event }) => {
      if (event.cancelable) event.preventDefault()
      setClampedZoom(Math.round(nextScale * 100))
    },
    {
      target: stageTarget,
      eventOptions: { capture: true, passive: false },
      from: () => [zoomRef.current / 100, 0],
      scaleBounds: {
        min: MINIMUM_ZOOM / 100,
        max: MAXIMUM_ZOOM / 100,
      },
      rubberband: 0,
      pointer: { touch: true },
    }
  )

  const bindStageDrag = useDrag(
    ({ active, event, offset: [x, y], pinching }) => {
      const isMultiTouchGesture =
        typeof TouchEvent !== "undefined" &&
        event instanceof TouchEvent &&
        event.touches.length > 1

      if (pinching || isMultiTouchGesture) {
        if (!active) setDragging(false)
        return
      }

      if (event.cancelable) event.preventDefault()
      setDragging(active)
      setClampedPan({ x, y })
    },
    {
      from: () => [panRef.current.x, panRef.current.y],
      bounds: () => {
        const bounds = getPanBounds()
        return {
          left: -bounds.x,
          right: bounds.x,
          top: -bounds.y,
          bottom: bounds.y,
        }
      },
      rubberband: 0,
      threshold: 0,
      filterTaps: true,
      pointer: { buttons: 1, capture: false, keys: false },
    }
  )
  const stageDragHandlers = bindStageDrag()

  const changeImage = (direction: -1 | 1) => {
    const nextItem = items[activeIndex + direction]
    if (nextItem) onActiveIdChange(nextItem.id)
  }

  const changeZoom = (direction: -1 | 1) => {
    setClampedZoom(zoomRef.current + direction * ZOOM_STEP)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault()
      changeImage(-1)
      return
    }
    if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault()
      changeImage(1)
      return
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      changeZoom(1)
      return
    }
    if (event.key === "-") {
      event.preventDefault()
      changeZoom(-1)
      return
    }
    if (event.key === "0") {
      event.preventDefault()
      setClampedZoom(DEFAULT_ZOOM)
      setClampedPan({ x: 0, y: 0 })
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="image-preview-overlay"
      className="image-preview-dialog top-0 left-0 translate-x-0 translate-y-0"
      onKeyDown={handleKeyDown}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>
          {t("conversation.imagePreviewTitle", { name: activeItem.name })}
        </DialogTitle>
        <DialogDescription>
          {t("conversation.imagePreviewDescription", {
            name: activeItem.name,
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="image-preview-toolbar">
        {activeItem.downloadable !== false && (
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="image-preview-control"
            aria-label={t("common.download")}
            aria-busy={downloading || undefined}
            disabled={downloading}
            onClick={() => void downloadActiveImage()}
          >
            {downloading ? (
              <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
            ) : (
              <DownloadIcon aria-hidden="true" />
            )}
          </Button>
        )}
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              className="image-preview-control"
              aria-label={t("common.close")}
            />
          }
        >
          <XIcon aria-hidden="true" />
        </DialogClose>
      </div>

      <div
        {...stageDragHandlers}
        ref={setStage}
        className="image-preview-stage"
        data-dragging={dragging || undefined}
        data-pannable={!loadFailed || undefined}
        onWheelCapture={(event) => {
          if (event.ctrlKey) event.preventDefault()
        }}
      >
        {loadFailed ? (
          <div className="image-preview-fallback" role="status">
            <ImageIcon aria-hidden="true" />
            <span>
              {t("conversation.previewLoadFailed", { name: activeItem.name })}
            </span>
          </div>
        ) : (
          <img
            ref={imageRef}
            className="image-preview-image"
            data-pan-x={pan.x}
            data-pan-y={pan.y}
            data-zoom={zoom}
            draggable={false}
            src={activeItem.src}
            alt={activeItem.alt ?? activeItem.name}
            width="1600"
            height="900"
            referrerPolicy="no-referrer"
            onLoad={fitImageToStage}
            onError={() => setLoadFailed(true)}
          />
        )}
      </div>

      {showNavigation && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="image-preview-control image-preview-previous"
            aria-label={t("conversation.previousImage")}
            disabled={!hasPrevious}
            onClick={() => changeImage(-1)}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="image-preview-control image-preview-next"
            aria-label={t("conversation.nextImage")}
            disabled={!hasNext}
            onClick={() => changeImage(1)}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </>
      )}

      <div className="image-preview-zoom-controls">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="image-preview-zoom-button"
          aria-label={t("conversation.zoomOut")}
          disabled={zoom === MINIMUM_ZOOM}
          onClick={() => changeZoom(-1)}
        >
          <MinusIcon aria-hidden="true" />
        </Button>
        <output className="image-preview-zoom-value" aria-live="polite">
          {zoom}%
        </output>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="image-preview-zoom-button"
          aria-label={t("conversation.zoomIn")}
          disabled={zoom === MAXIMUM_ZOOM}
          onClick={() => changeZoom(1)}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
    </DialogContent>
  )
}
