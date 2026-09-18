import type { PublicKnowledgeCitation } from "@linksense/shared"

type MarkdownNode = {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
  data?: {
    hName: string
    hProperties: Record<string, string>
  }
  position?: {
    start: { line: number; column: number; offset?: number }
    end: { line: number; column: number; offset?: number }
  }
}

type MarkdownParent = MarkdownNode & { children: MarkdownNode[] }

export const knowledgeCitationFragmentPrefix = "#linksense-citation-"

export function getKnowledgeCitationPreviewPath(
  citation: PublicKnowledgeCitation
): string {
  return `/knowledge-citations/${encodeURIComponent(citation.citation_id)}`
}

export function getKnowledgeCitationNumberFromFragment(
  href: string | undefined
): number | null {
  if (!href?.startsWith(knowledgeCitationFragmentPrefix)) return null
  const value = href.slice(knowledgeCitationFragmentPrefix.length)
  return /^\d+$/u.test(value) ? Number(value) : null
}

export function remarkKnowledgeCitations(options: {
  citations: readonly PublicKnowledgeCitation[]
  sourceContent?: string
  sourceOffsetBaseUtf16?: number
  offsetBaseUtf16?: number
  blockLengthUtf16?: number
  includeBlockStart?: boolean
}) {
  return (tree: MarkdownParent) => {
    const sourceOffsetBase = options.sourceOffsetBaseUtf16 ?? 0
    const offsetBase = options.offsetBaseUtf16 ?? 0
    const blockLength = options.blockLengthUtf16
    const blockEnd =
      blockLength === undefined ? undefined : offsetBase + blockLength
    const citationsByOffset = new Map<number, PublicKnowledgeCitation[]>()
    for (const citation of options.citations) {
      for (const anchor of citation.anchors) {
        const absoluteOffset =
          sourceOffsetBase +
          normalizeCitationOffsetForDisplay(
            options.sourceContent,
            anchor.after_offset_utf16 - sourceOffsetBase
          )
        if (
          blockEnd !== undefined &&
          (absoluteOffset < offsetBase ||
            absoluteOffset > blockEnd ||
            (absoluteOffset === offsetBase &&
              options.includeBlockStart === false))
        ) {
          continue
        }
        const offset = absoluteOffset - offsetBase
        const citations = citationsByOffset.get(offset) ?? []
        if (
          !citations.some((item) => item.citation_no === citation.citation_no)
        ) {
          citations.push(citation)
          citationsByOffset.set(offset, citations)
        }
      }
    }

    for (const [offset, citations] of [...citationsByOffset.entries()].sort(
      ([left], [right]) => right - left
    )) {
      insertCitationLinks(
        tree,
        offset,
        citations.sort((left, right) => left.citation_no - right.citation_no)
      )
    }
    groupImageCitations(tree)
  }
}

function groupImageCitations(node: MarkdownNode): void {
  const children = node.children
  if (!children) return
  for (const child of children) groupImageCitations(child)

  for (let index = 0; index < children.length; index += 1) {
    const image = children[index]
    if (image.type !== "image" && image.type !== "imageReference") continue
    let end = index + 1
    while (
      children[end]?.type === "link" &&
      getKnowledgeCitationNumberFromFragment(children[end]?.url) !== null
    ) {
      end += 1
    }
    if (end === index + 1) continue

    // Keep the block-level thumbnail and its citations in one inline box so
    // the badges cannot be pushed onto a separate line below the image.
    children.splice(index, end - index, {
      type: "imageCitations",
      children: children.slice(index, end),
      data: {
        hName: "span",
        hProperties: {
          "data-image-citations": "",
          className:
            "inline-flex max-w-full items-end gap-1 align-bottom [&>.knowledge-citation-inline]:mb-1 [&>.knowledge-citation-inline]:shrink-0",
        },
      },
    })
  }
}

function normalizeCitationOffsetForDisplay(
  content: string | undefined,
  offset: number
) {
  if (!content) return offset
  if (offset < 0 || offset > content.length) return offset

  let normalizedOffset = offset
  while (
    normalizedOffset > 0 &&
    /\s/u.test(content.charAt(normalizedOffset - 1))
  ) {
    normalizedOffset -= 1
  }
  return normalizedOffset
}

function insertCitationLinks(
  parent: MarkdownParent,
  offset: number,
  citations: readonly PublicKnowledgeCitation[]
): boolean {
  for (let index = 0; index < parent.children.length; index += 1) {
    const child = parent.children[index]
    const start = child.position?.start.offset
    const end = child.position?.end.offset
    if (
      start === undefined ||
      end === undefined ||
      offset < start ||
      offset > end
    ) {
      continue
    }

    if ("children" in child && Array.isArray(child.children)) {
      if (insertCitationLinks(child as MarkdownParent, offset, citations))
        return true
    }

    const links = citations.map(createCitationLink)
    if (child.type === "text") {
      const text = child
      const textValue = text.value ?? ""
      const splitAt = Math.min(textValue.length, Math.max(0, offset - start))
      const replacement: MarkdownNode[] = []
      if (splitAt > 0) {
        replacement.push({
          ...text,
          value: textValue.slice(0, splitAt),
          position: text.position
            ? {
                start: text.position.start,
                end: { ...text.position.end, offset },
              }
            : undefined,
        })
      }
      replacement.push(...links)
      if (splitAt < textValue.length) {
        replacement.push({
          ...text,
          value: textValue.slice(splitAt),
          position: text.position
            ? {
                start: { ...text.position.start, offset },
                end: text.position.end,
              }
            : undefined,
        })
      }
      parent.children.splice(index, 1, ...replacement)
      return true
    }

    const insertionIndex = offset <= start ? index : index + 1
    parent.children.splice(insertionIndex, 0, ...links)
    return true
  }
  return false
}

function createCitationLink(citation: PublicKnowledgeCitation): MarkdownNode {
  return {
    type: "link",
    url: `${knowledgeCitationFragmentPrefix}${citation.citation_no}`,
    children: [{ type: "text", value: `[${citation.citation_no}]` }],
  }
}
