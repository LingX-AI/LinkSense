import {
  knowledgeDocumentEventSchema,
  type KnowledgeDocumentEvent as SharedKnowledgeDocumentEvent,
} from "@linksense/shared";
import type { Redis } from "ioredis";

import type { LinkSenseRedis } from "../../adapters/redis.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  KnowledgePipelineStateStore,
  KnowledgeProcessingJob,
  KnowledgeProcessingJobIdentity,
} from "../knowledge-processing/pipeline.js";
import type {
  KnowledgeDocumentEvent,
  KnowledgeEventSource,
} from "./types.js";

const KNOWLEDGE_EVENT_CHANNEL_PREFIX = "linksense:knowledge-events:";

/** Publishes only the committed, user-safe processing projection. */
export class KnowledgeDocumentEventPublisher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Pick<Redis, "publish">,
  ) {}

  async publish(
    job: Pick<
      KnowledgeProcessingJob,
      | "knowledgeBaseId"
      | "documentId"
      | "documentVersionId"
      | "processingGeneration"
    >,
  ): Promise<void> {
    const [document, version] = await Promise.all([
      this.prisma.knowledgeBaseDocument.findFirst({
        where: { id: job.documentId, knowledgeBaseId: job.knowledgeBaseId },
        select: { status: true, updatedAt: true },
      }),
      this.prisma.knowledgeBaseDocumentVersion.findFirst({
        where: {
          id: job.documentVersionId,
          knowledgeBaseId: job.knowledgeBaseId,
          documentId: job.documentId,
          processingGeneration: job.processingGeneration,
        },
        select: {
          processingStage: true,
          progressPercent: true,
          processingRevision: true,
          retryAt: true,
          stageAttemptCount: true,
          stableErrorCode: true,
          updatedAt: true,
        },
      }),
    ]);
    if (!document || !version) return;
    const revision = Number(version.processingRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    const event = knowledgeDocumentEventSchema.parse({
      type:
        document.status === "deleted"
          ? "knowledge_document_deleted"
          : "knowledge_document_processing_updated",
      knowledge_base_id: job.knowledgeBaseId,
      document_id: job.documentId,
      processing_generation: job.processingGeneration,
      status: document.status,
      stage: version.processingStage,
      progress_percent: version.progressPercent,
      revision,
      retry_at: version.retryAt?.toISOString() ?? null,
      retry_attempt: version.stageAttemptCount,
      stable_error_code: version.stableErrorCode,
      updated_at: version.updatedAt.toISOString(),
    });
    await this.redis.publish(
      knowledgeEventChannel(job.knowledgeBaseId),
      JSON.stringify(event),
    );
  }
}

/**
 * Adds best-effort fan-out after durable state changes. Publication failure
 * never rolls back or retries a successfully committed processing stage; SSE
 * subscribers reconcile from PostgreSQL on connect.
 */
export class PublishingKnowledgePipelineStateStore
  implements KnowledgePipelineStateStore
{
  constructor(
    private readonly delegate: KnowledgePipelineStateStore,
    private readonly publisher: KnowledgeDocumentEventPublisher,
  ) {}

  isCurrentGeneration(job: KnowledgeProcessingJob): Promise<boolean> {
    return this.delegate.isCurrentGeneration(job);
  }

  isCancellationRequested(job: KnowledgeProcessingJob): Promise<boolean> {
    return this.delegate.isCancellationRequested(job);
  }

  async requestCancellation(job: KnowledgeProcessingJob): Promise<void> {
    await this.delegate.requestCancellation(job);
    await this.publishBestEffort(job);
  }

  async transition(
    input: Parameters<KnowledgePipelineStateStore["transition"]>[0],
  ): Promise<void> {
    await this.delegate.transition(input);
    await this.publishBestEffort(input.job);
  }

  getActiveExternalTask(
    ...input: Parameters<KnowledgePipelineStateStore["getActiveExternalTask"]>
  ): ReturnType<KnowledgePipelineStateStore["getActiveExternalTask"]> {
    return this.delegate.getActiveExternalTask(...input);
  }

  async recordExternalTask(
    ...input: Parameters<KnowledgePipelineStateStore["recordExternalTask"]>
  ): ReturnType<KnowledgePipelineStateStore["recordExternalTask"]> {
    const recorded = await this.delegate.recordExternalTask(...input);
    const [job] = input;
    await this.publishBestEffort(job);
    return recorded;
  }

  async discardExternalTask(
    ...input: Parameters<KnowledgePipelineStateStore["discardExternalTask"]>
  ): ReturnType<KnowledgePipelineStateStore["discardExternalTask"]> {
    const discarded = await this.delegate.discardExternalTask(...input);
    const [job] = input;
    if (discarded) await this.publishBestEffort(job);
    return discarded;
  }

  async completeExternalTask(
    ...input: Parameters<KnowledgePipelineStateStore["completeExternalTask"]>
  ): ReturnType<KnowledgePipelineStateStore["completeExternalTask"]> {
    const completed = await this.delegate.completeExternalTask(...input);
    const [job] = input;
    if (completed) await this.publishBestEffort(job);
    return completed;
  }

  async markFailed(
    input: Parameters<KnowledgePipelineStateStore["markFailed"]>[0],
  ): Promise<void> {
    await this.delegate.markFailed(input);
    await this.publishBestEffort(input.job);
  }

  async recordRetry(
    input: Parameters<KnowledgePipelineStateStore["recordRetry"]>[0],
  ): Promise<void> {
    await this.delegate.recordRetry(input);
    await this.publishBestEffort(input.job);
  }

  private async publishBestEffort(
    job: KnowledgeProcessingJobIdentity,
  ): Promise<void> {
    await this.publisher.publish(job).catch(() => undefined);
  }
}

