import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeDocumentEventPublisher,
  PublishingKnowledgePipelineStateStore,
  RedisKnowledgeEventSource,
} from "../src/modules/knowledge/events.js";
import { createImageUnderstandingSnapshot } from "../src/modules/system/image-understanding-settings.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const knowledgeBaseId = "20000000-0000-4000-8000-000000000001";
const documentId = "30000000-0000-4000-8000-000000000001";
const documentVersionId = "40000000-0000-4000-8000-000000000001";
const generation = "50000000-0000-4000-8000-000000000001";

describe("knowledge processing event fan-out", () => {
  it.each(["processing", "ready"])("publishes safe progress with status %s", async (status) => {
    const publish = vi.fn(async (channel: string, payload: string) => {
      expect(channel).toBeTypeOf("string");
      expect(payload).toBeTypeOf("string");
      return 1;
    });
    const publisher = new KnowledgeDocumentEventPublisher(
      {
        knowledgeBaseDocument: {
          findFirst: vi.fn(async () => ({
            status,
            updatedAt: new Date("2026-07-22T01:00:00.000Z"),
          })),
        },
        knowledgeBaseDocumentVersion: {
          findFirst: vi.fn(async () => ({
            processingStage: "embedding",
            progressPercent: 80,
            processingRevision: 7n,
            retryAt: null,
            stageAttemptCount: 0,
            stableErrorCode: null,
            updatedAt: new Date("2026-07-22T01:00:00.000Z"),
          })),
        },
      } as never,
      { publish } as never,
    );

    await publisher.publish(processingJob());

    expect(publish).toHaveBeenCalledWith(
      `linksense:knowledge-events:${knowledgeBaseId}`,
      expect.any(String),
    );
    const projected = JSON.parse(String(publish.mock.calls[0]?.[1]));
    expect(projected).toEqual({
      type: "knowledge_document_processing_updated",
      knowledge_base_id: knowledgeBaseId,
      document_id: documentId,
      processing_generation: generation,
      status,
      stage: "embedding",
      progress_percent: 80,
      revision: 7,
      retry_at: null,
      retry_attempt: 0,
      stable_error_code: null,
      updated_at: "2026-07-22T01:00:00.000Z",
    });
    expect(JSON.stringify(projected)).not.toContain("objectKey");
  });

  it("never turns a transient fan-out failure into a processing retry", async () => {
    const transition = vi.fn(async () => undefined);
    const delegate = {
      isCurrentGeneration: vi.fn(async () => true),
      isCancellationRequested: vi.fn(async () => false),
      requestCancellation: vi.fn(async () => undefined),
      transition,
      getActiveExternalTask: vi.fn(async () => null),
      recordExternalTask: vi.fn(async (_job, _kind, taskId) => ({
        taskId,
        attemptNo: 1,
      })),
      discardExternalTask: vi.fn(async () => false),
      completeExternalTask: vi.fn(async () => false),
      markFailed: vi.fn(async () => undefined),
      recordRetry: vi.fn(async () => undefined),
    };
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    };
    const state = new PublishingKnowledgePipelineStateStore(
      delegate,
      publisher as never,
    );

    await expect(
      state.transition({
        job: processingJob(),
        stage: "embedding",
        progress: 80,
      }),
    ).resolves.toBeUndefined();
    expect(transition).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it("closes a live subscription when the knowledge base is archived", async () => {
    const subscriber = new FakeSubscriber();
    let lifecycleStatus = "active";
    const prisma = {
      user: { findUnique: vi.fn(async () => ({ status: "active" })) },
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          ownerId: actorId,
          lifecycleStatus,
          availabilityStatus: "enabled",
        })),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      knowledgeBaseGrant: { findFirst: vi.fn(async () => null) },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({ status: "ready" })),
      },
      knowledgeBaseDocumentVersion: { findMany: vi.fn(async () => []) },
    };
    const source = new RedisKnowledgeEventSource(prisma as never, {
      duplicate: () => subscriber as never,
    });
    const controller = new AbortController();
    const subscription = source.subscribe({
      actorId,
      knowledgeBaseId,
      signal: controller.signal,
    });
    const iterator = subscription[Symbol.asyncIterator]();
    const first = iterator.next();
    await vi.waitFor(() => expect(subscriber.subscribe).toHaveBeenCalled());
    subscriber.emit(
      "message",
      `linksense:knowledge-events:${knowledgeBaseId}`,
      JSON.stringify(documentEvent(1)),
    );
    await expect(first).resolves.toEqual({ done: false, value: documentEvent(1) });

    lifecycleStatus = "archived";
    const afterRevoke = iterator.next();
    subscriber.emit(
      "message",
      `linksense:knowledge-events:${knowledgeBaseId}`,
      JSON.stringify(documentEvent(2)),
    );
    await expect(afterRevoke).resolves.toEqual({ done: true, value: undefined });
    expect(subscriber.quit).toHaveBeenCalled();
  });
});

class FakeSubscriber extends EventEmitter {
  status = "wait";
  connect = vi.fn(async () => {
    this.status = "ready";
  });
  subscribe = vi.fn(async () => 1);
  unsubscribe = vi.fn(async () => 0);
  quit = vi.fn(async () => "OK");
  disconnect = vi.fn();
}

function processingJob() {
  return {
    operation: "upload" as const,
    knowledgeBaseId,
    documentId,
    documentVersionId,
    processingGeneration: generation,
    requestedBy: actorId,
    sourceFormat: "pdf",
    ocrEnabled: false,
    startStage: "parsing" as const,
    parserConfigDigest: "a".repeat(64),
    chunking: {
      tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
      embeddingMaxInputTokens: 8_192,
      configDigest: "c".repeat(64),
    },
    imageUnderstanding: createImageUnderstandingSnapshot(null),
    embeddingProfileHash: "d".repeat(64),
  };
}

function documentEvent(revision: number) {
  return {
    type: "knowledge_document_processing_updated" as const,
    knowledge_base_id: knowledgeBaseId,
    document_id: documentId,
    processing_generation: generation,
    status: "ready" as const,
    stage: "completed" as const,
    progress_percent: 100,
    revision,
    retry_at: null,
    retry_attempt: 0,
    stable_error_code: null,
    updated_at: "2026-07-22T01:00:00.000Z",
  };
}
