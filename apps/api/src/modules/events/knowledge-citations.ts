import type {
  KnowledgeCitationProjection as SharedKnowledgeCitationProjection,
} from "@linksense/shared"

const KNOWLEDGE_SOURCE_PREFIX = "[[kb-source:"
const KNOWLEDGE_SOURCE_SUFFIX = "]]"
const SOURCE_REF_PATTERN = /^[A-Za-z0-9_-]{16,200}$/u

export type TurnKnowledgeSource = {
  knowledgeBaseId: string
  documentId: string
  documentVersionId: string
  parentId: string
  titlePath: SharedKnowledgeCitationProjection["source"]["title_path"]
  matchedChildIds:
    SharedKnowledgeCitationProjection["source"]["matched_child_ids"]
  pageNumbers: SharedKnowledgeCitationProjection["source"]["page_numbers"]
}

export type ProjectedKnowledgeCitation = TurnKnowledgeSource & {
  citationNo: number
  anchors: Array<{
    occurrenceNo: number
    anchorAfterOffsetUtf16: number
  }>
}

export type KnowledgeCitationProjection = {
  contentText: string
  citations: ProjectedKnowledgeCitation[]
}

/**
 * Converts the private model/source marker protocol into user-safe message
 * text plus structured citations. JavaScript string offsets are UTF-16 code
 * unit offsets, which is also the offset convention persisted by LinkSense.
 */
export function projectKnowledgeCitations(
  contentText: string,
  turnSources: ReadonlyMap<string, TurnKnowledgeSource>,
): KnowledgeCitationProjection {
  const visibleParts: string[] = []
  const citations: ProjectedKnowledgeCitation[] = []
  const citationBySource = new Map<string, ProjectedKnowledgeCitation>()
  let visibleLengthUtf16 = 0
  let occurrenceNo = 0
  let cursor = 0

  const appendVisible = (value: string) => {
    const scrubbed = scrubKnownRawSourceRefs(value, turnSources.keys())
    visibleParts.push(scrubbed)
    visibleLengthUtf16 += scrubbed.length
  }

  while (cursor < contentText.length) {
    const markerStart = contentText.indexOf(KNOWLEDGE_SOURCE_PREFIX, cursor)
    if (markerStart < 0) {
      appendVisible(contentText.slice(cursor))
      break
    }

    appendVisible(contentText.slice(cursor, markerStart))
    const sourceStart = markerStart + KNOWLEDGE_SOURCE_PREFIX.length
    const markerEnd = contentText.indexOf(KNOWLEDGE_SOURCE_SUFFIX, sourceStart)

    if (markerEnd < 0) {
      // A partial marker can be emitted when generation terminates abruptly.
      // Remove only the remainder of that line so private handles never leak,
      // while preserving any following paragraphs.
      const newline = contentText.indexOf("\n", sourceStart)
      if (newline < 0) break
      appendVisible("\n")
      cursor = newline + 1
      continue
    }

    const sourceRef = contentText.slice(sourceStart, markerEnd)
    const source = SOURCE_REF_PATTERN.test(sourceRef)
      ? turnSources.get(sourceRef)
      : undefined
    if (source) {
      // Match the persisted citation identity. Repeated searches may match
      // different children of the same parent; they still cite one source.
      const sourceKey = [
        source.documentVersionId,
        source.parentId,
      ].join("\u0000")
      let citation = citationBySource.get(sourceKey)
      if (!citation) {
        citation = {
          ...source,
          citationNo: citations.length + 1,
          anchors: [],
        }
        citationBySource.set(sourceKey, citation)
        citations.push(citation)
      } else {
        citation.matchedChildIds = [...new Set([
          ...citation.matchedChildIds,
          ...source.matchedChildIds,
        ])]
        citation.pageNumbers = [...new Set([
          ...citation.pageNumbers,
          ...source.pageNumbers,
        ])].sort((left, right) => left - right)
      }

      const duplicateAtSameOffset = citation.anchors.some(
        (anchor) => anchor.anchorAfterOffsetUtf16 === visibleLengthUtf16,
      )
      if (!duplicateAtSameOffset) {
        occurrenceNo += 1
        citation.anchors.push({
          occurrenceNo,
          anchorAfterOffsetUtf16: visibleLengthUtf16,
        })
      }
    }

    // Known, unknown, cross-turn and malformed closed markers are all private
    // protocol data and are therefore removed from the persisted body.
    cursor = markerEnd + KNOWLEDGE_SOURCE_SUFFIX.length
  }

  return {
    contentText: visibleParts.join(""),
    citations,
  }
}

function scrubKnownRawSourceRefs(
  value: string,
  sourceRefs: Iterable<string>,
): string {
  let result = value
  for (const sourceRef of sourceRefs) {
    if (sourceRef.length < 16 || !result.includes(sourceRef)) continue
    result = result.split(sourceRef).join("")
  }
  return result
}
