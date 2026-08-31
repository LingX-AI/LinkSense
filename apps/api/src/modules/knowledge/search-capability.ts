import type { KnowledgeSearchCapability } from "@linksense/shared"

type KnowledgeSearchHealthSnapshot = {
  checked_at: string
  knowledge_search_and_indexing: {
    status: "available" | "unavailable"
    reason_code: string | null
  }
}

const DEFAULT_PUBLIC_CAPABILITY_CACHE_TTL_MS = 30_000

export function createNotInstalledKnowledgeSearchCapability(
  now: () => number = Date.now,
): KnowledgeSearchCapability {
  return {
    status: "not_installed",
    reason_code: "KNOWLEDGE_NOT_INSTALLED",
    checked_at: new Date(now()).toISOString(),
  }
}

/**
 * Maps the internal health snapshot to the deliberately small public contract.
 * External endpoints, credentials, model names, latency and raw failure details
 * must never cross this boundary.
 */
export function mapKnowledgeSearchCapability(
  health: KnowledgeSearchHealthSnapshot,
): KnowledgeSearchCapability {
  const search = health.knowledge_search_and_indexing
  if (search.status === "available" && search.reason_code === null) {
    return {
      status: "available",
      reason_code: null,
      checked_at: health.checked_at,
    }
  }
  return {
    status: "unavailable",
    reason_code:
      search.reason_code === "EMBEDDING_DIMENSION_MISMATCH"
        ? "EMBEDDING_DIMENSION_MISMATCH"
        : "KNOWLEDGE_SEARCH_UNAVAILABLE",
    checked_at: health.checked_at,
  }
}

/**
 * Adds a process-wide cache in front of the public capability endpoint. The
 * underlying health probe already coalesces concurrent calls; this longer cache
 * prevents ordinary page loads across many users from repeatedly invoking
 * external knowledge infrastructure checks.
 */
export class KnowledgeSearchCapabilityReader {
  private cached:
    { expiresAt: number; capability: KnowledgeSearchCapability } | undefined
  private inFlight: Promise<KnowledgeSearchCapability> | undefined

  constructor(
    private readonly checkHealth: () => Promise<KnowledgeSearchHealthSnapshot>,
    private readonly options: {
      cacheTtlMs?: number
      now?: () => number
    } = {},
  ) {}

  read(): Promise<KnowledgeSearchCapability> {
    const now = this.now()
    if (this.cached && this.cached.expiresAt > now) {
      return Promise.resolve(this.cached.capability)
    }
    if (this.inFlight) return this.inFlight

    const inFlight = this.checkHealth().then((health) => {
      const capability = mapKnowledgeSearchCapability(health)
      // Cache only a successful availability proof. An unavailable result is
      // deliberately returned to the current caller without extending the
      // outage for later callers after the dependency has recovered.
      if (capability.status === "available") {
        this.cached = {
          expiresAt:
            this.now() +
            (this.options.cacheTtlMs ?? DEFAULT_PUBLIC_CAPABILITY_CACHE_TTL_MS),
          capability,
        }
      }
      return capability
    })
    this.inFlight = inFlight
    return inFlight.finally(() => {
      if (this.inFlight === inFlight) this.inFlight = undefined
    })
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
