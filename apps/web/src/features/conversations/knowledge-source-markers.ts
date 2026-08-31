const KNOWLEDGE_SOURCE_MARKER_OPEN = "[[kb-source:"
const KNOWLEDGE_SOURCE_MARKER_CLOSE = "]]"

export type KnowledgeSourceMarkerFilterState = {
  insideMarker: boolean
  pendingPrefix: string
}

export type KnowledgeSourceMarkerFilterResult = {
  text: string
  state: KnowledgeSourceMarkerFilterState
}

const emptyState: KnowledgeSourceMarkerFilterState = {
  insideMarker: false,
  pendingPrefix: "",
}

function markerPrefixLengthAtEnd(value: string): number {
  const maximum = Math.min(
    value.length,
    KNOWLEDGE_SOURCE_MARKER_OPEN.length - 1
  )
  for (let length = maximum; length > 0; length -= 1) {
    if (value.endsWith(KNOWLEDGE_SOURCE_MARKER_OPEN.slice(0, length))) {
      return length
    }
  }
  return 0
}

/**
 * Removes opaque knowledge-source markers without retaining their source
 * reference. The small prefix/inside state safely spans arbitrary deltas.
 */
export function filterKnowledgeSourceMarkerDelta(
  delta: string,
  previous: KnowledgeSourceMarkerFilterState = emptyState
): KnowledgeSourceMarkerFilterResult {
  let remaining = `${previous.pendingPrefix}${delta}`
  let insideMarker = previous.insideMarker
  let text = ""

  while (remaining) {
    if (insideMarker) {
      const markerEnd = remaining.indexOf(KNOWLEDGE_SOURCE_MARKER_CLOSE)
      if (markerEnd < 0) {
        return {
          text,
          state: { insideMarker: true, pendingPrefix: "" },
        }
      }
      remaining = remaining.slice(
        markerEnd + KNOWLEDGE_SOURCE_MARKER_CLOSE.length
      )
      insideMarker = false
      continue
    }

    const markerStart = remaining.indexOf(KNOWLEDGE_SOURCE_MARKER_OPEN)
    if (markerStart >= 0) {
      text += remaining.slice(0, markerStart)
      remaining = remaining.slice(
        markerStart + KNOWLEDGE_SOURCE_MARKER_OPEN.length
      )
      insideMarker = true
      continue
    }

    const pendingPrefixLength = markerPrefixLengthAtEnd(remaining)
    const visibleEnd = remaining.length - pendingPrefixLength
    text += remaining.slice(0, visibleEnd)
    return {
      text,
      state: {
        insideMarker: false,
        pendingPrefix: remaining.slice(visibleEnd),
      },
    }
  }

  return {
    text,
    state: { insideMarker, pendingPrefix: "" },
  }
}

export function stripKnowledgeSourceMarkers(value: string): string {
  return filterKnowledgeSourceMarkerDelta(value).text
}
