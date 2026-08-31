const KNOWLEDGE_ASSET_REFERENCE_AT_START_PATTERN =
  /^!\[(?:\\.|[^\]\\\r\n])*\]\(\s*kb-asset:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*\)/iu;

/** Returns only asset ids used as actual internal Markdown image targets. */
export function collectKnowledgeAssetReferenceIds(markdown: string): string[] {
  const references = new Set<string>();
  let fence: { character: "`" | "~"; length: number } | null = null;
  let inlineCodeLength = 0;

  for (const rawLine of markdown.split("\n")) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(rawLine);
    if (fence !== null) {
      if (
        fenceMatch?.[1]?.[0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2]?.trim() === ""
      ) {
        fence = null;
      }
      continue;
    }
    if (inlineCodeLength === 0 && fenceMatch?.[1]) {
      fence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      continue;
    }

    for (let index = 0; index < rawLine.length;) {
      if (rawLine[index] === "`" && !isEscaped(rawLine, index)) {
        const runLength = countRun(rawLine, index, "`");
        if (inlineCodeLength === 0) inlineCodeLength = runLength;
        else if (inlineCodeLength === runLength) inlineCodeLength = 0;
        index += runLength;
        continue;
      }
      if (
        inlineCodeLength === 0 &&
        rawLine[index] === "!" &&
        rawLine[index + 1] === "[" &&
        !isEscaped(rawLine, index)
      ) {
        const match = KNOWLEDGE_ASSET_REFERENCE_AT_START_PATTERN.exec(
          rawLine.slice(index),
        );
        if (match?.[1]) {
          references.add(match[1].toLowerCase());
          index += match[0].length;
          continue;
        }
      }
      index += 1;
    }
  }

  return [...references];
}

function countRun(value: string, index: number, character: string): number {
  let cursor = index;
  while (value[cursor] === character) cursor += 1;
  return cursor - index;
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
