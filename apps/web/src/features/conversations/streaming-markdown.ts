/**
 * Hides only an unfinished trailing image token while assistant Markdown is
 * streaming. Complete Markdown is never rewritten, and code spans/fences are
 * ignored so examples remain visible.
 */
export function prepareStreamingAssistantMarkdown(content: string): string {
  const imageStart = findLastImageStartOutsideCode(content)
  if (imageStart === null) return content
  return hasCompleteInlineImage(content, imageStart)
    ? content
    : content.slice(0, imageStart)
}

type MarkdownReplacement = Readonly<{
  start: number
  end: number
  value: string
}>

/**
 * Repairs common assistant Markdown output and normalizes TeX delimiters that
 * remark-math does not parse natively. Every replacement preserves the source
 * length so structured citation offsets remain stable. Code spans/fences are
 * deliberately left untouched.
 */
export function normalizeAssistantMarkdown(content: string): string {
  let fence: { character: "`" | "~"; length: number } | null = null
  let inlineCodeLength = 0
  let inlineMathOpener: number | null = null
  let displayMathOpener: number | null = null
  const replacements: MarkdownReplacement[] = []
  let lineStart = true
  let index = 0

  while (index < content.length) {
    if (lineStart && inlineCodeLength === 0) {
      const markerStart = skipUpToThreeSpaces(content, index)
      const character = content[markerStart]
      if (character === "`" || character === "~") {
        const runLength = countRun(content, markerStart, character)
        if (runLength >= 3) {
          if (fence === null) {
            inlineMathOpener = null
            displayMathOpener = null
            fence = { character, length: runLength }
            index = skipLine(content, markerStart + runLength)
            lineStart = true
            continue
          }
          if (
            fence.character === character &&
            runLength >= fence.length &&
            onlySpacesUntilLineEnd(content, markerStart + runLength)
          ) {
            fence = null
            index = skipLine(content, markerStart + runLength)
            lineStart = true
            continue
          }
        }
      }
    }

    if (fence !== null) {
      index = skipLine(content, index)
      lineStart = true
      continue
    }

    const character = content[index]!
    if (character === "\n") {
      inlineMathOpener = null
      lineStart = true
      index += 1
      continue
    }
    lineStart = false

    if (character === "`" && !isEscaped(content, index)) {
      const runLength = countRun(content, index, "`")
      if (inlineCodeLength === 0) inlineCodeLength = runLength
      else if (inlineCodeLength === runLength) inlineCodeLength = 0
      index += runLength
      continue
    }

    if (
      inlineCodeLength === 0 &&
      character === "\\" &&
      !isEscaped(content, index)
    ) {
      const delimiter = content[index + 1]
      if (
        delimiter === "[" &&
        inlineMathOpener === null &&
        displayMathOpener === null
      ) {
        displayMathOpener = index
        index += 2
        continue
      }
      if (delimiter === "]" && displayMathOpener !== null) {
        replacements.push(
          { start: displayMathOpener, end: displayMathOpener + 2, value: "$$" },
          { start: index, end: index + 2, value: "$$" }
        )
        displayMathOpener = null
        index += 2
        continue
      }
      if (
        delimiter === "(" &&
        displayMathOpener === null &&
        inlineMathOpener === null
      ) {
        inlineMathOpener = index
        index += 2
        continue
      }
      if (delimiter === ")" && inlineMathOpener !== null) {
        replacements.push(
          { start: inlineMathOpener, end: inlineMathOpener + 2, value: "$ " },
          { start: index, end: index + 2, value: " $" }
        )
        inlineMathOpener = null
        index += 2
        continue
      }
    }

    if (
      inlineCodeLength === 0 &&
      character === "*" &&
      content[index + 1] === "*" &&
      content[index - 1] !== "*" &&
      content[index + 2] !== "*" &&
      !isEscaped(content, index)
    ) {
      const repair = findSpacedStrongDelimiters(content, index)
      if (repair) {
        replacements.push(...repair.replacements)
        index = repair.closingStart + 2
        continue
      }
    }

    index += 1
  }

  if (replacements.length === 0) return content
  replacements.sort((left, right) => left.start - right.start)

  let copiedUntil = 0
  let output = ""
  for (const replacement of replacements) {
    output += content.slice(copiedUntil, replacement.start)
    output += replacement.value
    copiedUntil = replacement.end
  }
  return output + content.slice(copiedUntil)
}

