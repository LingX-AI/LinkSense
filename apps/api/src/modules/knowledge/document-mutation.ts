import { AppError } from "../../lib/errors.js"
import {
  KnowledgeProcessingError,
  isKnowledgeProcessingError,
} from "../knowledge-processing/errors.js"
import type { KnowledgeProcessingScheduler } from "./types.js"

export async function runKnowledgeDocumentExclusiveMutation<T>(input: {
  scheduler: KnowledgeProcessingScheduler
  documentIds: readonly string[]
  operation: (
    signal: AbortSignal,
    orderedDocumentIds: readonly string[],
  ) => Promise<T>
}): Promise<T> {
  const orderedDocumentIds = orderKnowledgeDocumentIds(input.documentIds)

  try {
    return await acquireDocumentLocks(
      input.scheduler,
      orderedDocumentIds,
      0,
      [],
      input.operation,
    )
  } catch (error) {
    if (isKnowledgeProcessingError(error)) {
      if (error.code === "KNOWLEDGE_DOCUMENT_BUSY") {
        throw new AppError("KNOWLEDGE_DOCUMENT_BUSY")
      }
      if (error.code === "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE") {
        throw new AppError("KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE")
      }
    }
    throw error
  }
}

export function orderKnowledgeDocumentIds(
  documentIds: readonly string[],
): string[] {
  return [...new Set(documentIds)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
}

export function haveSameKnowledgeDocumentIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const orderedLeft = orderKnowledgeDocumentIds(left)
  const orderedRight = orderKnowledgeDocumentIds(right)
  return (
    orderedLeft.length === orderedRight.length &&
    orderedLeft.every((documentId, index) => documentId === orderedRight[index])
  )
}

async function acquireDocumentLocks<T>(
  scheduler: KnowledgeProcessingScheduler,
  orderedDocumentIds: readonly string[],
  index: number,
  acquiredSignals: readonly AbortSignal[],
  operation: (
    signal: AbortSignal,
    orderedDocumentIds: readonly string[],
  ) => Promise<T>,
): Promise<T> {
  const documentId = orderedDocumentIds[index]
  if (documentId === undefined) {
    const signal =
      acquiredSignals.length === 0
        ? new AbortController().signal
        : acquiredSignals.length === 1
          ? acquiredSignals[0]!
          : AbortSignal.any([...acquiredSignals])
    if (signal.aborted) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
        retryable: true,
      })
    }
    return operation(signal, orderedDocumentIds)
  }

  return scheduler.runDocumentExclusiveMutation(documentId, (signal) =>
    acquireDocumentLocks(
      scheduler,
      orderedDocumentIds,
      index + 1,
      [...acquiredSignals, signal],
      operation,
    ),
  )
}
