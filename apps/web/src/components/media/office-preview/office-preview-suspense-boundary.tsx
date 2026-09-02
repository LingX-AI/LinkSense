import {
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react"

export const OFFICE_PREVIEW_ENTER_CLASS = "office-preview-pane-entering"
export const OFFICE_PREVIEW_ENTER_ANIMATION_NAME =
  "conversation-file-preview-pane-in"
export const OFFICE_PREVIEW_EXIT_ANIMATION_NAME =
  "conversation-file-preview-pane-out"

function shouldSkipEntranceAnimation() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

function OfficePreviewSuspenseFallback({
  children,
  onPresented,
}: Readonly<{
  children: ReactNode
  onPresented: () => void
}>) {
  useEffect(() => {
    onPresented()
  }, [onPresented])

  return children
}

export function OfficePreviewSuspenseBoundary({
  children,
  fallback,
}: Readonly<{
  children: (paneClassName: string | undefined) => ReactNode
  fallback: (paneClassName: string | undefined) => ReactNode
}>) {
  const [fallbackPresented, setFallbackPresented] = useState(false)
  const [entranceFinished, setEntranceFinished] = useState(
    shouldSkipEntranceAnimation
  )
  const markFallbackPresented = useCallback(() => {
    setFallbackPresented(true)
  }, [])

  // A cached lazy preview skips the Suspense fallback, so the boundary owns
  // removing the entrance class after the actual pane finishes its motion.
  useEffect(() => {
    if (entranceFinished) return

    const finishEntrance = (event: AnimationEvent) => {
      const animationTarget = event.target
      if (
        event.animationName === OFFICE_PREVIEW_ENTER_ANIMATION_NAME &&
        animationTarget instanceof Element &&
        animationTarget.classList.contains(OFFICE_PREVIEW_ENTER_CLASS)
      ) {
        setEntranceFinished(true)
      }
    }
    document.addEventListener("animationend", finishEntrance)
    document.addEventListener("animationcancel", finishEntrance)
    return () => {
      document.removeEventListener("animationend", finishEntrance)
      document.removeEventListener("animationcancel", finishEntrance)
    }
  }, [entranceFinished])

  const entranceClassName = entranceFinished
    ? undefined
    : OFFICE_PREVIEW_ENTER_CLASS

  return (
    <Suspense
      fallback={
        <OfficePreviewSuspenseFallback onPresented={markFallbackPresented}>
          {fallback(entranceClassName)}
        </OfficePreviewSuspenseFallback>
      }
    >
      {children(fallbackPresented ? undefined : entranceClassName)}
    </Suspense>
  )
}
