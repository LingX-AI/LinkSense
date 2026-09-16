import { createHash, randomUUID } from "node:crypto"
import { rm } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"

import { Queue, Worker, type ConnectionOptions, type RedisOptions, type Job } from "bullmq"
import { z } from "zod"

import type { AppConfig } from "../config.js"
import type { PrismaClient } from "../generated/prisma/client.js"
import type { ObjectStorage } from "./object-storage.js"
import type { LinkSenseRedis } from "./redis.js"
import {
  RunnerRuntimeCleanupError,
  type RunnerClient,
  type RuntimeCleanupReasonCode,
  type RuntimeCleanupStage,
} from "./runner.js"
import type { AuditService } from "../modules/audit/service.js"
import { pruneExpiredCapabilityPreviews } from "../modules/capabilities/preview.js"
import { assertConversationWorkspacePath } from "../lib/user-runtime-paths.js"
import {
  conversationPrewarmInputSchema,
  type ConversationPrewarmInput,
} from "../modules/conversations/prewarm.js"

export interface AuthTokenCleanup {
  cleanupInvalidTokens(limit?: number): Promise<{
    refreshTokens: number
    passwordResetTokens: number
    registrationTokens: number
  }>
}

const maintenanceJobSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("auth-token-cleanup") }),
  z.strictObject({
    type: z.literal("object-delete"),
    objectKey: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("runtime-cleanup"),
    ownerId: z.uuid(),
    conversationId: z.uuid(),
    outboxId: z.uuid().optional(),
    serviceSessionId: z.uuid().optional(),
  }),
  z.strictObject({ type: z.literal("runtime-cleanup-outbox-dispatch") }),
  conversationPrewarmInputSchema.extend({
    type: z.literal("conversation-prewarm"),
  }),
  z.strictObject({
    type: z.literal("capability-preview-prune"),
    cursor: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal("workspace-directory-delete"),
    ownerId: z.uuid(),
    conversationId: z.uuid(),
    absolutePath: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal("directory-delete"),
    absolutePath: z.string().min(1),
  }),
])

export type MaintenanceJob = z.infer<typeof maintenanceJobSchema>

export function validateMaintenanceJob(input: unknown): MaintenanceJob | null {
  const result = maintenanceJobSchema.safeParse(input)
  return result.success ? result.data : null
}

type MaintenanceQueue = Queue<MaintenanceJob, unknown, MaintenanceJob["type"]>
const MAINTENANCE_QUEUE_NAME = "linksense-maintenance"

export type MaintenanceQueueControl = Pick<
  MaintenanceQueue,
  "add" | "close" | "getJob" | "getJobs" | "upsertJobScheduler"
>

export type CleanupFailure = {
  id: string
  resource_type: "workspace" | "object_storage" | "capability_directory"
  conversation_id?: string
  owner_id?: string
  status: "failed"
  cleanup_stage?: RuntimeCleanupStage
  failed_at: string
  reason_code:
    | RuntimeCleanupReasonCode
    | "CLEANUP_OPERATION_FAILED"
    | "CLEANUP_QUEUE_UNAVAILABLE"
  attempts_made: number
  max_attempts: number
}

const runtimeCleanupLeaseMs = 2 * 60_000
const runtimeCleanupMaxAttempts = 8
type RuntimeCleanupLifecycle = Pick<LinkSenseRedis, "acquireUserLifecycleLock" | "releaseUserLifecycleLock">

export class CleanupJobNotFoundError extends Error {
  constructor() {
    super("cleanup job was not found")
    this.name = "CleanupJobNotFoundError"
  }
}

export class CleanupJobNotRetryableError extends Error {
  constructor() {
    super("cleanup job is not in the failed state")
    this.name = "CleanupJobNotRetryableError"
  }
}

