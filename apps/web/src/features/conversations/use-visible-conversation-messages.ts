import { useEffect, useEffectEvent, type RefObject } from "react"

type VerticalRange = { top: number; bottom: number }
type ReadingRow = {
  messageIds: string[]
  top: number
  bottom: number
  loaded: boolean
  turnId?: string
}

export function getVisibleConversationRows(
  rows: ReadingRow[],
  viewport: VerticalRange
): ReadingRow[] {
  return viewport.bottom <= viewport.top
    ? []
    : rows.filter(
        (row) =>
          row.bottom > row.top &&
          row.bottom > viewport.top &&
          row.top < viewport.bottom
      )
}

/** Reads only mounted rows, after layout, including resize/streaming updates. */
export function useVisibleConversationMessages({
  hostRef,
  onVisibleMessageChange,
  onVisibleUnloadedTurnChange,
  loadTurn,
}: {
  hostRef: RefObject<HTMLDivElement | null>
  onVisibleMessageChange?: (ids: string[]) => void
  onVisibleUnloadedTurnChange?: (turnId: string | null) => void
  loadTurn?: (turnId: string) => Promise<void>
}): void {
  const report = useEffectEvent(
    (rows: ReadingRow[], viewport: VerticalRange) => {
      onVisibleMessageChange?.(
        rows.filter((row) => row.loaded).flatMap((row) => row.messageIds)
      )
      // Keep shared feedback in the most visible row rather than a clipped edge.
      let feedbackTurnId: string | null = null
      let feedbackHeight = 0
      for (const row of rows) {
        if (row.loaded || !row.turnId) continue
        const visibleHeight =
          Math.min(row.bottom, viewport.bottom) -
          Math.max(row.top, viewport.top)
        if (visibleHeight > feedbackHeight) {
          feedbackTurnId = row.turnId
          feedbackHeight = visibleHeight
        }
        void loadTurn?.(row.turnId)
      }
      onVisibleUnloadedTurnChange?.(feedbackTurnId)
    }
  )
  useEffect(() => {
    const host = hostRef.current
    const scroller = host?.closest<HTMLElement>(".conversation-scroll")
    if (!host || !scroller) return
    const workspace = scroller.closest(".conversation-workspace")
    let frame: number | null = null
    const update = () => {
      frame = null
      const viewport = scroller.getBoundingClientRect()
      const bottomStack = workspace
        ?.querySelector(".conversation-bottom-stack")
        ?.getBoundingClientRect()
      const header = workspace
        ?.querySelector(".conversation-top-bar")
        ?.getBoundingClientRect()
      const readable = {
        top: Math.max(viewport.top, header?.bottom ?? viewport.top),
        bottom: Math.min(
          viewport.bottom,
          bottomStack && bottomStack.height > 0
            ? bottomStack.top
            : viewport.bottom
        ),
      }
      const rows = [
        ...host.querySelectorAll<HTMLElement>("[data-conversation-row]"),
      ].map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          messageIds: (element.dataset.messageIds ?? "")
            .split(" ")
            .filter(Boolean),
          loaded: element.dataset.loaded !== "false",
          turnId: element.dataset.turnId,
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      report(getVisibleConversationRows(rows, readable), readable)
    }
    const schedule = () => {
      frame ??= requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const observeRows = () => {
      resize.disconnect()
      resize.observe(scroller)
      resize.observe(host)
      for (const element of host.querySelectorAll("[data-conversation-row]"))
        resize.observe(element)
      const bottomStack = workspace?.querySelector(".conversation-bottom-stack")
      if (bottomStack) resize.observe(bottomStack)
    }
    const mutation = new MutationObserver(() => {
      observeRows()
      schedule()
    })
    mutation.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-loaded", "data-message-ids", "style"],
    })
    scroller.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule)
    observeRows()
    schedule()
    return () => {
      scroller.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
      mutation.disconnect()
      resize.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [hostRef])
}
