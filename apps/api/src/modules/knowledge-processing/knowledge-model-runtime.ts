import type {
  KnowledgeModelConfigurationProbe,
  KnowledgeModelSettingsReader,
  ResolvedKnowledgeModelRuntime,
} from "../system/knowledge-model-settings.js";
import { EmbeddingClient } from "./embedding.js";
import { KnowledgeProcessingError } from "./errors.js";
import { RerankClient } from "./retrieval.js";

export type ResolvedKnowledgeModelClients = {
  embedding: EmbeddingClient;
  rerank: RerankClient | null;
};

export interface KnowledgeEmbeddingClientResolver {
  resolveEmbedding(expectedProfileHash?: string): Promise<EmbeddingClient>;
}

export interface KnowledgeRetrievalClientResolver {
  resolveClients(): Promise<ResolvedKnowledgeModelClients>;
}

export class LiveKnowledgeModelClientResolver
  implements KnowledgeEmbeddingClientResolver, KnowledgeRetrievalClientResolver
{
  private cached:
    | (ResolvedKnowledgeModelClients & { revision: number })
    | undefined;

  constructor(private readonly settings: KnowledgeModelSettingsReader) {}

  async resolveEmbedding(expectedProfileHash?: string): Promise<EmbeddingClient> {
    const clients = await this.resolveClients();
    if (
      expectedProfileHash !== undefined &&
      clients.embedding.profileHash !== expectedProfileHash
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EMBEDDING_CONFIGURATION_CHANGED",
      );
    }
    return clients.embedding;
  }

  async resolveClients(): Promise<ResolvedKnowledgeModelClients> {
    let runtime: ResolvedKnowledgeModelRuntime;
    try {
      runtime = await this.settings.resolveRuntime();
    } catch (error) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EMBEDDING_CONFIGURATION_CHANGED",
        { cause: error },
      );
    }
    if (this.cached?.revision === runtime.revision) return this.cached;
    const clients = createClients(runtime);
    this.cached = { ...clients, revision: runtime.revision };
    return clients;
  }

  readonly resolveRerankHealth = async () => {
    const { rerank } = await this.resolveClients();
    return rerank;
  };
}

export class LiveKnowledgeModelConfigurationProbe
  implements KnowledgeModelConfigurationProbe
{
  async probe(runtime: ResolvedKnowledgeModelRuntime): Promise<void> {
    const clients = createClients(runtime);
    await Promise.all([
      clients.embedding.health(),
      clients.rerank?.health() ?? Promise.resolve(),
    ]);
  }
}

function createClients(
  runtime: ResolvedKnowledgeModelRuntime,
): ResolvedKnowledgeModelClients {
  return {
    embedding: new EmbeddingClient(runtime.embedding),
    rerank: runtime.rerank ? new RerankClient(runtime.rerank) : null,
  };
}
