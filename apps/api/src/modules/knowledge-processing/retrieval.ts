import { randomUUID } from "node:crypto";

import {
  KNOWLEDGE_SEARCH_MAX_NUM_CANDIDATES,
  type ModelTokenPricing,
} from "@linksense/shared";
import { z } from "zod";

import type {
  ElasticsearchKnowledgeAdapter,
  ParentSearchHit,
} from "./elasticsearch.js";
import type { EmbeddingClient } from "./embedding.js";
import type { KnowledgeRetrievalClientResolver } from "./knowledge-model-runtime.js";
import { KnowledgeProcessingError } from "./errors.js";
import {
  projectMeasuredModelTokenUsage,
  type ModelUsageRecorder,
} from "../usage/model-usage.js";
import {
  knowledgeProviderTokenUsageSchema,
  normalizeKnowledgeProviderTokenUsage,
  type NormalizedKnowledgeProviderTokenUsage,
} from "./provider-token-usage.js";
import {
  LENGTH_BUDGET_PERCENTAGES,
  RERANK_TRUNCATION_MARKER,
  cl100kTokenEstimator,
  truncateContextHeadTail,
  type TokenEstimator,
} from "./token-estimator.js";

const rerankResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      relevance_score: z.number().finite(),
    }),
  ),
  usage: knowledgeProviderTokenUsageSchema.optional(),
});

export type RetrievalParameters = {
  finalTopK?: number;
  candidateMultiplier?: number;
  numCandidates?: number;
  minScore?: number;
};

export type NormalizedRetrievalParameters = {
  finalTopK: number;
  candidateMultiplier: number;
  candidateTopK: number;
  numCandidates?: number;
  minScore: number;
};

export type FusedParentCandidate = ParentSearchHit & {
  vectorRank?: number;
  bm25Rank?: number;
  rrfScore: number;
};

export type KnowledgeRetrievalResult = {
  parents: ParentSearchHit[];
  ranking: "rerank" | "rrf";
};

export type RetrievalCandidateFilter = (
  candidates: readonly FusedParentCandidate[],
) => Promise<FusedParentCandidate[]>;

export type RerankResult = {
  requestId: string;
  model: string;
  pricing: ModelTokenPricing;
  usage: {
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    measurementMethod: "provider" | "estimated";
  };
  items: Array<{ candidate: FusedParentCandidate; score: number }>;
};

