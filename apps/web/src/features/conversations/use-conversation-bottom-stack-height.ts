import { useCallback, useEffect, useRef, type RefCallback } from "react"

const bottomStackHeightProperty = "--conversation-bottom-stack-height"
const composerTopOffsetProperty = "--conversation-composer-top-offset"

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

    const composer = bottomStack.querySelector<HTMLElement>(".composer-shell")
    if (composer) {
      // The fade ends at the editor, independent of controls or attribution.
      const offset = Math.max(
        0,
        Math.ceil(
          workspace.getBoundingClientRect().bottom -
            composer.getBoundingClientRect().top
        )
      )
      workspace.style.setProperty(composerTopOffsetProperty, `${offset}px`)
    } else {
      workspace.style.removeProperty(composerTopOffsetProperty)
    }
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
    workspace.style.removeProperty(composerTopOffsetProperty)
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
