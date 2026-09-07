import { createHash, randomUUID } from "node:crypto"

import { Redis } from "ioredis"
import { z } from "zod"

import type { PrismaClient } from "../../generated/prisma/client.js"
import type {
  ElasticsearchKnowledgeAdapter,
} from "./elasticsearch.js"
import { KnowledgeProcessingError } from "./errors.js"
import type { KnowledgeDocumentLock } from "./pipeline.js"

export const KNOWLEDGE_INDEX_RECONCILIATION_INTERVAL_MS = 60_000
export const KNOWLEDGE_INDEX_RECONCILIATION_PAGE_SIZE = 100
export const KNOWLEDGE_INDEX_RECONCILIATION_MAX_DOCUMENTS_PER_RUN = 500

export type ActiveKnowledgeDocumentVersion = {
  knowledgeBaseId: string
  documentId: string
  documentVersionId: string
  expectedParentCount: number
  expectedChildCount: number
  expectedEmbeddingProfileHash: string
  expectedIndexIntegrityDigest: string
}

export interface KnowledgeIndexReconciliationSource {
  listDocumentIds(input: {
    afterDocumentId: string | null
    limit: number
  }): Promise<{
    documentIds: string[]
    exhausted: boolean
  }>
  resolveActiveVersion(
    documentId: string,
  ): Promise<ActiveKnowledgeDocumentVersion | null>
}

export class PrismaKnowledgeIndexReconciliationSource
  implements KnowledgeIndexReconciliationSource
{
  constructor(private readonly prisma: PrismaClient) {}

  async listDocumentIds(input: {
    afterDocumentId: string | null
    limit: number
  }): Promise<{ documentIds: string[]; exhausted: boolean }> {
    const documents = await this.prisma.knowledgeBaseDocument.findMany({
      where: {
        status: "ready",
        currentVersionId: { not: null },
        activeProcessingVersionId: null,
        ...(input.afterDocumentId === null
          ? {}
          : { id: { gt: input.afterDocumentId } }),
      },
      orderBy: { id: "asc" },
      take: input.limit,
      select: { id: true },
    })
    return {
      documentIds: documents.map((document) => document.id),
      exhausted: documents.length < input.limit,
    }
  }

  async resolveActiveVersion(
    documentId: string,
  ): Promise<ActiveKnowledgeDocumentVersion | null> {
    const document = await this.prisma.knowledgeBaseDocument.findFirst({
      where: {
        id: documentId,
        status: "ready",
        currentVersionId: { not: null },
        activeProcessingVersionId: null,
      },
      select: {
        id: true,
        knowledgeBaseId: true,
        currentVersionId: true,
      },
    })
    if (document === null || document.currentVersionId === null) return null
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: document.currentVersionId,
        documentId: document.id,
        knowledgeBaseId: document.knowledgeBaseId,
        versionStatus: "ready",
        indexReady: true,
      },
      select: {
        id: true,
        parentCount: true,
        childCount: true,
        embeddingProfileHash: true,
        indexIntegrityDigest: true,
      },
    })
    if (
      !version ||
      version.parentCount === null ||
      version.parentCount <= 0 ||
      version.childCount === null ||
      version.childCount <= 0 ||
      !/^[a-f0-9]{64}$/u.test(version.embeddingProfileHash ?? "") ||
      !/^[a-f0-9]{64}$/u.test(version.indexIntegrityDigest ?? "")
    ) {
      return null
    }
    return {
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.id,
      documentVersionId: version.id,
      expectedParentCount: version.parentCount,
      expectedChildCount: version.childCount,
      expectedEmbeddingProfileHash: version.embeddingProfileHash!,
      expectedIndexIntegrityDigest: version.indexIntegrityDigest!,
    }
  }
}

type ExclusiveResult<T> =
  | { acquired: false }
  | { acquired: true; value: T }

export interface KnowledgeIndexReconciliationCoordinator {
  tryRunExclusive<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<ExclusiveResult<T>>
  getCursor(): Promise<string | null>
  setCursor(documentId: string | null): Promise<void>
  close(): Promise<void>
}

const renewLeaseScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`

const releaseLeaseScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`

