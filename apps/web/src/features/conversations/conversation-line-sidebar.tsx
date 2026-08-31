import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { normalizeLanguage } from "@/i18n"
import { formatContextualMessageTime, formatDateTime } from "@/i18n/date"
import { cn } from "@/lib/utils"

type LineSidebarFalloff = "linear" | "smooth" | "sharp" | "arc"

export type ConversationLineSidebarItem = {
  id: string
  userMessage: string
  assistantMessage?: string
  createdAt?: string
}

export type ConversationLineSidebarProps = {
  ariaLabel: string
  items: readonly ConversationLineSidebarItem[]
  activeItemId?: string | null
  defaultActiveItemId?: string | null
  proximityRadius?: number
  markerLength?: number
  collapsedMarkerLength?: number
  itemGap?: number
  smoothing?: number
  falloff?: LineSidebarFalloff
  className?: string
  onItemSelect?: (item: ConversationLineSidebarItem, index: number) => void
}

const ARC_FALLOFF_POINTS = [0, 0.2, 0.4, 0.7, 1] as const

function getArcFalloff(value: number) {
  const scaledValue =
    Math.min(Math.max(value, 0), 1) * (ARC_FALLOFF_POINTS.length - 1)
  const lowerIndex = Math.floor(scaledValue)
  const upperIndex = Math.min(lowerIndex + 1, ARC_FALLOFF_POINTS.length - 1)
  const progress = scaledValue - lowerIndex
  const lowerValue = ARC_FALLOFF_POINTS[lowerIndex]
  const upperValue = ARC_FALLOFF_POINTS[upperIndex]

  return lowerValue + (upperValue - lowerValue) * progress
}

const FALLOFF_CURVES: Record<LineSidebarFalloff, (value: number) => number> = {
  linear: (value) => value,
  smooth: (value) => value * value * (3 - 2 * value),
  sharp: (value) => value * value * value,
  arc: getArcFalloff,
}
const CLICK_PREVIEW_SUPPRESSION_MS = 180

function getReducedMotionPreference() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function requestEffectFrame(callback: FrameRequestCallback) {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback)
  }
  return window.setTimeout(() => callback(performance.now()), 16)
}

function cancelEffectFrame(frameId: number) {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frameId)
  } else {
    window.clearTimeout(frameId)
  }
}

