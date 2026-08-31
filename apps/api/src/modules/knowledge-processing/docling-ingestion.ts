import type { ExtractedDoclingArchive } from "./docling.js"
import { readExtractedDoclingArchive } from "./docling.js"
import { assertDoclingDocumentContract } from "./docling-document-contract.js"
import {
  processDoclingAssets,
  type SafeKnowledgeAsset,
} from "./asset-processor.js"
import { KnowledgeProcessingError } from "./errors.js"

export type IngestedDoclingArchive = {
  officialMarkdown: string
  safeMarkdown: string
  markdownBytes: Buffer
  doclingJson: Record<string, unknown>
  doclingJsonBytes: Buffer
  assets: SafeKnowledgeAsset[]
  archivePath: string
}

export async function ingestDoclingArchive(input: {
  extracted: ExtractedDoclingArchive
  originalSha256: string
}): Promise<IngestedDoclingArchive> {
  const result = await readExtractedDoclingArchive(input.extracted)
  assertDoclingDocumentContract(result.json)
  const processed = await processDoclingAssets({
    doclingJson: result.json,
    assetPaths: result.assetPaths,
    originalSha256: input.originalSha256,
  })
  const safeMarkdown = createSafeDoclingMarkdown({
    markdown: result.markdown,
    assets: processed.assets,
  })
  return {
    officialMarkdown: result.markdown,
    safeMarkdown,
    markdownBytes: result.markdownBytes,
    doclingJson: processed.doclingJson,
    doclingJsonBytes: processed.doclingJsonBytes,
    assets: processed.assets,
    archivePath: result.archivePath,
  }
}

/**
 * Creates the display projection without parsing, serializing, sorting,
 * deduplicating, or otherwise reconstructing the official Markdown. Source URI
 * schemes are intentionally preserved as document content; every renderer must
 * still apply its own executable-protocol policy.
 */
export function createSafeDoclingMarkdown(input: {
  markdown: string
  assets: readonly SafeKnowledgeAsset[]
}): string {
  const replacements = input.assets
    .flatMap((asset) => [
      {
        source: `./${asset.sourceUri}`,
        target: `kb-asset://${asset.assetReferenceId}`,
      },
      {
        source: asset.sourceUri,
        target: `kb-asset://${asset.assetReferenceId}`,
      },
    ])
    .sort((left, right) => right.source.length - left.source.length)

  let unsafeReference = false
  const safeMarkdown = transformOutsideCode(input.markdown, (segment) => {
    let output = segment
    for (const replacement of replacements) {
      output = output.replaceAll(replacement.source, replacement.target)
    }
    if (/(?:^|[("' ])(?:\.\/)?artifacts\//u.test(output)) {
      unsafeReference = true
    }
    // Docling escapes source HTML. Neutralize any raw tag-like construct that
    // still appears outside code while retaining its exact location and text.
    return output.replace(/<(?=[A-Za-z!/?])/gu, "&lt;")
  })
  if (unsafeReference) {
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_UNSAFE")
  }
  return safeMarkdown
}

function transformOutsideCode(
  markdown: string,
  transform: (segment: string) => string,
): string {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/gu) ?? []
  let fence: { character: "`" | "~"; length: number } | null = null
  return lines
    .map((line) => {
      if (fence) {
        const closing = new RegExp(
          `^ {0,3}${fence.character}{${fence.length},}[\\t ]*(?:\\r?\\n)?$`,
          "u",
        )
        if (closing.test(line)) fence = null
        return line
      }

      const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
      if (opening) {
        const marker = opening[1]!
        fence = {
          character: marker[0] as "`" | "~",
          length: marker.length,
        }
        return line
      }
      return transformOutsideInlineCode(line, transform)
    })
    .join("")
}

function transformOutsideInlineCode(
  value: string,
  transform: (segment: string) => string,
): string {
  let cursor = 0
  let output = ""
  while (cursor < value.length) {
    const opening = /`+/u.exec(value.slice(cursor))
    if (!opening || opening.index === undefined) {
      output += transform(value.slice(cursor))
      break
    }
    const openingStart = cursor + opening.index
    const openingEnd = openingStart + opening[0].length
    const closingStart = value.indexOf(opening[0], openingEnd)
    if (closingStart < 0) {
      output += transform(value.slice(cursor))
      break
    }
    output += transform(value.slice(cursor, openingStart))
    output += value.slice(openingStart, closingStart + opening[0].length)
    cursor = closingStart + opening[0].length
  }
  return output
}