function findSpacedStrongDelimiters(
  content: string,
  openerStart: number
): {
  closingStart: number
  replacements: readonly MarkdownReplacement[]
} | null {
  const innerStart = openerStart + 2
  let contentStart = innerStart
  while (content[contentStart] === " " || content[contentStart] === "\t") {
    contentStart += 1
  }

  const firstInnerCharacter = content[contentStart]
  if (
    !firstInnerCharacter ||
    firstInnerCharacter === "*" ||
    /\s/u.test(firstInnerCharacter)
  ) {
    return null
  }

  for (let cursor = contentStart + 1; cursor < content.length; cursor += 1) {
    const character = content[cursor]
    if (character === "\n" || character === "\r" || character === "`") {
      return null
    }
    if (
      character !== "*" ||
      content[cursor + 1] !== "*" ||
      content[cursor - 1] === "*" ||
      content[cursor + 2] === "*" ||
      isEscaped(content, cursor)
    ) {
      continue
    }

    let closingWhitespaceStart = cursor
    while (
      closingWhitespaceStart > contentStart &&
      (content[closingWhitespaceStart - 1] === " " ||
        content[closingWhitespaceStart - 1] === "\t")
    ) {
      closingWhitespaceStart -= 1
    }

    const replacements: MarkdownReplacement[] = []
    if (contentStart > innerStart) {
      replacements.push({
        start: openerStart,
        end: contentStart,
        value: content.slice(innerStart, contentStart) + "**",
      })
    }
    if (closingWhitespaceStart < cursor) {
      replacements.push({
        start: closingWhitespaceStart,
        end: cursor + 2,
        value: "**" + content.slice(closingWhitespaceStart, cursor),
      })
    }

    return replacements.length > 0
      ? { closingStart: cursor, replacements }
      : null
  }

  return null
}

function findLastImageStartOutsideCode(content: string): number | null {
  let fence: { character: "`" | "~"; length: number } | null = null
  let inlineCodeLength = 0
  let lastImageStart: number | null = null
  let lineStart = true
  let index = 0

  while (index < content.length) {
    if (lineStart && inlineCodeLength === 0) {
      const markerStart = skipUpToThreeSpaces(content, index)
      const character = content[markerStart]
      if (character === "`" || character === "~") {
        const runLength = countRun(content, markerStart, character)
        if (runLength >= 3) {
          if (fence === null) {
            fence = { character, length: runLength }
            index = skipLine(content, markerStart + runLength)
            lineStart = true
            continue
          }
          if (
            fence.character === character &&
            runLength >= fence.length &&
            onlySpacesUntilLineEnd(content, markerStart + runLength)
          ) {
            fence = null
            index = skipLine(content, markerStart + runLength)
            lineStart = true
            continue
          }
        }
      }
    }

    if (fence !== null) {
      index = skipLine(content, index)
      lineStart = true
      continue
    }

    const character = content[index]!
    if (character === "\n") {
      lineStart = true
      index += 1
      continue
    }
    lineStart = false

    if (character === "`" && !isEscaped(content, index)) {
      const runLength = countRun(content, index, "`")
      if (inlineCodeLength === 0) inlineCodeLength = runLength
      else if (inlineCodeLength === runLength) inlineCodeLength = 0
      index += runLength
      continue
    }

    if (
      inlineCodeLength === 0 &&
      character === "!" &&
      content[index + 1] === "[" &&
      !isEscaped(content, index)
    ) {
      lastImageStart = index
    }
    index += 1
  }

  return lastImageStart
}

function hasCompleteInlineImage(content: string, imageStart: number): boolean {
  let bracketDepth = 1
  let index = imageStart + 2
  for (; index < content.length; index += 1) {
    if (isEscaped(content, index)) continue
    if (content[index] === "[") bracketDepth += 1
    if (content[index] !== "]") continue
    bracketDepth -= 1
    if (bracketDepth === 0) break
  }
  if (bracketDepth !== 0) return false

  index += 1
  if (index >= content.length) return false
  if (content[index] !== "(") return true

  let parenthesisDepth = 1
  for (index += 1; index < content.length; index += 1) {
    if (isEscaped(content, index)) continue
    if (content[index] === "(") parenthesisDepth += 1
    if (content[index] !== ")") continue
    parenthesisDepth -= 1
    if (parenthesisDepth === 0) return true
  }
  return false
}

function skipUpToThreeSpaces(content: string, index: number): number {
  let cursor = index
  while (cursor < index + 3 && content[cursor] === " ") cursor += 1
  return cursor
}

function countRun(content: string, index: number, character: string): number {
  let cursor = index
  while (content[cursor] === character) cursor += 1
  return cursor - index
}

function skipLine(content: string, index: number): number {
  const newline = content.indexOf("\n", index)
  return newline < 0 ? content.length : newline + 1
}

function onlySpacesUntilLineEnd(content: string, index: number): boolean {
  for (let cursor = index; cursor < content.length; cursor += 1) {
    const character = content[cursor]
    if (character === "\n") return true
    if (character !== " " && character !== "\t") return false
  }
  return true
}

function isEscaped(content: string, index: number): boolean {
  let slashCount = 0
  for (
    let cursor = index - 1;
    cursor >= 0 && content[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}
