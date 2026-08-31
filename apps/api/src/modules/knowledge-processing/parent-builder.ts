import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"

import { KnowledgeProcessingError } from "./errors.js"

export type HybridChunkForParenting = {
  chunkIndex: number
  text: string
  rawText: string
  numTokens: number
  headings: string[]
  captions: string[]
  docItems: string[]
  pageNumbers: number[]
  hardBoundaryKey?: string | null | undefined
}

export type BuiltKnowledgeChild = HybridChunkForParenting & {
  childId: string
  contentHash: string
}

export type BuiltKnowledgeParent = {
  parentId: string
  parentOrder: number
  titlePath: string[]
  pageNumbers: number[]
  parentText: string
  contentHash: string
  childIds: string[]
  childCount: number
  estimatedTokens: number
  children: BuiltKnowledgeChild[]
}

export type ParentBuilderOptions = {
  documentVersionId: string
  maximumTokens: number
}

/**
 * Builds deterministic retrieval parents from official Hybrid chunks.
 *
 * Hybrid's contextualized `text` remains a child-only embedding input. Parent
 * context is intentionally composed from one heading path followed by the
 * ordered `rawText` values, so Hybrid's repeated heading context is never
 * duplicated in the text sent to reranking or generation.
 */
export function buildKnowledgeParents(
  chunks: readonly HybridChunkForParenting[],
  options: ParentBuilderOptions,
): BuiltKnowledgeParent[] {
  validateBuilderOptions(options)
  const children = chunks.map((chunk, index) =>
    normalizeChild(chunk, index, options),
  )
  if (children.length === 0) {
    throw invalidParentingInput()
  }

  const groups: BuiltKnowledgeChild[][] = []
  let current: BuiltKnowledgeChild[] = []
  let currentTokens = 0
  for (const child of children) {
    const previous = current.at(-1)
    const boundaryChanged =
      previous !== undefined &&
      (!sameStrings(previous.headings, child.headings) ||
        !sameNumbers(previous.pageNumbers, child.pageNumbers) ||
        (previous.hardBoundaryKey ?? null) !==
          (child.hardBoundaryKey ?? null))
    const exceedsBudget =
      current.length > 0 &&
      currentTokens + child.numTokens > options.maximumTokens
    if (boundaryChanged || exceedsBudget) {
      groups.push(current)
      current = []
      currentTokens = 0
    }
    current.push(child)
    currentTokens += child.numTokens
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, parentOrder) =>
    createParent(group, parentOrder, options.documentVersionId),
  )
}

function normalizeChild(
  chunk: HybridChunkForParenting,
  index: number,
  options: ParentBuilderOptions,
): BuiltKnowledgeChild {
  if (
    !Number.isSafeInteger(chunk.chunkIndex) ||
    chunk.chunkIndex !== index ||
    chunk.text.trim() === "" ||
    chunk.rawText.trim() === "" ||
    !Number.isSafeInteger(chunk.numTokens) ||
    chunk.numTokens <= 0 ||
    chunk.numTokens > options.maximumTokens ||
    !validStringArray(chunk.headings) ||
    !validStringArray(chunk.captions) ||
    !validStringArray(chunk.docItems) ||
    (chunk.hardBoundaryKey !== undefined &&
      chunk.hardBoundaryKey !== null &&
      chunk.hardBoundaryKey.trim() === "")
  ) {
    throw invalidParentingInput()
  }
  const pageNumbers = [...new Set(chunk.pageNumbers)].sort(
    (left, right) => left - right,
  )
  if (
    pageNumbers.some(
      (page) => !Number.isSafeInteger(page) || page <= 0,
    )
  ) {
    throw invalidParentingInput()
  }
  const normalized = {
    ...chunk,
    text: chunk.text.trim(),
    rawText: chunk.rawText.trim(),
    headings: [...chunk.headings],
    captions: [...chunk.captions],
    docItems: [...chunk.docItems],
    pageNumbers,
    ...(chunk.hardBoundaryKey === undefined
      ? {}
      : { hardBoundaryKey: chunk.hardBoundaryKey }),
  }
  const contentHash = digest({
    chunkIndex: normalized.chunkIndex,
    text: normalized.text,
    rawText: normalized.rawText,
    numTokens: normalized.numTokens,
    headings: normalized.headings,
    captions: normalized.captions,
    docItems: normalized.docItems,
    pageNumbers: normalized.pageNumbers,
    hardBoundaryKey: normalized.hardBoundaryKey ?? null,
  })
  return {
    ...normalized,
    contentHash,
    childId: `${options.documentVersionId}:${normalized.chunkIndex}:${contentHash.slice(0, 24)}`,
  }
}

function createParent(
  children: BuiltKnowledgeChild[],
  parentOrder: number,
  documentVersionId: string,
): BuiltKnowledgeParent {
  const titlePath = [...children[0]!.headings]
  const pageNumbers = [
    ...new Set(children.flatMap((child) => child.pageNumbers)),
  ].sort((left, right) => left - right)
  const body = children.map((child) => child.rawText).join("\n\n")
  const heading = titlePath
    .map(
      (title, index) =>
        `${"#".repeat(Math.min(index + 1, 6))} ${title.trim()}`,
    )
    .join("\n")
  const parentText = heading === "" ? body : `${heading}\n\n${body}`
  const childIds = children.map((child) => child.childId)
  const estimatedTokens = children.reduce(
    (total, child) => total + child.numTokens,
    0,
  )
  const contentHash = digest({
    titlePath,
    pageNumbers,
    parentText,
    childIds,
    childHashes: children.map((child) => child.contentHash),
  })
  return {
    parentId: deterministicUuid(
      digest({
        documentVersionId,
        firstChildId: childIds[0],
        lastChildId: childIds.at(-1),
        contentHash,
      }),
    ),
    parentOrder,
    titlePath,
    pageNumbers,
    parentText,
    contentHash,
    childIds,
    childCount: children.length,
    estimatedTokens,
    children,
  }
}

function validateBuilderOptions(options: ParentBuilderOptions): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      options.documentVersionId,
    ) ||
    !Number.isSafeInteger(options.maximumTokens) ||
    options.maximumTokens <= 0
  ) {
    throw invalidParentingInput()
  }
}

function validStringArray(values: readonly string[]): boolean {
  return values.every(
    (value) => typeof value === "string" && value.trim() !== "",
  )
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function deterministicUuid(hash: string): string {
  const bytes = Buffer.from(hash.slice(0, 32), "hex")
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}

function invalidParentingInput(): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_DOCLING_RESULT_INVALID",
    { retryable: false },
  )
}
