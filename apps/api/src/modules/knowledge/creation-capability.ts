import type { KnowledgeBaseCreationCapability } from "@linksense/shared"

import { AppError } from "../../lib/errors.js"
import type { KnowledgeProcessingHealthSnapshot } from "../knowledge-processing/health.js"

export function createNotInstalledKnowledgeBaseCreationCapability(
  now: () => number = Date.now,
): KnowledgeBaseCreationCapability {
  return {
    status: "not_installed",
    checks: null,
    checked_at: new Date(now()).toISOString(),
  }
}

export function mapKnowledgeBaseCreationCapability(
  health: KnowledgeProcessingHealthSnapshot,
): KnowledgeBaseCreationCapability {
  const embeddingModel: "available" | "not_configured" | "unavailable" =
    health.embedding_model.status === "available"
      ? "available"
      : health.embedding_model.reason_code === "KNOWLEDGE_MODEL_NOT_CONFIGURED"
        ? "not_configured"
        : "unavailable"
  const checks = {
    object_storage: health.minio.status,
    document_parsing: health.document_parsing.status,
    embedding_model: embeddingModel,
    search_and_indexing: health.knowledge_search_and_indexing.status,
  }
  const ready = Object.values(checks).every(
    (status) => status === "available",
  )
  return ready
    ? {
        status: "ready",
        checks: {
          object_storage: "available",
          document_parsing: "available",
          embedding_model: "available",
          search_and_indexing: "available",
        },
        checked_at: health.checked_at,
      }
    : { status: "unready", checks, checked_at: health.checked_at }
}

export class KnowledgeBaseCreationCapabilityReader {
  constructor(
    private readonly health: {
      check(): Promise<KnowledgeProcessingHealthSnapshot>
      invalidate(): void
    },
  ) {}

  async read(refresh = false): Promise<KnowledgeBaseCreationCapability> {
    if (refresh) this.health.invalidate()
    return mapKnowledgeBaseCreationCapability(await this.health.check())
  }

  async assertReady(): Promise<void> {
    const capability = await this.read(true)
    if (capability.status !== "ready") {
      throw new AppError("KNOWLEDGE_BASE_CREATION_UNAVAILABLE")
    }
  }
}