export class RerankClient {
  private readonly endpoint: string;

  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey?: string;
      model: string;
      timeoutMs: number;
      maximumInputTokens: number;
      pricing?: ModelTokenPricing;
    },
    private readonly fetcher: typeof fetch = fetch,
    private readonly estimator: TokenEstimator = cl100kTokenEstimator,
  ) {
    this.endpoint = `${config.baseUrl.replace(/\/$/u, "")}/rerank`;
  }

  async rerank(
    query: string,
    candidates: readonly FusedParentCandidate[],
    signal?: AbortSignal,
  ): Promise<RerankResult> {
    if (candidates.length === 0) {
      throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
    }
    const queryTokens = this.estimator.count(query);

    for (const percentage of LENGTH_BUDGET_PERCENTAGES) {
      const pairBudget = Math.floor(
        (this.config.maximumInputTokens * percentage) / 100,
      );
      const documentBudget = pairBudget - queryTokens;
      if (documentBudget <= 0) {
        throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
      }
      const documents: string[] = [];
      for (const candidate of candidates) {
        const protectedText = truncateContextHeadTail({
          context: serializeTitlePath(candidate.titlePath),
          body: candidate.parentText,
          maximumTokens: documentBudget,
          marker: RERANK_TRUNCATION_MARKER,
          estimator: this.estimator,
        });
        if (protectedText === null) {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_RERANK_RESPONSE_INVALID",
          );
        }
        documents.push(protectedText.text);
      }

      try {
        const response = await this.request(query, documents, signal);
        const estimatedInputTokens =
          queryTokens +
          documents.reduce(
            (total, document) => total + this.estimator.count(document),
            0,
          );
        const usage = response.usage ?? {
          totalTokens: estimatedInputTokens,
          inputTokens: estimatedInputTokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        };
        const items = response.scores
          .map(({ index, score }) => ({ candidate: candidates[index]!, score }))
          .sort((left, right) => {
            const byScore = right.score - left.score;
            if (byScore !== 0) return byScore;
            return (
              candidates.indexOf(left.candidate) -
              candidates.indexOf(right.candidate)
            );
          });
        return {
          requestId: response.requestId,
          model: this.config.model,
          pricing: this.config.pricing ?? DEFAULT_MODEL_PRICING,
          usage: {
            ...usage,
            measurementMethod: response.usage ? "provider" : "estimated",
          },
          items,
        };
      } catch (error) {
        if (!(error instanceof RerankInputLengthError)) throw error;
        if (percentage === 50) {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_RERANK_RESPONSE_INVALID",
          );
        }
      }
    }
    throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
  }

  async health(signal?: AbortSignal): Promise<void> {
    const candidate: FusedParentCandidate = {
      parentId: "00000000-0000-4000-8000-000000000001",
      parentOrder: 0,
      knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
      documentId: "00000000-0000-4000-8000-000000000003",
      documentVersionId: "00000000-0000-4000-8000-000000000004",
      titlePath: [],
      parentText: "health",
      pageNumbers: [],
      childIds: ["health-child"],
      childCount: 1,
      matchedChildren: [
        {
          childId: "health-child",
          order: 0,
          rawText: "health",
          titlePath: [],
          pageNumbers: [],
          score: 0,
          matchKinds: ["dense"],
        },
      ],
      score: 0,
      rrfScore: 0,
    };
    await this.rerank("health", [candidate], signal);
  }

  private async request(
    query: string,
    documents: string[],
    signal?: AbortSignal,
  ): Promise<{
    requestId: string;
    scores: Array<{ index: number; score: number }>;
    usage?: NormalizedKnowledgeProviderTokenUsage;
  }> {
    const requestId = randomUUID();
    const headers = new Headers({ "content-type": "application/json" });
    if (this.config.apiKey) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`);
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers,
        signal: combined,
        body: JSON.stringify({
          model: this.config.model,
          query,
          documents,
        }),
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { cause: error, retryable: true },
      );
    }

    if (!response.ok) {
      const shape = await externalErrorShape(response);
      if (isRerankLengthError(response.status, shape)) {
        throw new RerankInputLengthError();
      }
      if (response.status === 401 || response.status === 403) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED",
        );
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        {
          retryable:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        },
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID", {
        cause: error,
      });
    }
    const parsed = rerankResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.results.length !== documents.length) {
      throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
    }
    const seen = new Set<number>();
    const scores: Array<{ index: number; score: number }> = [];
    for (const result of parsed.data.results) {
      if (result.index >= documents.length || seen.has(result.index)) {
        throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
      }
      seen.add(result.index);
      scores.push({ index: result.index, score: result.relevance_score });
    }
    const usage = parsed.data.usage
      ? normalizeKnowledgeProviderTokenUsage(parsed.data.usage)
      : undefined;
    if (parsed.data.usage && !usage) {
      throw new KnowledgeProcessingError("KNOWLEDGE_RERANK_RESPONSE_INVALID");
    }
    return {
      requestId,
      scores,
      ...(usage ? { usage } : {}),
    };
  }
}

const DEFAULT_MODEL_PRICING: ModelTokenPricing = {
  input_price_per_million: "0",
  cached_input_price_per_million: "0",
  output_price_per_million: "0",
};

export class KnowledgeRetrievalOrchestrator {
  constructor(
    private readonly models: KnowledgeRetrievalClientResolver | EmbeddingClient,
    private readonly elasticsearch: ElasticsearchKnowledgeAdapter,
    private readonly legacyRerank: RerankClient | null = null,
    private readonly usageRecorder?: ModelUsageRecorder,
  ) {}

  async search(input: {
    query: string;
    authorizedKnowledgeBaseIds: string[];
    parameters?: RetrievalParameters;
    filterCandidates: RetrievalCandidateFilter;
    usageContext?: {
      ownerId: string;
      conversationId: string;
      turnId: string;
    };
    signal?: AbortSignal;
  }): Promise<KnowledgeRetrievalResult> {
    const query = input.query.trim();
    if (query === "") {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
      );
    }
    const knowledgeBaseIds = [...new Set(input.authorizedKnowledgeBaseIds)];
    if (knowledgeBaseIds.length === 0) return { parents: [], ranking: "rrf" };
    const parameters = normalizeRetrievalParameters(input.parameters);
    const { embedding, rerank } = await this.resolveClients();
    const embedded = await embedding.embedQuery(query, input.signal);
    if (input.usageContext && this.usageRecorder) {
      await this.usageRecorder.recordModelUsage({
        requestId: embedded.requestId,
        ...input.usageContext,
        workload: "query_embedding",
        modelKind: "embedding",
        model: embedded.model,
        ...projectMeasuredModelTokenUsage(embedded.usage),
        pricing: embedded.pricing,
      });
    }
    const filter = {
      knowledgeBaseIds,
      embeddingProfileHash: embedding.profileHash,
    };
    const [vectorResults, bm25Results] = await Promise.all([
      this.elasticsearch.vectorSearch({
        vector: embedded.vector,
        filter,
        k: parameters.candidateTopK,
        size: parameters.candidateTopK,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(parameters.numCandidates === undefined
          ? {}
          : { numCandidates: parameters.numCandidates }),
      }),
      this.elasticsearch.bm25Search({
        query,
        filter,
        size: parameters.candidateTopK,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    ]);
    const fused = reciprocalRankFusion(vectorResults, bm25Results);
    const eligible = await input.filterCandidates(fused);
    if (rerank === null || eligible.length === 0) {
      return {
        parents: eligible.slice(0, parameters.finalTopK),
        ranking: "rrf",
      };
    }
    let reranked: RerankResult;
    try {
      reranked = await rerank.rerank(query, eligible, input.signal);
    } catch (error) {
      if (
        error instanceof KnowledgeProcessingError &&
        error.code === "KNOWLEDGE_PROCESSING_CANCELLED"
      ) {
        throw error;
      }
      return {
        parents: eligible.slice(0, parameters.finalTopK),
        ranking: "rrf",
      };
    }
    if (input.usageContext && this.usageRecorder) {
      await this.usageRecorder.recordModelUsage({
        requestId: reranked.requestId,
        ...input.usageContext,
        workload: "rerank",
        modelKind: "rerank",
        model: reranked.model,
        ...projectMeasuredModelTokenUsage(reranked.usage),
        pricing: reranked.pricing,
      });
    }
    return {
      parents: reranked.items
        .filter((item) => item.score >= parameters.minScore)
        .slice(0, parameters.finalTopK)
        .map((item) => item.candidate),
      ranking: "rerank",
    };
  }

  private resolveClients(): Promise<{
    embedding: EmbeddingClient;
    rerank: RerankClient | null;
  }> {
    return "resolveClients" in this.models
      ? this.models.resolveClients()
      : Promise.resolve({
          embedding: this.models,
          rerank: this.legacyRerank,
        });
  }
}

export function normalizeRetrievalParameters(
  value: RetrievalParameters = {},
): NormalizedRetrievalParameters {
  const finalTopK = value.finalTopK ?? 5;
  const candidateMultiplier = value.candidateMultiplier ?? 3;
  const minScore = value.minScore ?? 0.2;
  if (
    !Number.isSafeInteger(finalTopK) ||
    finalTopK <= 0 ||
    !Number.isSafeInteger(candidateMultiplier) ||
    candidateMultiplier < 1 ||
    candidateMultiplier > 10 ||
    !Number.isFinite(minScore) ||
    (value.numCandidates !== undefined &&
      (!Number.isSafeInteger(value.numCandidates) ||
        value.numCandidates <= 0 ||
        value.numCandidates > KNOWLEDGE_SEARCH_MAX_NUM_CANDIDATES))
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
    );
  }
  const candidateTopK = Math.max(finalTopK * candidateMultiplier, 10);
  return {
    finalTopK,
    candidateMultiplier,
    candidateTopK,
    minScore,
    ...(value.numCandidates === undefined
      ? {}
      : { numCandidates: Math.max(value.numCandidates, candidateTopK) }),
  };
}

export function reciprocalRankFusion(
  vectorResults: readonly ParentSearchHit[],
  bm25Results: readonly ParentSearchHit[],
): FusedParentCandidate[] {
  const byParent = new Map<string, FusedParentCandidate>();
  for (const [position, hit] of vectorResults.entries()) {
    byParent.set(hit.parentId, {
      ...hit,
      vectorRank: position + 1,
      rrfScore: 1 / (60 + position + 1),
    });
  }
  for (const [position, hit] of bm25Results.entries()) {
    const existing = byParent.get(hit.parentId);
    if (existing) {
      assertSameParent(existing, hit);
      existing.bm25Rank = position + 1;
      existing.rrfScore += 1 / (60 + position + 1);
      existing.matchedChildren = mergeMatchedChildren(
        existing.matchedChildren,
        hit.matchedChildren,
      );
    } else {
      byParent.set(hit.parentId, {
        ...hit,
        bm25Rank: position + 1,
        rrfScore: 1 / (60 + position + 1),
      });
    }
  }
  return [...byParent.values()].sort((left, right) => {
    const score = right.rrfScore - left.rrfScore;
    if (score !== 0) return score;
    const leftBest = Math.min(
      left.vectorRank ?? Infinity,
      left.bm25Rank ?? Infinity,
    );
    const rightBest = Math.min(
      right.vectorRank ?? Infinity,
      right.bm25Rank ?? Infinity,
    );
    if (leftBest !== rightBest) return leftBest - rightBest;
    if ((left.vectorRank ?? Infinity) !== (right.vectorRank ?? Infinity)) {
      return (left.vectorRank ?? Infinity) - (right.vectorRank ?? Infinity);
    }
    if ((left.bm25Rank ?? Infinity) !== (right.bm25Rank ?? Infinity)) {
      return (left.bm25Rank ?? Infinity) - (right.bm25Rank ?? Infinity);
    }
    return left.parentId.localeCompare(right.parentId);
  });
}

function assertSameParent(left: ParentSearchHit, right: ParentSearchHit): void {
  if (
    left.knowledgeBaseId !== right.knowledgeBaseId ||
    left.documentId !== right.documentId ||
    left.documentVersionId !== right.documentVersionId ||
    left.parentText !== right.parentText ||
    left.childCount !== right.childCount ||
    left.childIds.length !== right.childIds.length ||
    left.childIds.some((childId, index) => childId !== right.childIds[index])
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
    );
  }
}

function mergeMatchedChildren(
  left: ReadonlyArray<ParentSearchHit["matchedChildren"][number]>,
  right: ReadonlyArray<ParentSearchHit["matchedChildren"][number]>,
): ParentSearchHit["matchedChildren"] {
  const byId = new Map(
    left.map((child) => [
      child.childId,
      {
        ...child,
        titlePath: [...child.titlePath],
        pageNumbers: [...child.pageNumbers],
        matchKinds: [...child.matchKinds],
      },
    ]),
  );
  for (const child of right) {
    const existing = byId.get(child.childId);
    if (existing === undefined) {
      byId.set(child.childId, {
        ...child,
        titlePath: [...child.titlePath],
        pageNumbers: [...child.pageNumbers],
        matchKinds: [...child.matchKinds],
      });
      continue;
    }
    if (
      existing.order !== child.order ||
      existing.rawText !== child.rawText ||
      existing.titlePath.length !== child.titlePath.length ||
      existing.titlePath.some(
        (title, index) => title !== child.titlePath[index],
      ) ||
      existing.pageNumbers.length !== child.pageNumbers.length ||
      existing.pageNumbers.some(
        (page, index) => page !== child.pageNumbers[index],
      )
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
      );
    }
    existing.score = Math.max(existing.score, child.score);
    existing.matchKinds = [
      ...new Set([...existing.matchKinds, ...child.matchKinds]),
    ];
  }
  return [...byId.values()].sort(
    (leftChild, rightChild) =>
      leftChild.order - rightChild.order ||
      leftChild.childId.localeCompare(rightChild.childId),
  );
}

function serializeTitlePath(path: readonly string[]): string {
  return path
    .map((title, index) => `${"#".repeat(Math.min(index + 1, 6))} ${title}`)
    .join("\n");
}

class RerankInputLengthError extends Error {
  constructor() {
    super("rerank input exceeds provider limit");
    this.name = "RerankInputLengthError";
  }
}

type ErrorShape = {
  code: string | undefined;
  type: string | undefined;
  message: string | undefined;
};

async function externalErrorShape(response: Response): Promise<ErrorShape> {
  try {
    const text = (await response.text()).slice(0, 4_096);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return { code: undefined, type: undefined, message: undefined };
    }
    const nested = Reflect.get(parsed, "error");
    const source =
      typeof nested === "object" && nested !== null ? nested : parsed;
    return {
      code: stringProperty(source, "code"),
      type: stringProperty(source, "type"),
      message: stringProperty(source, "message"),
    };
  } catch {
    return { code: undefined, type: undefined, message: undefined };
  }
}

function isRerankLengthError(status: number, shape: ErrorShape): boolean {
  if (status !== 400 && status !== 413 && status !== 422) return false;
  const stable = `${shape.code ?? ""} ${shape.type ?? ""}`.toLowerCase();
  if (
    stable.includes("context_length") ||
    stable.includes("input_too_long") ||
    stable.includes("max_tokens") ||
    stable.includes("token_limit")
  ) {
    return true;
  }
  const message = shape.message?.toLowerCase() ?? "";
  return (
    /(?:maximum|max|context|input).{0,32}(?:token|length)/u.test(message) &&
    /(?:exceed|too long|larger|limit)/u.test(message)
  );
}

function stringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property.slice(0, 512) : undefined;
}
