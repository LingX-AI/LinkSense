import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from "react"
import type { ConversationThreadNavigation } from "@/features/conversations/conversation-message-list"

export const CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX = 500
export const CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS = 180
export const CONVERSATION_STREAM_FOLLOW_HALF_LIFE_MS = 28

const CONVERSATION_BOTTOM_RESUME_TOLERANCE_PX = 1
const CONVERSATION_STREAM_FOLLOW_SETTLE_PX = 0.5
const CONVERSATION_STREAM_FOLLOW_MAX_FRAME_MS = 64

type ConversationScrollElement = Pick<
  HTMLElement,
  "clientHeight" | "scrollHeight" | "scrollTop"
>

function getConversationScrollTargetTop(
  element: ConversationScrollElement,
  requestedTop: number
) {
  return Math.min(
    Math.max(requestedTop, 0),
    Math.max(0, element.scrollHeight - element.clientHeight)
  )
}

export function getConversationDistanceFromBottom(
  element: ConversationScrollElement
) {
  return Math.max(
    0,
    element.scrollHeight - element.clientHeight - element.scrollTop
  )
}

export function useConversationScroll(
  conversationId: string,
  {
    preservePositionOnConversationChange = false,
    navigationRef,
  }: {
    preservePositionOnConversationChange?: boolean
    navigationRef?: RefObject<Pick<
      ConversationThreadNavigation,
      "scrollToLatest" | "cancelScroll"
    > | null>
  } = {}
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const followingLatestRef = useRef(true)
  const resumeOnUserScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const pointerActiveRef = useRef(false)
  const touchYRef = useRef<number | null>(null)
  const scrollAnimationFrameRef = useRef<number | null>(null)
  const resizeFollowFrameRef = useRef<number | null>(null)
  const resizeFollowTimestampRef = useRef<number | null>(null)
  const interactionRestoreFrameRef = useRef<number | null>(null)
  const activeConversationIdRef = useRef(conversationId)
  const activeContainerRef = useRef<HTMLDivElement | null>(null)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [content, setContent] = useState<HTMLDivElement | null>(null)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const cancelScrollAnimation = useCallback(() => {
    if (scrollAnimationFrameRef.current === null) return
    window.cancelAnimationFrame(scrollAnimationFrameRef.current)
    scrollAnimationFrameRef.current = null
  }, [])

  const cancelResizeFollow = useCallback(() => {
    if (resizeFollowFrameRef.current === null) return
    window.cancelAnimationFrame(resizeFollowFrameRef.current)
    resizeFollowFrameRef.current = null
    resizeFollowTimestampRef.current = null
  }, [])

  const cancelInteractionRestore = useCallback(() => {
    if (interactionRestoreFrameRef.current === null) return
    window.cancelAnimationFrame(interactionRestoreFrameRef.current)
    interactionRestoreFrameRef.current = null
  }, [])

  const updateButtonVisibility = useCallback(() => {
    const element = containerRef.current
    if (
      !element ||
      scrollAnimationFrameRef.current !== null ||
      resizeFollowFrameRef.current !== null
    ) {
      setShowScrollToBottom(false)
      return
    }
    const shouldShow =
      getConversationDistanceFromBottom(element) >
      CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX
    setShowScrollToBottom((current) =>
      current === shouldShow ? current : shouldShow
    )
  }, [])

  const scrollToBottomImmediately = useCallback(() => {
    cancelResizeFollow()
    cancelScrollAnimation()
    followingLatestRef.current = true
    resumeOnUserScrollRef.current = false
    const element = containerRef.current
    if (!element) return

    if (navigationRef?.current?.scrollToLatest("auto")) {
      lastScrollTopRef.current = element.scrollTop
      return
    }

    const top = element.scrollHeight
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ top, behavior: "auto" })
    } else {
      element.scrollTop = top
    }
    lastScrollTopRef.current = element.scrollTop
  }, [cancelResizeFollow, cancelScrollAnimation, navigationRef])

  const followLatestSmoothly = useCallback(() => {
    const element = containerRef.current
    if (!element || scrollAnimationFrameRef.current !== null) return

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion || typeof window.requestAnimationFrame !== "function") {
      scrollToBottomImmediately()
      setShowScrollToBottom(false)
      return
    }
    if (resizeFollowFrameRef.current !== null) return

    // A pending virtual-list index target would snap to the growing bottom
    // during measurement reconciliation. Release it before the follow loop
    // takes ownership of the scroll position, including for virtual lists.
    navigationRef?.current?.cancelScroll()

    const animate = (timestamp: number) => {
      resizeFollowFrameRef.current = null
      if (!followingLatestRef.current || containerRef.current !== element) {
        resizeFollowTimestampRef.current = null
        return
      }

      const targetTop = Math.max(0, element.scrollHeight - element.clientHeight)
      const distance = targetTop - element.scrollTop
      if (Math.abs(distance) <= CONVERSATION_STREAM_FOLLOW_SETTLE_PX) {
        element.scrollTop = targetTop
        lastScrollTopRef.current = element.scrollTop
        resizeFollowTimestampRef.current = null
        setShowScrollToBottom(false)
        return
      }

      const previousTimestamp = resizeFollowTimestampRef.current
      const elapsed = Math.min(
        CONVERSATION_STREAM_FOLLOW_MAX_FRAME_MS,
        Math.max(
          1,
          previousTimestamp === null ? 16 : timestamp - previousTimestamp
        )
      )
      const progress =
        1 - 2 ** (-elapsed / CONVERSATION_STREAM_FOLLOW_HALF_LIFE_MS)
      element.scrollTop += distance * progress
      lastScrollTopRef.current = element.scrollTop
      resizeFollowTimestampRef.current = timestamp
      setShowScrollToBottom(false)
      resizeFollowFrameRef.current = window.requestAnimationFrame(animate)
    }

    resizeFollowFrameRef.current = window.requestAnimationFrame(animate)
  }, [navigationRef, scrollToBottomImmediately])

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      resumeOnUserScrollRef.current = false
      if (navigationRef?.current?.scrollToLatest(behavior)) {
        cancelScrollAnimation()
        cancelResizeFollow()
        followingLatestRef.current = true
        setShowScrollToBottom(false)
        return
      }
      if (
        behavior !== "smooth" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        scrollToBottomImmediately()
        setShowScrollToBottom(false)
        return
      }

      cancelScrollAnimation()
      cancelResizeFollow()
      followingLatestRef.current = true
      const element = containerRef.current
      if (!element) return

      const startTop = element.scrollTop
      const initialTargetTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight
      )
      const distance = initialTargetTop - startTop

      if (Math.abs(distance) <= 1) {
        element.scrollTop = initialTargetTop
        lastScrollTopRef.current = initialTargetTop
        setShowScrollToBottom(false)
        return
      }

      let startTime: number | null = null
      const animate = (timestamp: number) => {
        startTime ??= timestamp
        const progress = Math.min(
          1,
          (timestamp - startTime) / CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS
        )
        const easedProgress = 1 - (1 - progress) ** 3
        const targetTop = Math.max(
          0,
          element.scrollHeight - element.clientHeight
        )
        element.scrollTop = startTop + (targetTop - startTop) * easedProgress
        lastScrollTopRef.current = element.scrollTop

        if (progress < 1) {
          scrollAnimationFrameRef.current =
            window.requestAnimationFrame(animate)
          return
        }

        element.scrollTop = Math.max(
          0,
          element.scrollHeight - element.clientHeight
        )
        lastScrollTopRef.current = element.scrollTop
        scrollAnimationFrameRef.current = null
      }

      scrollAnimationFrameRef.current = window.requestAnimationFrame(animate)
      setShowScrollToBottom(false)
    },
    [
      cancelResizeFollow,
      cancelScrollAnimation,
      navigationRef,
      scrollToBottomImmediately,
    ]
  )

  const scrollToElement = useCallback(
    (target: HTMLElement, behavior: ScrollBehavior = "auto") => {
      cancelScrollAnimation()
      cancelResizeFollow()
      followingLatestRef.current = false
      resumeOnUserScrollRef.current = false
      const element = containerRef.current
      if (!element) return

      const containerRect = element.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const targetTop = getConversationScrollTargetTop(
        element,
        element.scrollTop +
          targetRect.top -
          containerRect.top -
          (element.clientHeight - targetRect.height) / 2
      )

      if (
        behavior !== "smooth" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        if (typeof element.scrollTo === "function") {
          element.scrollTo({ top: targetTop, behavior: "auto" })
        } else {
          element.scrollTop = targetTop
        }
        lastScrollTopRef.current = element.scrollTop
        setShowScrollToBottom(
          getConversationDistanceFromBottom(element) >
            CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX
        )
        return
      }

      const startTop = element.scrollTop
      const distance = targetTop - startTop

      if (Math.abs(distance) <= 1) {
        element.scrollTop = targetTop
        lastScrollTopRef.current = targetTop
        setShowScrollToBottom(
          getConversationDistanceFromBottom(element) >
            CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX
        )
        return
      }

      let startTime: number | null = null
      const animate = (timestamp: number) => {
        startTime ??= timestamp
        const progress = Math.min(
          1,
          (timestamp - startTime) / CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS
        )
        const easedProgress = 1 - (1 - progress) ** 3
        element.scrollTop = startTop + distance * easedProgress
        lastScrollTopRef.current = element.scrollTop

        if (progress < 1) {
          scrollAnimationFrameRef.current =
            window.requestAnimationFrame(animate)
          return
        }

        element.scrollTop = targetTop
        lastScrollTopRef.current = targetTop
        scrollAnimationFrameRef.current = null
        setShowScrollToBottom(
          getConversationDistanceFromBottom(element) >
            CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX
        )
      }

      scrollAnimationFrameRef.current = window.requestAnimationFrame(animate)
      setShowScrollToBottom(false)
    },
    [cancelResizeFollow, cancelScrollAnimation]
  )

  const pauseAutoFollow = useCallback(() => {
    cancelInteractionRestore()
    cancelResizeFollow()
    cancelScrollAnimation()
    followingLatestRef.current = false
    resumeOnUserScrollRef.current = false
    navigationRef?.current?.cancelScroll()
  }, [
    cancelInteractionRestore,
    cancelResizeFollow,
    cancelScrollAnimation,
    navigationRef,
  ])

  const preserveScrollPositionForInteraction = useCallback(() => {
    pauseAutoFollow()

    const element = containerRef.current
    if (!element) return
    const scrollTop = element.scrollTop

    interactionRestoreFrameRef.current = window.requestAnimationFrame(() => {
      interactionRestoreFrameRef.current = null
      if (containerRef.current !== element) return

      element.scrollTop = scrollTop
      lastScrollTopRef.current = element.scrollTop
      updateButtonVisibility()
    })
  }, [pauseAutoFollow, updateButtonVisibility])

  const scrollContainerRef: RefCallback<HTMLDivElement> = useCallback(
    (element) => {
      cancelInteractionRestore()
      cancelScrollAnimation()
      cancelResizeFollow()
      containerRef.current = element
      setContainer(element)
    },
    [cancelInteractionRestore, cancelResizeFollow, cancelScrollAnimation]
  )

  const contentRef: RefCallback<HTMLDivElement> = useCallback((element) => {
    setContent(element)
  }, [])

  useLayoutEffect(() => {
    if (!container) return
    const containerChanged = activeContainerRef.current !== container
    const conversationChanged =
      activeConversationIdRef.current !== conversationId
    activeContainerRef.current = container
    activeConversationIdRef.current = conversationId
    if (
      !containerChanged &&
      conversationChanged &&
      preservePositionOnConversationChange
    ) {
      lastScrollTopRef.current = container.scrollTop
      updateButtonVisibility()
      return
    }
    if (!containerChanged && !conversationChanged) return
    scrollToBottomImmediately()
  }, [
    container,
    conversationId,
    preservePositionOnConversationChange,
    scrollToBottomImmediately,
    updateButtonVisibility,
  ])

  useEffect(() => {
    if (!container) return

    lastScrollTopRef.current = container.scrollTop

    const handleScroll = () => {
      const nextScrollTop = container.scrollTop
      const distance = getConversationDistanceFromBottom(container)

      if (pointerActiveRef.current) {
        if (nextScrollTop < lastScrollTopRef.current) pauseAutoFollow()
        else if (nextScrollTop > lastScrollTopRef.current)
          resumeOnUserScrollRef.current = true
      }
      // Layout changes and queued programmatic scroll events can also land at
      // the bottom. Only a user's downward movement may release the pause.
      if (
        resumeOnUserScrollRef.current &&
        nextScrollTop > lastScrollTopRef.current &&
        distance <= CONVERSATION_BOTTOM_RESUME_TOLERANCE_PX
      ) {
        followingLatestRef.current = true
        resumeOnUserScrollRef.current = false
      }

      lastScrollTopRef.current = nextScrollTop
      updateButtonVisibility()
    }

    const prepareUserScrollToBottom = () => {
      resumeOnUserScrollRef.current = true
      // A downward gesture at the bottom may not emit any scroll event.
      if (
        getConversationDistanceFromBottom(container) <=
        CONVERSATION_BOTTOM_RESUME_TOLERANCE_PX
      ) {
        followingLatestRef.current = true
        resumeOnUserScrollRef.current = false
      }
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) pauseAutoFollow()
      else if (event.deltaY > 0) prepareUserScrollToBottom()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey)
      ) {
        pauseAutoFollow()
      } else if (
        event.key === "ArrowDown" ||
        event.key === "PageDown" ||
        event.key === "End" ||
        (event.key === " " && !event.shiftKey)
      ) {
        prepareUserScrollToBottom()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.isPrimary) {
        cancelResizeFollow()
        cancelScrollAnimation()
        navigationRef?.current?.cancelScroll()
        pointerActiveRef.current = true
        updateButtonVisibility()
      }
    }
    const handlePointerEnd = () => {
      pointerActiveRef.current = false
    }

    const handleTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches.item(0)?.clientY ?? null
    }
    const handleTouchMove = (event: TouchEvent) => {
      const nextY = event.touches.item(0)?.clientY
      if (nextY === undefined) return
      if (touchYRef.current !== null && nextY > touchYRef.current) {
        pauseAutoFollow()
      } else if (touchYRef.current !== null && nextY < touchYRef.current) {
        prepareUserScrollToBottom()
      }
      touchYRef.current = nextY
    }
    const handleTouchEnd = () => {
      touchYRef.current = null
    }
    const handleScrollEnd = () => {
      resumeOnUserScrollRef.current = false
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    container.addEventListener("scrollend", handleScrollEnd)
    container.addEventListener("wheel", handleWheel, { passive: true })
    container.addEventListener("keydown", handleKeyDown)
    container.addEventListener("pointerdown", handlePointerDown)
    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    })
    container.addEventListener("touchmove", handleTouchMove, {
      passive: true,
    })
    container.addEventListener("touchend", handleTouchEnd, { passive: true })
    container.addEventListener("touchcancel", handleTouchEnd, {
      passive: true,
    })
    window.addEventListener("pointerup", handlePointerEnd)
    window.addEventListener("pointercancel", handlePointerEnd)

    updateButtonVisibility()
    return () => {
      container.removeEventListener("scroll", handleScroll)
      container.removeEventListener("scrollend", handleScrollEnd)
      container.removeEventListener("wheel", handleWheel)
      container.removeEventListener("keydown", handleKeyDown)
      container.removeEventListener("pointerdown", handlePointerDown)
      container.removeEventListener("touchstart", handleTouchStart)
      container.removeEventListener("touchmove", handleTouchMove)
      container.removeEventListener("touchend", handleTouchEnd)
      container.removeEventListener("touchcancel", handleTouchEnd)
      window.removeEventListener("pointerup", handlePointerEnd)
      window.removeEventListener("pointercancel", handlePointerEnd)
      pointerActiveRef.current = false
      touchYRef.current = null
      resumeOnUserScrollRef.current = false
    }
  }, [
    cancelScrollAnimation,
    cancelResizeFollow,
    container,
    navigationRef,
    pauseAutoFollow,
    updateButtonVisibility,
  ])

  useEffect(() => {
    return () => {
      cancelInteractionRestore()
      cancelResizeFollow()
      cancelScrollAnimation()
    }
  }, [cancelInteractionRestore, cancelResizeFollow, cancelScrollAnimation])

  useEffect(() => {
    if (!container || !content) return

    const handleResize = () => {
      if (followingLatestRef.current) {
        followLatestSmoothly()
      } else {
        updateButtonVisibility()
      }
    }

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", handleResize)
      return () => {
        window.removeEventListener("resize", handleResize)
        cancelResizeFollow()
      }
    }

    const observer = new ResizeObserver(handleResize)
    observer.observe(container)
    observer.observe(content)
    return () => {
      observer.disconnect()
      cancelResizeFollow()
    }
  }, [
    cancelResizeFollow,
    container,
    content,
    followLatestSmoothly,
    updateButtonVisibility,
  ])

  return {
    scrollContainerRef,
    contentRef,
    showScrollToBottom,
    scrollToBottom,
    scrollToElement,
    pauseAutoFollow,
    preserveScrollPositionForInteraction,
  }
}
