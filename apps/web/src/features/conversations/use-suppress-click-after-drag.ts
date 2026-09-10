import { useCallback, useEffect, useRef } from "react"

export function useSuppressClickAfterDrag() {
  const suppressClickAfterDragRef = useRef(false)
  const clearSuppressClickAfterDragTimerRef = useRef<number | undefined>(
    undefined
  )
  const resetSuppressClickAfterDrag = useCallback(() => {
    if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
      window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
      clearSuppressClickAfterDragTimerRef.current = undefined
    }
    suppressClickAfterDragRef.current = false
  }, [])

  const scheduleSuppressClickAfterDragReset = useCallback(() => {
    if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
      window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
    }
    clearSuppressClickAfterDragTimerRef.current = window.setTimeout(() => {
      resetSuppressClickAfterDrag()
    }, 250)
  }, [resetSuppressClickAfterDrag])

  useEffect(() => {
    // dnd-kit stops the trailing click at document capture without cancelling
    // the anchor default, so cancel it earlier to avoid native navigation.
    const preventNativeNavigationAfterDrag = (event: MouseEvent) => {
      if (!suppressClickAfterDragRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    window.addEventListener("click", preventNativeNavigationAfterDrag, true)
    return () => {
      window.removeEventListener(
        "click",
        preventNativeNavigationAfterDrag,
        true
      )
      if (clearSuppressClickAfterDragTimerRef.current !== undefined) {
        window.clearTimeout(clearSuppressClickAfterDragTimerRef.current)
      }
    }
  }, [resetSuppressClickAfterDrag])

  return {
    start: () => {
      suppressClickAfterDragRef.current = true
    },
    end: scheduleSuppressClickAfterDragReset,
  }
}
