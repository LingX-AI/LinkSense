const legacyKnowledgeAssetPrefixPattern = /\bkb-asset:\$ABSOLUTE\/?/giu
const legacyHttpPrefixPattern = /\b(https?):\$ABSOLUTE\/?/giu
const legacyBareClosingTagPattern =
  /(^|[\r\n])([\t ]*)\$ABSOLUTE\/([A-Za-z][A-Za-z0-9:-]*)>/gu
const proposedPlanOpeningMarkerPattern = /^[\t ]*<proposed_plan>[\t ]*$/u
const proposedPlanClosingMarkerPattern = /^[\t ]*<\/proposed_plan>[\t ]*$/u
const markdownFencePattern = /^(?: {0,3})(`{3,}|~{3,})(.*)$/u

export type AssistantProposedPlanBlock = Readonly<{
  before: string
  plan: string
  after: string
}>

export type AssistantProposedPlanSourceSegments = Readonly<{
  before: AssistantMessageSourceSegment
  plan: AssistantMessageSourceSegment
  after: AssistantMessageSourceSegment
}>

type AssistantMessageSourceSegment = Readonly<{
  content: string
  offsetUtf16: number
}>

type MarkdownLine = Readonly<{
  content: string
  start: number
  end: number
}>

type MarkdownFence = Readonly<{
  marker: "`" | "~"
  length: number
}>

function getMarkdownLines(content: string): MarkdownLine[] {
  const lines: MarkdownLine[] = []

  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)) {
    const value = match[0]
    if (!value) continue
    const start = match.index
    const lineBreakLength = value.endsWith("\r\n")
      ? 2
      : value.endsWith("\r") || value.endsWith("\n")
        ? 1
        : 0
    lines.push({
      content: value.slice(0, value.length - lineBreakLength),
      start,
      end: start + value.length,
    })
  }

  return lines
}

function getOpeningMarkdownFence(line: string): MarkdownFence | null {
  const match = markdownFencePattern.exec(line)
  if (!match) return null
  const markerRun = match[1]!
  const marker = markerRun[0] as MarkdownFence["marker"]
  if (marker === "`" && match[2]?.includes("`")) return null
  return { marker, length: markerRun.length }
}

function closesMarkdownFence(line: string, fence: MarkdownFence): boolean {
  const match = markdownFencePattern.exec(line)
  if (!match || match[2]?.trim()) return false
  const markerRun = match[1]!
  return markerRun[0] === fence.marker && markerRun.length >= fence.length
}

/**
 * Extracts one complete proposed-plan block emitted inside a regular assistant
 * message. Markers must occupy their own lines and must not be inside a fenced
 * code block. Ambiguous, nested, repeated, or unclosed marker pairs are left as
 * ordinary assistant Markdown.
 */
export function parseAssistantProposedPlanBlock(
  content: string
): AssistantProposedPlanBlock | null {
  const segments = parseAssistantProposedPlanSourceSegments(content)
  if (!segments) return null

  return {
    before: segments.before.content,
    plan: segments.plan.content,
    after: segments.after.content,
  }
}

/**
 * Returns the visible plan segments together with their original UTF-16 start
 * offsets. Citation anchors remain relative to the persisted full message, so
 * renderers use these offsets to filter and position citations per segment.
 */
export function parseAssistantProposedPlanSourceSegments(
  content: string
): AssistantProposedPlanSourceSegments | null {
  let fence: MarkdownFence | null = null
  let openingLine: MarkdownLine | null = null
  let closingLine: MarkdownLine | null = null

  for (const line of getMarkdownLines(content)) {
    if (fence) {
      if (closesMarkdownFence(line.content, fence)) fence = null
      continue
    }

    const openingFence = getOpeningMarkdownFence(line.content)
    if (openingFence) {
      fence = openingFence
      continue
    }

    if (proposedPlanOpeningMarkerPattern.test(line.content)) {
      if (openingLine || closingLine) return null
      openingLine = line
      continue
    }

    if (proposedPlanClosingMarkerPattern.test(line.content)) {
      if (!openingLine || closingLine) return null
      closingLine = line
    }
  }

  if (!openingLine || !closingLine) return null

  return {
    before: {
      content: content.slice(0, openingLine.start),
      offsetUtf16: 0,
    },
    plan: {
      content: content.slice(openingLine.end, closingLine.start),
      offsetUtf16: openingLine.end,
    },
    after: {
      content: content.slice(closingLine.end),
      offsetUtf16: closingLine.end,
    },
  }
}

/**
 * Repairs path placeholders that older runner versions injected into assistant
 * message text. This compatibility layer is deliberately scoped to assistant
 * content; internal activity events keep their backend security redaction.
 */
export function normalizeAssistantMessageContent(content: string): string {
  if (!content.includes("$ABSOLUTE")) return content

  return content
    .replace(legacyKnowledgeAssetPrefixPattern, "kb-asset://")
    .replace(legacyHttpPrefixPattern, "$1://")
    .replace(legacyBareClosingTagPattern, "$1$2</$3>")
    .replaceAll("$ABSOLUTE", "")
    .replace(/\b(https?):\/{3,}/giu, "$1://")
}
