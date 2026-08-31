export type ConversationComposerInputSegment =
  | Readonly<{
      kind: "text"
      value: string
      start: number
      end: number
    }>
  | Readonly<{
      kind: "url"
      value: string
      start: number
      end: number
    }>

const URL_PREFIX_PATTERN = /https?:\/\/|www\./giu
const URL_CHARACTER_PATTERN = /^[A-Za-z0-9!$&'()*+,./:;=?@_~#%-]$/u
const URL_START_BOUNDARY_PATTERN = /[A-Za-z0-9_@]/u
const URL_TRAILING_PUNCTUATION_PATTERN = /[.,!?;:]$/u

function isUrlStartBoundary(value: string, start: number) {
  if (start === 0) return true
  return !URL_START_BOUNDARY_PATTERN.test(value[start - 1] ?? "")
}

function getUrlCandidateEnd(value: string, start: number) {
  let end = start
  while (end < value.length && URL_CHARACTER_PATTERN.test(value.charAt(end))) {
    end += 1
  }
  return end
}

function hasUnmatchedClosingCharacter(
  value: string,
  opening: string,
  closing: string
) {
  return (
    Array.from(value).filter((character) => character === closing).length >
    Array.from(value).filter((character) => character === opening).length
  )
}

function trimTrailingUrlPunctuation(value: string) {
  let trimmed = value

  while (trimmed) {
    const lastCharacter = trimmed.at(-1) ?? ""
    if (URL_TRAILING_PUNCTUATION_PATTERN.test(lastCharacter)) {
      trimmed = trimmed.slice(0, -1)
      continue
    }
    if (
      (lastCharacter === ")" &&
        hasUnmatchedClosingCharacter(trimmed, "(", ")")) ||
      (lastCharacter === "]" &&
        hasUnmatchedClosingCharacter(trimmed, "[", "]")) ||
      (lastCharacter === "}" && hasUnmatchedClosingCharacter(trimmed, "{", "}"))
    ) {
      trimmed = trimmed.slice(0, -1)
      continue
    }
    return trimmed
  }

  return trimmed
}

function isSupportedUrl(value: string) {
  const normalizedValue = value.startsWith("www.") ? `https://${value}` : value

  try {
    const parsed = new URL(normalizedValue)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }
    if (!parsed.hostname) return false

    return (
      !value.startsWith("www.") ||
      (parsed.hostname.includes(".") && !parsed.hostname.endsWith("."))
    )
  } catch {
    return false
  }
}

export function getConversationComposerInputSegments(
  value: string
): readonly ConversationComposerInputSegment[] {
  if (!value) return []

  const matches: Array<
    Extract<ConversationComposerInputSegment, { kind: "url" }>
  > = []
  const matcher = new RegExp(URL_PREFIX_PATTERN)
  let match: RegExpExecArray | null

  while ((match = matcher.exec(value)) !== null) {
    const start = match.index
    if (!isUrlStartBoundary(value, start)) continue

    const candidate = trimTrailingUrlPunctuation(
      value.slice(start, getUrlCandidateEnd(value, start))
    )
    if (!candidate || !isSupportedUrl(candidate)) continue

    const end = start + candidate.length
    matches.push({ kind: "url", value: candidate, start, end })
    matcher.lastIndex = end
  }

  if (!matches.length) {
    return [{ kind: "text", value, start: 0, end: value.length }]
  }

  const segments: ConversationComposerInputSegment[] = []
  let cursor = 0
  for (const match of matches) {
    if (cursor < match.start) {
      segments.push({
        kind: "text",
        value: value.slice(cursor, match.start),
        start: cursor,
        end: match.start,
      })
    }
    segments.push(match)
    cursor = match.end
  }
  if (cursor < value.length) {
    segments.push({
      kind: "text",
      value: value.slice(cursor),
      start: cursor,
      end: value.length,
    })
  }

  return segments
}