export function ConversationLineSidebar({
  ariaLabel,
  items,
  activeItemId,
  defaultActiveItemId = null,
  proximityRadius = 40,
  markerLength = 26,
  collapsedMarkerLength = 6,
  itemGap = 0,
  smoothing = 90,
  falloff = "arc",
  className,
  onItemSelect,
}: ConversationLineSidebarProps) {
  const { i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const listRef = useRef<HTMLUListElement>(null)
  const itemRefs = useRef<(HTMLLIElement | null)[]>([])
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const targetsRef = useRef<number[]>([])
  const currentRef = useRef<number[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const animationRunnerRef = useRef<FrameRequestCallback>(() => undefined)
  const lastFrameRef = useRef(0)
  const previewIndexRef = useRef<number | null>(null)
  const previewSuppressedRef = useRef(false)
  const previewSuppressionTimerRef = useRef<number | null>(null)
  const smoothingRef = useRef(smoothing)
  const reducedMotionRef = useRef(false)
  const [uncontrolledActiveId, setUncontrolledActiveId] = useState<
    string | null
  >(defaultActiveItemId)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [previewSuppressed, setPreviewSuppressed] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    getReducedMotionPreference
  )

  const selectedItemId =
    activeItemId === undefined ? uncontrolledActiveId : activeItemId
  const applyEffectsImmediately = useCallback(() => {
    itemRefs.current.forEach((element, index) => {
      if (!element) return
      const value = Math.max(
        targetsRef.current[index] ?? 0,
        previewIndexRef.current === index ? 1 : 0
      )
      currentRef.current[index] = value
      element.style.setProperty("--line-effect", value.toFixed(4))
    })
  }, [])

  const runAnimationFrame = useCallback((now: number) => {
    const elapsedSeconds = Math.min(
      Math.max(now - lastFrameRef.current, 0) / 1_000,
      0.05
    )
    const smoothingSeconds = Math.max(smoothingRef.current, 1) / 1_000
    const smoothingFactor = 1 - Math.exp(-elapsedSeconds / smoothingSeconds)
    let moving = false

    itemRefs.current.forEach((element, index) => {
      if (!element) return
      const target = Math.max(
        targetsRef.current[index] ?? 0,
        previewIndexRef.current === index ? 1 : 0
      )
      const current = currentRef.current[index] ?? 0
      const nextValue = current + (target - current) * smoothingFactor
      const settled = Math.abs(target - nextValue) < 0.0015
      const value = settled ? target : nextValue
      currentRef.current[index] = value
      element.style.setProperty("--line-effect", value.toFixed(4))
      if (!settled) moving = true
    })

    animationFrameRef.current = moving
      ? requestEffectFrame(animationRunnerRef.current)
      : null
  }, [])

  const startEffectUpdate = useCallback(() => {
    if (reducedMotionRef.current) {
      if (animationFrameRef.current !== null) {
        cancelEffectFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      applyEffectsImmediately()
      return
    }
    if (animationFrameRef.current !== null) return
    lastFrameRef.current = performance.now()
    animationFrameRef.current = requestEffectFrame(animationRunnerRef.current)
  }, [applyEffectsImmediately])

  const clearPreviewSuppressionTimer = useCallback(() => {
    if (previewSuppressionTimerRef.current === null) return
    window.clearTimeout(previewSuppressionTimerRef.current)
    previewSuppressionTimerRef.current = null
  }, [])

  const releasePreviewSuppression = useCallback(() => {
    clearPreviewSuppressionTimer()
    previewSuppressedRef.current = false
    setPreviewSuppressed(false)
  }, [clearPreviewSuppressionTimer])

  const setPreviewSuppression = useCallback(
    (suppressed: boolean, releaseDelay?: number) => {
      clearPreviewSuppressionTimer()
      previewSuppressedRef.current = suppressed
      setPreviewSuppressed(suppressed)

      if (suppressed && releaseDelay !== undefined) {
        previewSuppressionTimerRef.current = window.setTimeout(
          releasePreviewSuppression,
          releaseDelay
        )
      }
    },
    [clearPreviewSuppressionTimer, releasePreviewSuppression]
  )

  const resetProximityEffects = useCallback(() => {
    targetsRef.current = items.map(() => 0)
    startEffectUpdate()
  }, [items, startEffectUpdate])

  useEffect(() => {
    animationRunnerRef.current = runAnimationFrame
  }, [runAnimationFrame])

  useEffect(() => {
    previewIndexRef.current = previewIndex
    smoothingRef.current = smoothing
    reducedMotionRef.current = prefersReducedMotion
    startEffectUpdate()
  }, [prefersReducedMotion, previewIndex, smoothing, startEffectUpdate])

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches)
    }
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length)
    buttonRefs.current = buttonRefs.current.slice(0, items.length)
    targetsRef.current = items.map((_, index) => targetsRef.current[index] ?? 0)
    currentRef.current = items.map((_, index) => currentRef.current[index] ?? 0)
    startEffectUpdate()
  }, [items, startEffectUpdate])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelEffectFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      clearPreviewSuppressionTimer()
    },
    [clearPreviewSuppressionTimer]
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLUListElement>) => {
      if (event.pointerType === "touch") return
      const curve = FALLOFF_CURVES[falloff]
      const radius = Math.max(proximityRadius, 1)
      const target = event.target
      let hoveredIndex: number | null = null

      itemRefs.current.forEach((element, index) => {
        if (!element) return
        const button = buttonRefs.current[index]
        const rect = element.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        const proximity = Math.max(
          0,
          1 - Math.abs(event.clientY - centerY) / radius
        )
        targetsRef.current[index] = curve(proximity)
        if (target instanceof Node && button?.contains(target)) {
          hoveredIndex = index
        }
      })
      if (!previewSuppressedRef.current && hoveredIndex !== null) {
        setPreviewIndex((current) =>
          current === hoveredIndex ? current : hoveredIndex
        )
      }
      startEffectUpdate()
    },
    [falloff, proximityRadius, startEffectUpdate]
  )

  const handlePointerLeave = useCallback(() => {
    setPreviewSuppression(false)
    resetProximityEffects()
  }, [resetProximityEffects, setPreviewSuppression])

  const focusItem = useCallback((index: number) => {
    buttonRefs.current[index]?.focus()
  }, [])

  const handleKeyboardNavigation = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (!items.length) return
      if (event.key === "ArrowDown") {
        event.preventDefault()
        focusItem((index + 1) % items.length)
      } else if (event.key === "ArrowUp") {
        event.preventDefault()
        focusItem((index - 1 + items.length) % items.length)
      } else if (event.key === "Home") {
        event.preventDefault()
        focusItem(0)
      } else if (event.key === "End") {
        event.preventDefault()
        focusItem(items.length - 1)
      }
    },
    [focusItem, items.length]
  )

  if (!items.length) return null

  const collapsedScale = Math.min(
    1,
    Math.max(collapsedMarkerLength, 1) / Math.max(markerLength, 1)
  )

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("relative overflow-visible", className)}
      style={
        {
          "--line-marker-length": `${Math.max(markerLength, 1)}px`,
          "--line-collapsed-scale": collapsedScale,
          "--line-item-gap": `${Math.max(itemGap, 0)}px`,
        } as CSSProperties
      }
    >
      <ul
        ref={listRef}
        data-testid="conversation-line-sidebar-list"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="m-0 flex list-none flex-col [gap:var(--line-item-gap)] overflow-visible p-0"
      >
        {items.map((item, index) => {
          const selected = selectedItemId === item.id
          const previewVisible = previewIndex === index
          const previewTime = formatContextualMessageTime(
            item.createdAt,
            language
          )
          const previewFullTime = formatDateTime(item.createdAt, language)

          return (
            <li
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element
              }}
              data-testid={`conversation-line-${item.id}`}
              data-selected={selected || undefined}
              className="relative flex h-2.5 w-[var(--line-marker-length)] items-center overflow-visible [--line-effect:0]"
            >
              <HoverCard
                open={previewVisible}
                onOpenChange={(nextOpen) => {
                  if (previewSuppressedRef.current && nextOpen) return
                  setPreviewIndex((current) =>
                    nextOpen ? index : current === index ? null : current
                  )
                }}
              >
                <HoverCardTrigger
                  delay={0}
                  closeDelay={0}
                  openOnHover={!previewSuppressed}
                  render={
                    <Button
                      ref={(element) => {
                        buttonRefs.current[index] = element
                      }}
                      type="button"
                      variant="ghost"
                      aria-label={item.userMessage}
                      aria-current={selected ? "true" : undefined}
                      className="h-2.5 w-[var(--line-marker-length)] justify-start rounded-none border-0 bg-transparent p-0 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-[var(--app-text)]/25 active:translate-y-0 aria-expanded:bg-transparent aria-expanded:text-inherit motion-reduce:transition-none dark:aria-expanded:bg-transparent"
                      onFocus={() => {
                        if (!previewSuppressedRef.current) {
                          setPreviewIndex(index)
                        }
                      }}
                      onBlur={() =>
                        setPreviewIndex((current) =>
                          current === index ? null : current
                        )
                      }
                      onKeyDown={(event) =>
                        handleKeyboardNavigation(event, index)
                      }
                      onClick={(event) => {
                        if (activeItemId === undefined) {
                          setUncontrolledActiveId(item.id)
                        }
                        if (onItemSelect) {
                          setPreviewSuppression(
                            true,
                            CLICK_PREVIEW_SUPPRESSION_MS
                          )
                          setPreviewIndex(null)
                          resetProximityEffects()
                          event.currentTarget.blur()
                          buttonRefs.current[index]?.blur()
                        }
                        onItemSelect?.(item, index)
                      }}
                    />
                  }
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block h-0.5 w-[var(--line-marker-length)] origin-left bg-[var(--app-muted)] will-change-transform motion-safe:transition-[transform,opacity] motion-safe:duration-100 motion-safe:ease-out motion-reduce:transition-none",
                      previewVisible
                        ? "[transform:scaleX(1)] opacity-100"
                        : "[transform:scaleX(calc(var(--line-collapsed-scale)+(1-var(--line-collapsed-scale))*var(--line-effect)))] opacity-[calc(0.48+var(--line-effect)*0.52)]",
                      selected && "bg-[var(--app-text)]"
                    )}
                  />
                </HoverCardTrigger>
                <HoverCardContent
                  side="right"
                  sideOffset={12}
                  align="center"
                  aria-label={item.userMessage}
                  className="conversation-line-preview w-80 max-w-[calc(100vw-2rem)] overflow-hidden text-left data-closed:animate-none data-closed:opacity-0 data-closed:duration-0"
                >
                  <p
                    data-message-role="user"
                    className="line-clamp-2 text-[length:var(--app-ui-font-size)] leading-[var(--app-ui-compact-line-height)] font-medium text-[var(--app-text)]"
                  >
                    {item.userMessage}
                  </p>
                  {item.assistantMessage && (
                    <p
                      data-message-role="assistant"
                      className="mt-1.5 line-clamp-2 text-[length:var(--app-font-13)] leading-5 font-medium text-[var(--app-muted)]"
                    >
                      {item.assistantMessage}
                    </p>
                  )}
                  {previewTime ? (
                    <time
                      dateTime={item.createdAt}
                      title={
                        previewFullTime === "—" ? undefined : previewFullTime
                      }
                      className="mt-2 block text-[length:var(--app-font-12)] leading-[var(--app-line-18)] font-medium text-[var(--app-muted)]"
                    >
                      {previewTime}
                    </time>
                  ) : null}
                </HoverCardContent>
              </HoverCard>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