export class RedisKnowledgeIndexReconciliationCoordinator
  implements KnowledgeIndexReconciliationCoordinator
{
  private readonly redis: Redis
  private readonly lockKey: string
  private readonly cursorKey: string

  constructor(
    redisUrl: string,
    indexName: string,
    private readonly options: {
      leaseMs?: number
      renewalMs?: number
    } = {},
    redis?: Redis,
  ) {
    this.redis = redis ?? new Redis(redisUrl, { maxRetriesPerRequest: null })
    const namespace = createHash("sha256")
      .update(indexName)
      .digest("hex")
      .slice(0, 16)
    this.lockKey = `linksense:knowledge:index-reconcile:${namespace}:lock`
    this.cursorKey = `linksense:knowledge:index-reconcile:${namespace}:cursor`
  }

  async tryRunExclusive<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<ExclusiveResult<T>> {
    const leaseMs = this.options.leaseMs ?? 60_000
    const renewalMs = this.options.renewalMs ?? 20_000
    if (
      !Number.isSafeInteger(leaseMs) ||
      !Number.isSafeInteger(renewalMs) ||
      leaseMs <= 0 ||
      renewalMs <= 0 ||
      renewalMs * 2 >= leaseMs
    ) {
      throw new Error("invalid knowledge index reconciliation lease")
    }
    const token = randomUUID()
    let acquired: "OK" | null
    try {
      acquired = await this.redis.set(
        this.lockKey,
        token,
        "PX",
        leaseMs,
        "NX",
      )
    } catch (error) {
      throw unavailable(error)
    }
    if (acquired !== "OK") return { acquired: false }

    const renewalController = new AbortController()
    const lockLostController = new AbortController()
    const renewal = this.renewLease({
      token,
      leaseMs,
      renewalMs,
      stopSignal: renewalController.signal,
      lockLostController,
    })
    try {
      const value = await operation(lockLostController.signal)
      if (lockLostController.signal.aborted) throw unavailable()
      return { acquired: true, value }
    } finally {
      renewalController.abort()
      await renewal
      await this.redis
        .eval(releaseLeaseScript, 1, this.lockKey, token)
        .catch(() => undefined)
    }
  }

  async getCursor(): Promise<string | null> {
    let value: string | null
    try {
      value = await this.redis.get(this.cursorKey)
    } catch (error) {
      throw unavailable(error)
    }
    if (value === null) return null
    if (z.string().uuid().safeParse(value).success) return value
    await this.setCursor(null)
    return null
  }

  async setCursor(documentId: string | null): Promise<void> {
    try {
      if (documentId === null) {
        await this.redis.del(this.cursorKey)
        return
      }
      await this.redis.set(this.cursorKey, z.string().uuid().parse(documentId))
    } catch (error) {
      if (error instanceof z.ZodError) throw unavailable(error, false)
      throw unavailable(error)
    }
  }

  close(): Promise<void> {
    return this.redis.quit().then(() => undefined)
  }

  private async renewLease(input: {
    token: string
    leaseMs: number
    renewalMs: number
    stopSignal: AbortSignal
    lockLostController: AbortController
  }): Promise<void> {
    for (;;) {
      try {
        await abortableDelay(input.renewalMs, input.stopSignal)
      } catch {
        return
      }
      try {
        const renewed = await this.redis.eval(
          renewLeaseScript,
          1,
          this.lockKey,
          input.token,
          String(input.leaseMs),
        )
        if (Number(renewed) !== 1) {
          input.lockLostController.abort()
          return
        }
      } catch {
        input.lockLostController.abort()
        return
      }
    }
  }
}

export type KnowledgeIndexReconciliationResult = {
  acquired: boolean
  scanned: number
  reconciled: number
  failed: number
}

export class KnowledgeIndexActivationReconciler {
  private interval: ReturnType<typeof setInterval> | undefined
  private activeRun: Promise<KnowledgeIndexReconciliationResult> | null = null
  private started = false
  private closed = false
  private readonly intervalMs: number
  private readonly pageSize: number
  private readonly maximumDocumentsPerRun: number

