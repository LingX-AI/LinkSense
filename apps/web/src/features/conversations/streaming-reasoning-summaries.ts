const MAX_REASONING_SUMMARY_CHARACTERS = 4_000
const MAX_REASONING_SUMMARY_PARTS = 64

export type StreamingReasoningSummary = {
  itemId: string
  turnId?: string | null
  summaryIndex: number
  text: string
  createdAt: string
  sequence: number
}

export type StreamingReasoningSummaries = Record<
  string,
  StreamingReasoningSummary
>

function summaryKey(
  turnId: string | null | undefined,
  itemId: string,
  summaryIndex: number
) {
  return `${turnId ?? "turn"}\u0000${itemId}\u0000${summaryIndex}`
}

export function appendStreamingReasoningSummaryDelta(
  current: StreamingReasoningSummaries,
  update: {
    itemId: string
    turnId?: string | null
    summaryIndex: number
    delta: string
    createdAt: string
    sequence: number
  }
): StreamingReasoningSummaries {
  const key = summaryKey(update.turnId, update.itemId, update.summaryIndex)
  const previous = current[key]
  if (previous && update.sequence <= previous.sequence) return current

  const combined = `${previous?.text ?? ""}${update.delta}`.replace(
    /\r\n?/gu,
    "\n"
  )
  const text =
    combined.length > MAX_REASONING_SUMMARY_CHARACTERS
      ? combined.slice(-MAX_REASONING_SUMMARY_CHARACTERS)
      : combined
  const next = {
    ...current,
    [key]: {
      itemId: update.itemId,
      turnId: update.turnId,
      summaryIndex: update.summaryIndex,
      text,
      createdAt: previous?.createdAt ?? update.createdAt,
      sequence: update.sequence,
    },
  }
  const entries = Object.entries(next)
  if (entries.length <= MAX_REASONING_SUMMARY_PARTS) return next
  return Object.fromEntries(
    entries
      .sort((left, right) => right[1].sequence - left[1].sequence)
      .slice(0, MAX_REASONING_SUMMARY_PARTS)
  )
}

export function removeStreamingReasoningSummaryItem(
  current: StreamingReasoningSummaries,
  update: { itemId: string; turnId?: string | null }
): StreamingReasoningSummaries {
  const entries = Object.entries(current).filter(
    ([, summary]) =>
      summary.itemId !== update.itemId || summary.turnId !== update.turnId
  )
  return entries.length === Object.keys(current).length
    ? current
    : Object.fromEntries(entries)
}

export function removeStreamingReasoningSummariesForTurn(
  current: StreamingReasoningSummaries,
  turnId: string | null | undefined
): StreamingReasoningSummaries {
  const entries = Object.entries(current).filter(
    ([, summary]) => summary.turnId !== turnId
  )
  return entries.length === Object.keys(current).length
    ? current
    : Object.fromEntries(entries)
}

export function selectLatestStreamingReasoningSummary(
  current: StreamingReasoningSummaries,
  turnId: string | null | undefined
): StreamingReasoningSummary | undefined {
  return Object.values(current)
    .filter(
      (summary) => summary.turnId === turnId && summary.text.trim().length > 0
    )
    .sort(
      (left, right) =>
        right.sequence - left.sequence || right.summaryIndex - left.summaryIndex
    )[0]
}
