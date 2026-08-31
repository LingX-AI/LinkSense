import { AppError } from "../../lib/errors.js"
import { KnowledgeProcessingError } from "./errors.js"

const DEFAULT_HEALTH_CACHE_TTL_MS = 60_000

export type KnowledgeCapabilityStatus = "available" | "unavailable"

export type KnowledgeHealthComponent = {
  status: KnowledgeCapabilityStatus
  reason_code: string | null
  latency_ms: number
}

export type KnowledgeProcessingHealthSnapshot = {
  checked_at: string
  readiness: "ready" | "unready"
  minio: KnowledgeHealthComponent
  document_parsing: KnowledgeHealthComponent
  embedding_model: KnowledgeHealthComponent
  knowledge_search_and_indexing: KnowledgeHealthComponent
  rerank:
    | KnowledgeHealthComponent
    | {
        status: "not_configured"
        reason_code: null
        latency_ms: 0
      }
}

export interface KnowledgeHealthDependency {
  health(signal?: AbortSignal): Promise<void>
}

/** Minute-cached, coalesced probes; failures expose stable codes only. */
export class KnowledgeProcessingHealthProbe {
  private cached:
    | { expiresAt: number; snapshot: KnowledgeProcessingHealthSnapshot }
    | undefined
  private inFlight: Promise<KnowledgeProcessingHealthSnapshot> | undefined

  constructor(
    private readonly dependencies: {
      minio: KnowledgeHealthDependency
      docling: KnowledgeHealthDependency
      embedding:
        | KnowledgeHealthDependency
        | (() => Promise<KnowledgeHealthDependency>)
      elasticsearch: KnowledgeHealthDependency
      rerank:
        | KnowledgeHealthDependency
        | null
        | (() => Promise<KnowledgeHealthDependency | null>)
    },
    private readonly options: {
      cacheTtlMs?: number
      probeTimeoutMs?: number
      now?: () => number
    } = {},
  ) {}

  check(): Promise<KnowledgeProcessingHealthSnapshot> {
    const now = this.now()
    if (this.cached && this.cached.expiresAt > now) {
      return Promise.resolve(this.cached.snapshot)
    }
    if (this.inFlight) return this.inFlight
    const inFlight = this.runProbes().then((snapshot) => {
      this.cached = {
        expiresAt:
          this.now() +
          (this.options.cacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS),
        snapshot,
      }
      return snapshot
    })
    this.inFlight = inFlight
    return inFlight.finally(() => {
      if (this.inFlight === inFlight) this.inFlight = undefined
    })
  }

  invalidate(): void {
    this.cached = undefined
  }

  private async runProbes(): Promise<KnowledgeProcessingHealthSnapshot> {
    const rerankDependency =
      typeof this.dependencies.rerank === "function"
        ? await this.dependencies.rerank().catch(() => null)
        : this.dependencies.rerank
    const [minio, docling, embedding, elasticsearch, rerank] = await Promise.all([
      this.probe(this.dependencies.minio, "MINIO_UNAVAILABLE"),
      this.probe(this.dependencies.docling, "KNOWLEDGE_DOCLING_UNAVAILABLE"),
      this.probe(
        this.dependencies.embedding,
        "KNOWLEDGE_EMBEDDING_UNAVAILABLE",
      ),
      this.probe(
        this.dependencies.elasticsearch,
        "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE",
      ),
      rerankDependency
        ? this.probe(
            rerankDependency,
            "KNOWLEDGE_RERANK_UNAVAILABLE",
          )
        : Promise.resolve(null),
    ])
    const searchAndIndexing: KnowledgeHealthComponent =
      elasticsearch.status === "available"
        ? {
            status: "available",
            reason_code: null,
            latency_ms: elasticsearch.latency_ms,
          }
        : {
            status: "unavailable",
            reason_code:
              elasticsearch.reason_code ?? "KNOWLEDGE_SEARCH_UNAVAILABLE",
            latency_ms: elasticsearch.latency_ms,
          }

    return {
      checked_at: new Date(this.now()).toISOString(),
      readiness: minio.status === "available" ? "ready" : "unready",
      minio,
      document_parsing: docling,
      embedding_model: embedding,
      knowledge_search_and_indexing: searchAndIndexing,
      rerank:
        rerank ?? {
          status: "not_configured",
          reason_code: null,
          latency_ms: 0,
        },
    }
  }

  private async probe(
    dependency:
      | KnowledgeHealthDependency
      | (() => Promise<KnowledgeHealthDependency>),
    reasonCode: string,
  ): Promise<KnowledgeHealthComponent> {
    const startedAt = this.now()
    const controller = new AbortController()
    const timeoutMs = this.options.probeTimeoutMs ?? 5_000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref()
    try {
      await Promise.race([
        Promise.resolve(
          typeof dependency === "function" ? dependency() : dependency,
        ).then((resolved) => resolved.health(controller.signal)),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("knowledge health probe timed out")),
            { once: true },
          )
        }),
      ])
      return {
        status: "available",
        reason_code: null,
        latency_ms: Math.max(0, Math.round(this.now() - startedAt)),
      }
    } catch (error) {
      return {
        status: "unavailable",
        reason_code: stableHealthReasonCode(error, reasonCode),
        latency_ms: Math.max(0, Math.round(this.now() - startedAt)),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function stableHealthReasonCode(error: unknown, reasonCode: string): string {
  if (
    error instanceof AppError &&
    error.code === "KNOWLEDGE_MODEL_NOT_CONFIGURED"
  ) {
    return "KNOWLEDGE_MODEL_NOT_CONFIGURED"
  }
  if (
    error instanceof KnowledgeProcessingError &&
    (error.code === "EMBEDDING_DIMENSION_MISMATCH" ||
      (reasonCode === "KNOWLEDGE_DOCLING_UNAVAILABLE" &&
        (error.code === "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE" ||
          error.code === "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE")) ||
      (reasonCode === "KNOWLEDGE_ELASTICSEARCH_UNAVAILABLE" &&
        error.code === "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE"))
  ) {
    return error.code
  }
  return reasonCode
}
