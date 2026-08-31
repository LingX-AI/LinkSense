import { useCallback, useEffect, useRef, type RefCallback } from "react"

const bottomStackHeightProperty = "--conversation-bottom-stack-height"

export function observeConversationBottomStackHeight(
  bottomStack: HTMLElement
): () => void {
  const workspace = bottomStack.parentElement
  if (!workspace) return () => undefined

  const updateHeight = () => {
    const height = Math.max(
      0,
      Math.ceil(bottomStack.getBoundingClientRect().height)
    )
    workspace.style.setProperty(bottomStackHeightProperty, `${height}px`)
  }

  updateHeight()
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateHeight)
  observer?.observe(bottomStack)

  return () => {
    observer?.disconnect()
    workspace.style.removeProperty(bottomStackHeightProperty)
  }
}

export function useConversationBottomStackHeight(): RefCallback<HTMLDivElement> {
  const stopObservingRef = useRef<() => void>(() => undefined)

  useEffect(
    () => () => {
      stopObservingRef.current()
    },
    []
  )

  return useCallback((bottomStack) => {
    stopObservingRef.current()
    stopObservingRef.current = bottomStack
      ? observeConversationBottomStackHeight(bottomStack)
      : () => undefined
  }, [])
}