export class RedisKnowledgeEventSource implements KnowledgeEventSource {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Pick<LinkSenseRedis, "duplicate">,
  ) {}

  async *subscribe(input: {
    actorId: string;
    knowledgeBaseId: string;
    signal: AbortSignal;
  }): AsyncIterable<KnowledgeDocumentEvent> {
    const subscriber = this.redis.duplicate();
    const queue: SharedKnowledgeDocumentEvent[] = [];
    let wake: (() => void) | null = null;
    const onMessage = (_channel: string, raw: string) => {
      try {
        const parsed = knowledgeDocumentEventSchema.safeParse(JSON.parse(raw));
        if (
          parsed.success &&
          parsed.data.knowledge_base_id === input.knowledgeBaseId
        ) {
          queue.push(parsed.data);
          wake?.();
        }
      } catch {
        // PostgreSQL reconciliation remains authoritative.
      }
    };
    subscriber.on("message", onMessage);
    try {
      if (subscriber.status === "wait") await subscriber.connect();
      await subscriber.subscribe(knowledgeEventChannel(input.knowledgeBaseId));
      if (!(await hasCurrentKnowledgeBaseAccess(this.prisma, input))) return;
      for (const event of await currentKnowledgeDocumentEvents(
        this.prisma,
        input.actorId,
        input.knowledgeBaseId,
      )) {
        if (input.signal.aborted) return;
        yield event;
      }

      while (!input.signal.aborted) {
        if (queue.length === 0) {
          await waitForQueueOrReauthorization({
            signal: input.signal,
            setWake(callback) {
              wake = callback;
            },
            clearWake() {
              wake = null;
            },
          });
        }
        if (input.signal.aborted) return;
        if (!(await hasCurrentKnowledgeBaseAccess(this.prisma, input))) return;
        const event = queue.shift();
        if (!event) continue;
        if (
          await canSeeKnowledgeDocumentEvent(
            this.prisma,
            input.actorId,
            input.knowledgeBaseId,
            event,
          )
        ) {
          yield event;
        }
      }
    } finally {
      wake = null;
      subscriber.off("message", onMessage);
      await subscriber.unsubscribe(
        knowledgeEventChannel(input.knowledgeBaseId),
      ).catch(() => undefined);
      await subscriber.quit().catch(() => subscriber.disconnect());
    }
  }
}