export class BackgroundJobs {
  private readonly connection: ConnectionOptions
  private readonly queue: MaintenanceQueueControl
  private readonly workspaceRoot: string
  private worker: Worker<
    MaintenanceJob,
    unknown,
    MaintenanceJob["type"]
  > | null = null
  private conversationPrewarmProcessor:
    | ((input: ConversationPrewarmInput) => Promise<void>)
    | null = null

  constructor(
    config: AppConfig,
    private readonly storage: ObjectStorage,
    private readonly runner: RunnerClient,
    private readonly audit: AuditService,
    private readonly capabilityRoot = resolve(config.capabilityRoot),
    queueOverride?: MaintenanceQueueControl,
    private readonly prisma?: PrismaClient,
    private readonly lifecycleCoordinator?: RuntimeCleanupLifecycle,
  ) {
    this.workspaceRoot = resolve(config.workspaceRoot)
    this.connection = bullMqConnection(config.redisUrl)
    this.queue =
      queueOverride ??
      new Queue<MaintenanceJob, unknown, MaintenanceJob["type"]>(
        MAINTENANCE_QUEUE_NAME,
        {
          connection: this.connection,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: 500,
            removeOnFail: 2_000,
          },
        },
      )
  }

  async listFailedCleanupJobs(limit = 100): Promise<CleanupFailure[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 200))
    const jobs = await this.queue.getJobs(
      ["failed"],
      0,
      boundedLimit - 1,
      false,
    )
    return jobs.flatMap((job) => {
      const failure = projectCleanupFailure(job)
      return failure ? [failure] : []
    })
  }

  async listDurableRuntimeCleanupFailures(
    limit = 100,
  ): Promise<CleanupFailure[]> {
    if (!this.prisma) return []
    const boundedLimit = Math.max(1, Math.min(limit, 200))
    const records = await this.prisma.runtimeCleanupOutbox.findMany({
      where: { status: "failed" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: boundedLimit,
    })
    return records.map(projectRuntimeCleanupOutboxFailure)
  }

  async retryFailedCleanupJob(jobId: string): Promise<CleanupFailure> {
    const outboxId = parseRuntimeCleanupOutboxFailureId(jobId)
    if (outboxId) return this.retryRuntimeCleanupOutbox(outboxId)
    const job = await this.queue.getJob(jobId)
    if (!job) throw new CleanupJobNotFoundError()
    const data = validateMaintenanceJob(job.data)
    if (!data || !isCleanupJob(data)) throw new CleanupJobNotFoundError()
    if ((await job.getState()) !== "failed") {
      throw new CleanupJobNotRetryableError()
    }
    const failure = projectCleanupFailure(job)
    if (!failure) throw new CleanupJobNotFoundError()
    await job.retry("failed")
    return failure
  }

  async retryAllFailedCleanupJobs(limit = 100): Promise<{
    requested: number
    rejected: number
  }> {
    const failures = [
      ...(await this.listDurableRuntimeCleanupFailures(limit)),
      ...(await this.listFailedCleanupJobs(limit)),
    ].slice(0, Math.max(1, Math.min(limit, 200)))
    const results = await Promise.allSettled(
      failures.map((failure) => this.retryFailedCleanupJob(failure.id)),
    )
    return {
      requested: results.filter((result) => result.status === "fulfilled").length,
      rejected: results.filter((result) => result.status === "rejected").length,
    }
  }

  async start(auth: AuthTokenCleanup): Promise<void> {
    if (this.worker) return
    await this.queue.upsertJobScheduler(
      "auth-token-cleanup",
      { every: 24 * 60 * 60 * 1_000 },
      { name: "auth-token-cleanup", data: { type: "auth-token-cleanup" } },
    )
    await this.queue.upsertJobScheduler(
      "runtime-cleanup-outbox-dispatch",
      { every: 60_000 },
      {
        name: "runtime-cleanup-outbox-dispatch",
        data: { type: "runtime-cleanup-outbox-dispatch" },
      },
    )
    await this.queue.upsertJobScheduler(
      "capability-preview-prune",
      { every: 5 * 60_000 },
      {
        name: "capability-preview-prune",
        data: { type: "capability-preview-prune" },
      },
    )
    this.worker = new Worker<MaintenanceJob, unknown, MaintenanceJob["type"]>(
      MAINTENANCE_QUEUE_NAME,
      (job) => this.process(job, auth),
      { connection: this.connection, concurrency: 4 },
    )
    await Promise.allSettled([
      this.recoverRuntimeCleanupOutbox(),
      this.queue.add("capability-preview-prune", {
        type: "capability-preview-prune",
      }),
    ])
  }

  async enqueueObjectDelete(objectKey: string): Promise<void> {
    await this.queue.add(
      "object-delete",
      { type: "object-delete", objectKey },
      { jobId: `object-${digest(objectKey)}` },
    )
  }

  async enqueueRuntimeCleanup(
    ownerId: string,
    conversationId: string,
    serviceSessionId?: string,
  ): Promise<void> {
    const prisma = this.prisma
    if (!prisma) {
      await this.queue.add(
        "runtime-cleanup",
        { type: "runtime-cleanup", ownerId, conversationId, ...(serviceSessionId ? { serviceSessionId } : {}) },
        { jobId: `runtime-${digest(conversationId)}` },
      )
      return
    }
    const outbox = await prisma.runtimeCleanupOutbox.upsert({
      where: { conversationId },
      create: {
        ownerId,
        conversationId,
        serviceSessionId: serviceSessionId ?? null,
        status: "pending",
        stage: "reconcile",
        maxAttempts: runtimeCleanupMaxAttempts,
      },
      update: {
        status: "pending",
        stage: "reconcile",
        attemptCount: 0,
        maxAttempts: runtimeCleanupMaxAttempts,
        nextAttemptAt: new Date(),
        lastAttemptAt: null,
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    await this.dispatchRuntimeCleanup(outbox).catch(async () => {
      await prisma.runtimeCleanupOutbox.updateMany({
        where: { id: outbox.id },
        data: {
          status: "pending",
          stage: "reconcile",
          nextAttemptAt: new Date(Date.now() + 15_000),
          lastErrorCode: "CLEANUP_QUEUE_UNAVAILABLE",
          claimToken: null,
          leaseExpiresAt: null,
        },
      })
    })
  }

  registerConversationPrewarmProcessor(
    processor: (input: ConversationPrewarmInput) => Promise<void>,
  ): void {
    this.conversationPrewarmProcessor = processor
  }

  async enqueueConversationPrewarm(input: ConversationPrewarmInput): Promise<void> {
    const minuteBucket = Math.floor(Date.now() / 60_000)
    await this.queue.add(
      "conversation-prewarm",
      { type: "conversation-prewarm", ...input },
      {
        jobId: `conversation-prewarm-${digest(
          `${input.ownerId}:${input.conversationId}:${input.collaborationMode}:${input.reservationRevision ?? minuteBucket}`,
        )}`,
        attempts: 1,
        priority: 100,
        removeOnComplete: true,
        removeOnFail: true,
      },
    )
  }

  async enqueueWorkspaceDirectoryRemoval(
    ownerId: string,
    conversationId: string,
    absolutePath: string,
  ): Promise<void> {
    const normalized = resolve(absolutePath)
    assertWorkspaceCleanupPath(
      this.workspaceRoot,
      ownerId,
      conversationId,
      normalized,
    )
    await this.queue.add(
      "workspace-directory-delete",
      {
        type: "workspace-directory-delete",
        ownerId,
        conversationId,
        absolutePath: normalized,
      },
      { jobId: `workspace-directory-${digest(normalized)}` },
    )
  }

  async enqueueDirectoryRemoval(absolutePath: string): Promise<void> {
    const normalized = resolve(absolutePath)
    assertCleanupDescendant(
      this.capabilityRoot,
      normalized,
      "capability cleanup path is outside its root",
    )
    await this.queue.add(
      "directory-delete",
      { type: "directory-delete", absolutePath: normalized },
      { jobId: `directory-${digest(normalized)}` },
    )
  }

  async close(): Promise<void> {
    await this.worker?.close()
    await this.queue.close()
  }

  private async process(job: Job<MaintenanceJob>, auth: AuthTokenCleanup) {
    const data = validateMaintenanceJob(job.data)
    if (!data) {
      await this.audit.write({
        actorId: null,
        action: "maintenance_job_payload_discarded",
        targetType: "maintenance_job",
        result: "rejected",
        metadata: { reason_code: "INVALID_JOB_PAYLOAD" },
      })
      return { discarded: true }
    }
    if (data.type === "object-delete") {
      await this.storage.removeObject(data.objectKey)
      return { deleted: true }
    }
    if (data.type === "conversation-prewarm") {
      // A speculative warmup must not compete with real work after a queue
      // backlog or service restart. BullMQ persists the enqueue timestamp.
      if (!Number.isFinite(job.timestamp) || Date.now() - job.timestamp >= 60_000) {
        return { discarded: true, reasonCode: "PREWARM_EXPIRED" }
      }
      if (!this.conversationPrewarmProcessor) {
        await this.audit.write({
          actorId: data.ownerId,
          action: "conversation_prewarm_discarded",
          targetType: "conversation",
          targetId: data.conversationId,
          result: "rejected",
          metadata: { reason_code: "PREWARM_PROCESSOR_UNAVAILABLE" },
        })
        return { discarded: true }
      }
      await this.conversationPrewarmProcessor({
        ownerId: data.ownerId,
        conversationId: data.conversationId,
        collaborationMode: data.collaborationMode,
        ...(data.reservationRevision
          ? { reservationRevision: data.reservationRevision }
          : {}),
      })
      return { prewarmed: true }
    }
    if (data.type === "runtime-cleanup") {
      const result = await executeRuntimeCleanupJob({
        runner: this.runner,
        ...(this.prisma ? { prisma: this.prisma } : {}),
        ...(this.lifecycleCoordinator ? { lifecycleCoordinator: this.lifecycleCoordinator } : {}),
        ownerId: data.ownerId,
        conversationId: data.conversationId,
        ...(data.outboxId ? { outboxId: data.outboxId } : {}),
        ...(data.serviceSessionId ? { serviceSessionId: data.serviceSessionId } : {}),
      })
      if ("discarded" in result) {
        await this.audit.write({
          actorId: null,
          action: "maintenance_job_payload_discarded",
          targetType: "maintenance_job",
          result: "rejected",
          metadata: { reason_code: result.reasonCode },
        })
      }
      return result
    }
    if (data.type === "runtime-cleanup-outbox-dispatch") {
      await this.recoverRuntimeCleanupOutbox()
      return { dispatched: true }
    }
    if (data.type === "capability-preview-prune") {
      const result = await pruneExpiredCapabilityPreviews({
        capabilityRoot: this.capabilityRoot,
        ...(data.cursor ? { cursor: data.cursor } : {}),
        limit: 100,
      })
      if (result.nextCursor) {
        await this.queue.add("capability-preview-prune", {
          type: "capability-preview-prune",
          cursor: result.nextCursor,
        })
      }
      return result
    }
    if (data.type === "workspace-directory-delete") {
      const normalized = resolve(data.absolutePath)
      assertWorkspaceCleanupPath(
        this.workspaceRoot,
        data.ownerId,
        data.conversationId,
        normalized,
      )
      await rm(normalized, { recursive: true, force: true })
      return { deleted: true }
    }
    if (data.type === "directory-delete") {
      const normalized = resolve(data.absolutePath)
      assertCleanupDescendant(
        this.capabilityRoot,
        normalized,
        "capability cleanup path is outside its root",
      )
      await rm(normalized, { recursive: true, force: true })
      return { deleted: true }
    }
    const result = await auth.cleanupInvalidTokens(500)
    await this.audit.write({
      actorId: null,
      action: "invalid_auth_tokens_cleaned",
      result: "success",
      metadata: {
        refresh_token_count: result.refreshTokens,
        password_reset_token_count: result.passwordResetTokens,
        registration_token_count: result.registrationTokens,
      },
    })
    return result
  }

  async recoverRuntimeCleanupOutbox(now = new Date()): Promise<void> {
    const prisma = this.prisma
    if (!prisma) return
    await prisma.runtimeCleanupOutbox.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lte: now },
        attemptCount: { lt: runtimeCleanupMaxAttempts },
      },
      data: {
        status: "pending",
        stage: "reconcile",
        nextAttemptAt: now,
        lastErrorCode: "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    await prisma.runtimeCleanupOutbox.updateMany({
      where: {
        status: "running",
        leaseExpiresAt: { lte: now },
        attemptCount: { gte: runtimeCleanupMaxAttempts },
      },
      data: {
        status: "failed",
        stage: "reconcile",
        lastErrorCode: "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    const records = await prisma.runtimeCleanupOutbox.findMany({
      where: {
        status: { in: ["pending", "queued"] },
        nextAttemptAt: { lte: now },
        attemptCount: { lt: runtimeCleanupMaxAttempts },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 100,
    })
    for (const record of records) {
      await this.dispatchRuntimeCleanup(record).catch(async () => {
        await prisma.runtimeCleanupOutbox.updateMany({
          where: { id: record.id },
          data: {
            status: "pending",
            stage: "reconcile",
            nextAttemptAt: new Date(now.getTime() + 15_000),
            lastErrorCode: "CLEANUP_QUEUE_UNAVAILABLE",
            claimToken: null,
            leaseExpiresAt: null,
          },
        })
      })
    }
  }

  private async dispatchRuntimeCleanup(record: {
    id: string
    ownerId: string
    conversationId: string
    maxAttempts: number
    attemptCount: number
  }): Promise<void> {
    if (!this.prisma) return
    const jobId = runtimeCleanupQueueJobId(record.id)
    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (state !== "completed" && state !== "failed") {
        await this.prisma.runtimeCleanupOutbox.updateMany({
          where: { id: record.id },
          data: {
            status: "queued",
            stage: "reconcile",
            lastErrorCode: null,
            claimToken: null,
            leaseExpiresAt: null,
          },
        })
        return
      }
      await existing.remove()
    }
    if (record.attemptCount >= record.maxAttempts) {
      await this.prisma.runtimeCleanupOutbox.updateMany({
        where: { id: record.id },
        data: {
          status: "failed",
          claimToken: null,
          leaseExpiresAt: null,
        },
      })
      return
    }
    await this.prisma.runtimeCleanupOutbox.updateMany({
      where: { id: record.id },
      data: {
        status: "queued",
        stage: "reconcile",
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    await this.queue.add(
      "runtime-cleanup",
      {
        type: "runtime-cleanup",
        ownerId: record.ownerId,
        conversationId: record.conversationId,
        outboxId: record.id,
      },
      { jobId, attempts: 1 },
    )
  }

  private async retryRuntimeCleanupOutbox(
    outboxId: string,
  ): Promise<CleanupFailure> {
    if (!this.prisma) throw new CleanupJobNotFoundError()
    const record = await this.prisma.runtimeCleanupOutbox.findUnique({
      where: { id: outboxId },
    })
    if (!record) throw new CleanupJobNotFoundError()
    if (record.status !== "failed") throw new CleanupJobNotRetryableError()
    const failure = projectRuntimeCleanupOutboxFailure(record)
    const job = await this.queue.getJob(runtimeCleanupQueueJobId(record.id))
    if (job) await job.remove()
    const reset = await this.prisma.runtimeCleanupOutbox.update({
      where: { id: record.id },
      data: {
        status: "pending",
        stage: "reconcile",
        attemptCount: 0,
        maxAttempts: runtimeCleanupMaxAttempts,
        nextAttemptAt: new Date(),
        lastAttemptAt: null,
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    await this.dispatchRuntimeCleanup(reset)
    return failure
  }
}

export async function executeRuntimeCleanupJob(input: {
  runner: Pick<RunnerClient, "cleanupRuntime">
  prisma?: Pick<PrismaClient, "runtimeCleanupOutbox"> & Partial<Pick<PrismaClient, "conversation">>
  lifecycleCoordinator?: RuntimeCleanupLifecycle
  ownerId: string
  conversationId: string
  outboxId?: string
  serviceSessionId?: string
  now?: () => Date
}): Promise<
  | { cleaned: true }
  | {
      discarded: true
      reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH"
    }
> {
  const now = input.now ?? (() => new Date())
  let serviceSessionId = input.serviceSessionId
  let removeServiceEnvironment = false
  let claim:
    | {
        token: string
        attemptCount: number
        maxAttempts: number
      }
    | undefined
  if (input.prisma) {
    if (!input.outboxId) {
      return {
        discarded: true,
        reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH",
      }
    }
    const outbox = await input.prisma.runtimeCleanupOutbox.findUnique({
      where: { id: input.outboxId },
      select: {
        ownerId: true,
        conversationId: true,
        serviceSessionId: true,
        removeServiceEnvironment: true,
        status: true,
        attemptCount: true,
        maxAttempts: true,
      },
    })
    if (
      !outbox ||
      outbox.ownerId !== input.ownerId ||
      outbox.conversationId !== input.conversationId
    ) {
      return {
        discarded: true,
        reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH",
      }
    }
    if (
      outbox.status !== "queued" ||
      outbox.attemptCount >= outbox.maxAttempts
    ) {
      return {
        discarded: true,
        reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH",
      }
    }
    const token = randomUUID()
    const claimedAt = now()
    const attemptCount = outbox.attemptCount + 1
    const claimed = await input.prisma.runtimeCleanupOutbox.updateMany({
      where: {
        id: input.outboxId,
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        status: "queued",
        attemptCount: outbox.attemptCount,
      },
      data: {
        status: "running",
        stage: "stop_runtime",
        attemptCount,
        lastAttemptAt: claimedAt,
        lastErrorCode: null,
        claimToken: token,
        leaseExpiresAt: new Date(claimedAt.getTime() + runtimeCleanupLeaseMs),
      },
    })
    if (claimed.count !== 1) {
      return {
        discarded: true,
        reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH",
      }
    }
    serviceSessionId = outbox.serviceSessionId ?? undefined
    removeServiceEnvironment = outbox.removeServiceEnvironment
    claim = { token, attemptCount, maxAttempts: outbox.maxAttempts }
  }
  try {
    if (removeServiceEnvironment) {
      const lifecycle = input.lifecycleCoordinator
      const conversations = input.prisma?.conversation
      if (!serviceSessionId || !lifecycle || !conversations) throw new RunnerRuntimeCleanupError("CLEANUP_RUNTIME_STATE_UNCERTAIN", "reconcile")
      const lease = await lifecycle.acquireUserLifecycleLock(input.ownerId, runtimeCleanupLeaseMs)
      if (!lease) throw new RunnerRuntimeCleanupError("CLEANUP_RUNTIME_ACTIVE", "reconcile")
      try {
        // Forks deliberately share a service HOME. Serialize this check with
        // creation/forking and preserve the environment until its last reference.
        const references = await conversations.findMany({
          where: { ownerId: input.ownerId, OR: [
            { id: input.conversationId },
            { workspaceRelPath: { startsWith: `${input.ownerId}/services/${serviceSessionId}/home/` } },
          ] },
          select: { id: true },
        })
        if (references.some(reference => reference.id === input.conversationId)) throw new RunnerRuntimeCleanupError("CLEANUP_RUNTIME_STATE_UNCERTAIN", "reconcile")
        if (references.length === 0) await input.runner.cleanupRuntime(input.conversationId, input.ownerId, serviceSessionId, true)
        else await input.runner.cleanupRuntime(input.conversationId, input.ownerId, serviceSessionId)
      } finally {
        await lifecycle.releaseUserLifecycleLock(input.ownerId, lease)
      }
    } else {
      await input.runner.cleanupRuntime(input.conversationId, input.ownerId, serviceSessionId)
    }
    if (input.outboxId && input.prisma && claim) {
      await input.prisma.runtimeCleanupOutbox.deleteMany({
        where: {
          id: input.outboxId,
          ownerId: input.ownerId,
          conversationId: input.conversationId,
          status: "running",
          claimToken: claim.token,
        },
      })
    }
    return { cleaned: true }
  } catch (error) {
    if (input.outboxId && input.prisma && claim) {
      const failedAt = now()
      const cleanupError =
        error instanceof RunnerRuntimeCleanupError
          ? error
          : new RunnerRuntimeCleanupError(
              "CLEANUP_RUNNER_UNAVAILABLE",
              "reconcile",
            )
      const exhausted = claim.attemptCount >= claim.maxAttempts
      await input.prisma.runtimeCleanupOutbox
        .updateMany({
          where: {
            id: input.outboxId,
            ownerId: input.ownerId,
            conversationId: input.conversationId,
            status: "running",
            claimToken: claim.token,
          },
          data: {
            status: exhausted ? "failed" : "pending",
            stage: cleanupError.stage,
            nextAttemptAt: new Date(
              failedAt.getTime() + runtimeCleanupRetryDelay(claim.attemptCount),
            ),
            lastAttemptAt: failedAt,
            lastErrorCode: cleanupError.reasonCode,
            claimToken: null,
            leaseExpiresAt: null,
          },
        })
        .catch(() => undefined)
    }
    throw error
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32)
}

export function runtimeCleanupRetryDelay(attemptCount: number): number {
  return Math.min(15_000 * 2 ** Math.max(attemptCount - 1, 0), 60 * 60_000)
}

function isCleanupJob(
  data: MaintenanceJob,
): data is Exclude<
  MaintenanceJob,
  { type: "auth-token-cleanup" | "runtime-cleanup-outbox-dispatch" }
> {
  return (
    data.type !== "auth-token-cleanup" &&
    data.type !== "runtime-cleanup-outbox-dispatch"
  )
}

function projectCleanupFailure(
  job: Awaited<ReturnType<MaintenanceQueueControl["getJob"]>>,
): CleanupFailure | null {
  if (!job?.id) return null
  const data = validateMaintenanceJob(job.data)
  if (!data || !isCleanupJob(data)) return null
  if (data.type === "runtime-cleanup" && data.outboxId) return null
  const failedAt = new Date(job.finishedOn ?? job.processedOn ?? job.timestamp)
  const resourceType =
    data.type === "runtime-cleanup" ||
    data.type === "workspace-directory-delete"
      ? "workspace"
      : data.type === "object-delete"
        ? "object_storage"
        : "capability_directory"
  return {
    id: job.id,
    resource_type: resourceType,
    status: "failed",
    ...(data.type === "runtime-cleanup" ||
    data.type === "workspace-directory-delete"
      ? {
          owner_id: data.ownerId,
          conversation_id: data.conversationId,
        }
      : {}),
    failed_at: failedAt.toISOString(),
    reason_code: "CLEANUP_OPERATION_FAILED",
    attempts_made: job.attemptsMade,
    max_attempts: job.opts.attempts ?? 1,
  }
}

const runtimeCleanupOutboxFailurePrefix = "database-runtime-"

function runtimeCleanupQueueJobId(outboxId: string): string {
  return `runtime-outbox-${outboxId}`
}

function parseRuntimeCleanupOutboxFailureId(value: string): string | null {
  if (!value.startsWith(runtimeCleanupOutboxFailurePrefix)) return null
  const id = value.slice(runtimeCleanupOutboxFailurePrefix.length)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    id,
  )
    ? id
    : null
}

function projectRuntimeCleanupOutboxFailure(record: {
  id: string
  ownerId: string
  conversationId: string
  attemptCount: number
  maxAttempts: number
  status: string
  stage: string
  lastErrorCode: string | null
  lastAttemptAt: Date | null
  createdAt: Date
}): CleanupFailure {
  const cleanupStage = z
    .enum([
      "reconcile",
      "stop_runtime",
      "delete_workspace",
      "delete_control",
      "verify_absent",
    ])
    .catch("reconcile")
    .parse(record.stage)
  const reasonCode = z
    .enum([
      "CLEANUP_RUNNER_UNAVAILABLE",
      "CLEANUP_RUNTIME_ACTIVE",
      "CLEANUP_RUNTIME_STATE_UNCERTAIN",
      "CLEANUP_PERMISSION_DENIED",
      "CLEANUP_PATH_BOUNDARY_INVALID",
      "CLEANUP_DIRECTORY_REMOVE_FAILED",
      "CLEANUP_VERIFICATION_FAILED",
      "CLEANUP_QUEUE_UNAVAILABLE",
      "CLEANUP_OPERATION_FAILED",
    ])
    .catch("CLEANUP_OPERATION_FAILED")
    .parse(record.lastErrorCode)
  return {
    id: `${runtimeCleanupOutboxFailurePrefix}${record.id}`,
    resource_type: "workspace",
    status: "failed",
    cleanup_stage: cleanupStage,
    owner_id: record.ownerId,
    conversation_id: record.conversationId,
    failed_at: (record.lastAttemptAt ?? record.createdAt).toISOString(),
    reason_code: reasonCode,
    attempts_made: record.attemptCount,
    max_attempts: record.maxAttempts,
  }
}

function assertWorkspaceCleanupPath(
  workspaceRoot: string,
  ownerId: string,
  conversationId: string,
  candidate: string,
): void {
  try {
    z.uuid().parse(conversationId)
    const segments = relative(resolve(workspaceRoot), resolve(candidate)).split(sep)
    if (segments[0] !== z.uuid().parse(ownerId)) throw new Error("different owner")
    const serviceSessionId = segments[1] === "services" ? z.uuid().parse(segments[2]) : undefined
    const prefix = serviceSessionId ? `${ownerId}/services/${serviceSessionId}/home/` : `${ownerId}/home/`
    const insideHome = relative(resolve(workspaceRoot, prefix), resolve(candidate)).split(sep)
    const workspaceSegments = insideHome[0] === "workspace" ? 1 : 2
    if (insideHome.length !== workspaceSegments + 2 || insideHome[workspaceSegments] !== "attachments") throw new Error("invalid attachment directory")
    z.uuid().parse(insideHome[workspaceSegments + 1])
    assertConversationWorkspacePath(
      workspaceRoot,
      ownerId,
      prefix + insideHome.slice(0, workspaceSegments).join("/"),
      candidate,
    )
  } catch {
    throw new Error("workspace cleanup path is outside its attachment root")
  }
}

function assertCleanupDescendant(
  root: string,
  candidate: string,
  message: string,
): void {
  const pathFromRoot = relative(resolve(root), resolve(candidate))
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(message)
  }
}

export function bullMqConnection(input: string): RedisOptions {
  const url = new URL(input)
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss")
  }
  const databaseText = url.pathname.replace(/^\//u, "")
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(databaseText ? { db: Number(databaseText) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  }
}