  constructor(
    private readonly dependencies: {
      source: KnowledgeIndexReconciliationSource
      coordinator: KnowledgeIndexReconciliationCoordinator
      documentLock: KnowledgeDocumentLock
      elasticsearch: Pick<
        ElasticsearchKnowledgeAdapter,
        "reconcileActiveDocumentVersion"
      >
      maintenanceGate?: { isBlocked(): Promise<boolean> }
    },
    options: {
      intervalMs?: number
      pageSize?: number
      maximumDocumentsPerRun?: number
    } = {},
  ) {
    this.intervalMs =
      options.intervalMs ?? KNOWLEDGE_INDEX_RECONCILIATION_INTERVAL_MS
    this.pageSize = options.pageSize ?? KNOWLEDGE_INDEX_RECONCILIATION_PAGE_SIZE
    this.maximumDocumentsPerRun =
      options.maximumDocumentsPerRun ??
      KNOWLEDGE_INDEX_RECONCILIATION_MAX_DOCUMENTS_PER_RUN
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      !Number.isSafeInteger(this.pageSize) ||
      !Number.isSafeInteger(this.maximumDocumentsPerRun) ||
      this.intervalMs <= 0 ||
      this.pageSize <= 0 ||
      this.maximumDocumentsPerRun <= 0 ||
      this.pageSize > this.maximumDocumentsPerRun
    ) {
      throw new Error("invalid knowledge index reconciliation options")
    }
  }

  async start(): Promise<void> {
    if (this.started || this.closed) return
    this.started = true
    this.interval = setInterval(() => {
      void this.runSafely()
    }, this.intervalMs)
    this.interval.unref()
    // Historical index repair can wait on document locks and external search.
    // Track it for shutdown and coalesce ticks, without delaying API readiness.
    void this.runSafely()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.interval !== undefined) clearInterval(this.interval)
    await this.activeRun
    await this.dependencies.coordinator.close()
  }

  async runOnce(): Promise<KnowledgeIndexReconciliationResult> {
    if (await this.dependencies.maintenanceGate?.isBlocked()) {
      return emptyReconciliationResult()
    }
    const result = await this.dependencies.coordinator.tryRunExclusive(
      async (signal) => {
        let cursor = await this.dependencies.coordinator.getCursor()
        let scanned = 0
        let reconciled = 0
        let failed = 0
        while (scanned < this.maximumDocumentsPerRun) {
          if (signal.aborted) throw unavailable()
          if (await this.dependencies.maintenanceGate?.isBlocked()) {
            return { acquired: true, scanned, reconciled, failed }
          }
          const remaining = this.maximumDocumentsPerRun - scanned
          const page = await this.dependencies.source.listDocumentIds({
            afterDocumentId: cursor,
            limit: Math.min(this.pageSize, remaining),
          })
          if (page.documentIds.length === 0) {
            await this.dependencies.coordinator.setCursor(null)
            break
          }
          for (const documentId of page.documentIds) {
            if (signal.aborted) throw unavailable()
            if (await this.dependencies.maintenanceGate?.isBlocked()) {
              return { acquired: true, scanned, reconciled, failed }
            }
            scanned += 1
            try {
              await this.dependencies.documentLock.runExclusive(
                documentId,
                async (documentSignal) => {
                  if (documentSignal.aborted) throw unavailable()
                  if (await this.dependencies.maintenanceGate?.isBlocked()) return
                  const active =
                    await this.dependencies.source.resolveActiveVersion(
                      documentId,
                    )
                  if (active === null) return
                  if (await this.dependencies.maintenanceGate?.isBlocked()) return
                  await this.dependencies.elasticsearch.reconcileActiveDocumentVersion(
                    {
                      knowledgeBaseId: active.knowledgeBaseId,
                      documentId: active.documentId,
                      activeDocumentVersionId: active.documentVersionId,
                      expectedParentCount: active.expectedParentCount,
                      expectedChildCount: active.expectedChildCount,
                      expectedEmbeddingProfileHash:
                        active.expectedEmbeddingProfileHash,
                      expectedIndexIntegrityDigest:
                        active.expectedIndexIntegrityDigest,
                    },
                  )
                  reconciled += 1
                },
                signal,
              )
            } catch {
              failed += 1
            }
          }
          cursor = page.documentIds.at(-1)!
          if (page.exhausted) {
            await this.dependencies.coordinator.setCursor(null)
            break
          }
          await this.dependencies.coordinator.setCursor(cursor)
        }
        return { acquired: true, scanned, reconciled, failed }
      },
    )
    return result.acquired
      ? result.value
      : emptyReconciliationResult()
  }

  private async runSafely(): Promise<KnowledgeIndexReconciliationResult> {
    if (this.activeRun !== null) return this.activeRun
    const run = this.runOnce().catch(() => ({
      acquired: false,
      scanned: 0,
      reconciled: 0,
      failed: 0,
    }))
    this.activeRun = run
    try {
      return await run
    } finally {
      if (this.activeRun === run) this.activeRun = null
    }
  }
}

function emptyReconciliationResult(): KnowledgeIndexReconciliationResult {
  return { acquired: false, scanned: 0, reconciled: 0, failed: 0 }
}

function unavailable(
  cause?: unknown,
  retryable = true,
): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
    { cause, retryable },
  )
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds)
    timeout.unref()
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
