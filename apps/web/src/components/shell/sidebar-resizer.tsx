import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

import {
  clampSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
} from "@/components/shell/sidebar-width"
import { cn } from "@/lib/utils"

const KEYBOARD_RESIZE_STEP = 8
const LARGE_KEYBOARD_RESIZE_STEP = 24

type SidebarResizerProps = {
  label: string
  value: number
  minValue?: number
  maxValue?: number
  className?: string
  onResize: (width: number) => void
  onResizeStart?: () => void
  onResizeEnd?: (width: number) => void
}

type DragState = {
  pointerId: number
  startX: number
  startWidth: number
  currentWidth: number
  appliedWidth: number
}

export function SidebarResizer({
  label,
  value,
  minValue = MIN_SIDEBAR_WIDTH,
  maxValue = MAX_SIDEBAR_WIDTH,
  className,
  onResize,
  onResizeStart,
  onResizeEnd,
}: SidebarResizerProps) {
  const dragStateRef = useRef<DragState | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    },
    []
  )

  const flushResize = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    const dragState = dragStateRef.current
    if (!dragState || dragState.currentWidth === dragState.appliedWidth) return
    dragState.appliedWidth = dragState.currentWidth
    onResize(dragState.currentWidth)
  }

  const constrainWidth = (width: number) => {
    if (minValue === MIN_SIDEBAR_WIDTH && maxValue === MAX_SIDEBAR_WIDTH) {
      return clampSidebarWidth(width)
    }
    if (!Number.isFinite(width)) return value
    const lowerBound = Math.min(minValue, maxValue)
    const upperBound = Math.max(minValue, maxValue)
    return Math.min(upperBound, Math.max(lowerBound, Math.round(width)))
  }

  const completeResize = (target: HTMLDivElement, pointerId: number) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== pointerId) return

    const completedWidth = dragState.currentWidth
    flushResize()
    dragStateRef.current = null
    setIsResizing(false)
    if (
      typeof target.hasPointerCapture === "function" &&
      target.hasPointerCapture(pointerId)
    ) {
      target.releasePointerCapture(pointerId)
    }
    onResizeEnd?.(completedWidth)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragStateRef.current) return

    event.preventDefault()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: value,
      currentWidth: value,
      appliedWidth: value,
    }
    setIsResizing(true)
    onResizeStart?.()

    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const nextWidth = constrainWidth(
      dragState.startWidth + event.clientX - dragState.startX
    )
    dragState.currentWidth = nextWidth
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(flushResize)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey
      ? LARGE_KEYBOARD_RESIZE_STEP
      : KEYBOARD_RESIZE_STEP
    let nextWidth: number

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = constrainWidth(value - step)
        break
      case "ArrowRight":
        nextWidth = constrainWidth(value + step)
        break
      case "Home":
        nextWidth = Math.min(minValue, maxValue)
        break
      case "End":
        nextWidth = Math.max(minValue, maxValue)
        break
      default:
        return
    }

    event.preventDefault()
    onResize(nextWidth)
    onResizeEnd?.(nextWidth)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={Math.min(minValue, maxValue)}
      aria-valuemax={Math.max(minValue, maxValue)}
      aria-valuenow={value}
      className={cn("sidebar-resize-handle", className)}
      data-resizing={isResizing ? "true" : undefined}
      tabIndex={0}
      title={label}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) =>
        completeResize(event.currentTarget, event.pointerId)
      }
      onPointerCancel={(event) =>
        completeResize(event.currentTarget, event.pointerId)
      }
      onLostPointerCapture={(event) =>
        completeResize(event.currentTarget, event.pointerId)
      }
    />
  )
}