async function currentKnowledgeDocumentEvents(
  prisma: PrismaClient,
  actorId: string,
  knowledgeBaseId: string,
): Promise<SharedKnowledgeDocumentEvent[]> {
  const base = await prisma.knowledgeBase.findUnique({
    where: { id: knowledgeBaseId },
    select: { ownerId: true },
  });
  if (!base) return [];
  const owner = base.ownerId === actorId;
  const documents = await prisma.knowledgeBaseDocument.findMany({
    where: {
      knowledgeBaseId,
      ...(owner ? {} : { status: { in: ["ready", "deleted"] } }),
    },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      candidateVersionId: true,
      activeProcessingVersionId: true,
      updatedAt: true,
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  const versionIds = documents.flatMap((document) => {
    const id =
      document.activeProcessingVersionId ??
      (owner ? document.candidateVersionId : null) ??
      document.currentVersionId;
    return id ? [id] : [];
  });
  const versions = await prisma.knowledgeBaseDocumentVersion.findMany({
    where: { id: { in: versionIds } },
    select: {
      id: true,
      processingGeneration: true,
      processingStage: true,
      progressPercent: true,
      processingRevision: true,
      retryAt: true,
      stageAttemptCount: true,
      stableErrorCode: true,
      updatedAt: true,
    },
  });
  const versionById = new Map(versions.map((version) => [version.id, version]));
  return documents.flatMap((document) => {
    const versionId =
      document.activeProcessingVersionId ??
      (owner ? document.candidateVersionId : null) ??
      document.currentVersionId;
    const version = versionId ? versionById.get(versionId) : undefined;
    if (!version) return [];
    const revision = Number(version.processingRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) return [];
    const parsed = knowledgeDocumentEventSchema.safeParse({
      type:
        document.status === "deleted"
          ? "knowledge_document_deleted"
          : "knowledge_document_processing_updated",
      knowledge_base_id: knowledgeBaseId,
      document_id: document.id,
      processing_generation: version.processingGeneration,
      status: document.status,
      stage: version.processingStage,
      progress_percent: version.progressPercent,
      revision,
      retry_at: version.retryAt?.toISOString() ?? null,
      retry_attempt: version.stageAttemptCount,
      stable_error_code: version.stableErrorCode,
      updated_at: version.updatedAt.toISOString(),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

async function canSeeKnowledgeDocumentEvent(
  prisma: PrismaClient,
  actorId: string,
  knowledgeBaseId: string,
  event: SharedKnowledgeDocumentEvent,
): Promise<boolean> {
  const [base, document] = await Promise.all([
    prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { ownerId: true },
    }),
    prisma.knowledgeBaseDocument.findFirst({
      where: { id: event.document_id, knowledgeBaseId },
      select: { status: true, candidateVersionId: true },
    }),
  ]);
  if (!base || !document) return false;
  if (base.ownerId === actorId || document.status === "deleted") return true;
  if (document.status !== "ready") return false;
  if (document.candidateVersionId === null) return true;
  const candidate = await prisma.knowledgeBaseDocumentVersion.findUnique({
    where: { id: document.candidateVersionId },
    select: { processingGeneration: true },
  });
  return candidate?.processingGeneration !== event.processing_generation;
}

async function hasCurrentKnowledgeBaseAccess(
  prisma: PrismaClient,
  input: { actorId: string; knowledgeBaseId: string },
): Promise<boolean> {
  const [user, base, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.actorId },
      select: { status: true },
    }),
    prisma.knowledgeBase.findUnique({
      where: { id: input.knowledgeBaseId },
      select: {
        ownerId: true,
        lifecycleStatus: true,
        availabilityStatus: true,
      },
    }),
    prisma.userGroupMember.findMany({
      where: { userId: input.actorId, status: "active" },
      select: { userGroupId: true },
    }),
  ]);
  if (
    user?.status !== "active" ||
    !base ||
    base.lifecycleStatus !== "active" ||
    base.availabilityStatus !== "enabled"
  ) {
    return false;
  }
  if (base.ownerId === input.actorId) return true;
  return (
    (await prisma.knowledgeBaseGrant.findFirst({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        status: "active",
        OR: [
          { granteeType: "user", userId: input.actorId },
          ...(memberships.length > 0
            ? [
                {
                  granteeType: "user_group",
                  userGroupId: {
                    in: memberships.map(
                      (membership) => membership.userGroupId,
                    ),
                  },
                } as const,
              ]
            : []),
        ],
      },
      select: { id: true },
    })) !== null
  );
}

function waitForQueueOrReauthorization(input: {
  signal: AbortSignal;
  setWake(callback: () => void): void;
  clearWake(): void;
}): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal.removeEventListener("abort", finish);
      input.clearWake();
      resolve();
    };
    const timer = setTimeout(finish, 15_000);
    timer.unref();
    input.setWake(finish);
    input.signal.addEventListener("abort", finish, { once: true });
  });
}

function knowledgeEventChannel(knowledgeBaseId: string): string {
  return `${KNOWLEDGE_EVENT_CHANNEL_PREFIX}${knowledgeBaseId}`;
}
