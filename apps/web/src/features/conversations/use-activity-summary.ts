import { useEffect, useRef, useState, type ReactNode } from "react"

const minimumSummaryDurationMs = 1_000

export type ActivitySummary = {
  key: string
  label: string
  detail?: string | null
  icon?: ReactNode
  running: boolean
  thinking?: boolean
}

/** Keep brief tool/thinking transitions out of the presentation only. */
export function useActivitySummary(
  summary: ActivitySummary,
  deferred: boolean
): ActivitySummary {
  const [displayed, setDisplayed] = useState(() => ({
    summary,
    deferred,
  }))
  const shownAt = useRef(0)

  // Terminal and blocking states must be visible in this render. Resuming
  // activity also starts a fresh display period, without reviving old timers.
  if (
    displayed.deferred !== deferred ||
    (!deferred && displayed.summary.key !== summary.key) ||
    (displayed.summary.key === summary.key &&
      (displayed.summary.label !== summary.label ||
        displayed.summary.detail !== summary.detail ||
        displayed.summary.running !== summary.running ||
        displayed.summary.thinking !== summary.thinking))
  ) {
    setDisplayed({ summary, deferred })
  }

  useEffect(() => {
    shownAt.current = Date.now()
  }, [displayed.summary.key, displayed.deferred])

  useEffect(() => {
    if (!deferred || displayed.summary.key === summary.key) return
    const remaining = Math.max(
      0,
      minimumSummaryDurationMs - (Date.now() - shownAt.current)
    )
    const timer = window.setTimeout(() => {
      setDisplayed({ summary, deferred })
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [deferred, displayed.summary.key, summary])

  return !deferred || displayed.summary.key === summary.key
    ? summary
    : displayed.summary
}
