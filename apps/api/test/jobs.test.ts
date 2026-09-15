import type { Job } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import {
  BackgroundJobs,
  CleanupJobNotRetryableError,
  executeRuntimeCleanupJob,
  runtimeCleanupRetryDelay,
  validateMaintenanceJob,
  type MaintenanceJob,
  type MaintenanceQueueControl,
} from "../src/adapters/jobs.js"
import type { ObjectStorage } from "../src/adapters/object-storage.js"
import type { RunnerClient } from "../src/adapters/runner.js"
import { RunnerRuntimeCleanupError } from "../src/adapters/runner.js"
import type { AuditService } from "../src/modules/audit/service.js"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { testConfig } from "./test-config.js"

const OWNER_ID = "01900000-0000-7000-8000-000000000002"

describe("maintenance cleanup failures", () => {
  it("rejects owner-less or malformed persisted maintenance payloads", () => {
    expect(
      validateMaintenanceJob({
        type: "runtime-cleanup",
        conversationId: "01900000-0000-7000-8000-000000000001",
      }),
    ).toBeNull()
    expect(
      validateMaintenanceJob({
        type: "workspace-directory-delete",
        ownerId: OWNER_ID,
        conversationId: "not-a-uuid",
        absolutePath: "/tmp/legacy",
      }),
    ).toBeNull()
    expect(
      validateMaintenanceJob({
        type: "runtime-cleanup",
        ownerId: OWNER_ID,
        conversationId: "01900000-0000-7000-8000-000000000001",
      }),
    ).toEqual({
      type: "runtime-cleanup",
      ownerId: OWNER_ID,
      conversationId: "01900000-0000-7000-8000-000000000001",
    })
  })

  it("lists only cleanup jobs without exposing paths, object keys, or raw errors", async () => {
    const runtime = failedJob(
      "runtime-redacted-id",
      {
        type: "runtime-cleanup",
        ownerId: OWNER_ID,
        conversationId: "01900000-0000-7000-8000-000000000001",
      },
      "failed to delete /private/workspace with token=secret",
    )
    const object = failedJob(
      "object-redacted-id",
      { type: "object-delete", objectKey: "avatars/private-user/secret.png" },
      "MinIO secret-key rejected",
    )
    const auth = failedJob(
      "auth-token-cleanup",
      { type: "auth-token-cleanup" },
      "database details",
    )
    const jobs = createBackgroundJobs(
      queueControl({ failedJobs: [runtime, object, auth] }),
    )

    const failures = await jobs.listFailedCleanupJobs()

    expect(failures).toEqual([
      expect.objectContaining({
        id: "runtime-redacted-id",
        resource_type: "workspace",
        owner_id: OWNER_ID,
        conversation_id: "01900000-0000-7000-8000-000000000001",
        reason_code: "CLEANUP_OPERATION_FAILED",
      }),
      expect.objectContaining({
        id: "object-redacted-id",
        resource_type: "object_storage",
        reason_code: "CLEANUP_OPERATION_FAILED",
      }),
    ])
    const serialized = JSON.stringify(failures)
    expect(serialized).not.toContain("/private/workspace")
    expect(serialized).not.toContain("avatars/private-user")
    expect(serialized).not.toContain("secret-key")
  })

  it("retries a failed cleanup by id and rejects non-failed jobs", async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const failed = failedJob(
      "runtime-redacted-id",
      {
        type: "runtime-cleanup",
        ownerId: OWNER_ID,
        conversationId: "01900000-0000-7000-8000-000000000001",
      },
      "failure",
      { retry },
    )
    const queue = queueControl({ failedJobs: [failed], selectedJob: failed })
    const jobs = createBackgroundJobs(queue)

    await expect(jobs.retryFailedCleanupJob("runtime-redacted-id")).resolves.toMatchObject({
      id: "runtime-redacted-id",
      resource_type: "workspace",
    })
    expect(retry).toHaveBeenCalledWith("failed")

    const waiting = failedJob(
      "runtime-waiting-id",
      {
        type: "runtime-cleanup",
        ownerId: OWNER_ID,
        conversationId: "01900000-0000-7000-8000-000000000002",
      },
      "failure",
      { state: "waiting" },
    )
    const waitingJobs = createBackgroundJobs(
      queueControl({ failedJobs: [], selectedJob: waiting }),
    )
    await expect(
      waitingJobs.retryFailedCleanupJob("runtime-waiting-id"),
    ).rejects.toBeInstanceOf(CleanupJobNotRetryableError)
  })

  it("queues only attachment directories inside the owning user project for cleanup", async () => {
    const queue = queueControl({ failedJobs: [] })
    const jobs = createBackgroundJobs(queue)
    const conversationId = "01900000-0000-7000-8000-000000000001"
    const attachmentDirectory =
      `/tmp/linksense-test/users/${OWNER_ID}/home/projects/${conversationId}/attachments/30000000-0000-4000-8000-000000000001`

    await jobs.enqueueWorkspaceDirectoryRemoval(
      OWNER_ID,
      conversationId,
      attachmentDirectory,
    )

    expect(queue.add).toHaveBeenCalledWith(
      "workspace-directory-delete",
      {
        type: "workspace-directory-delete",
        ownerId: OWNER_ID,
        conversationId,
        absolutePath: attachmentDirectory,
      },
      { jobId: expect.stringMatching(/^workspace-directory-[a-f0-9]{32}$/u) },
    )
    await expect(
      jobs.enqueueWorkspaceDirectoryRemoval(
        OWNER_ID,
        conversationId,
        "/tmp/linksense-test/workspaces/another-conversation/attachments/file-1",
      ),
    ).rejects.toThrow("outside its attachment root")
  })

  it("discards stale persisted prewarms before preparing a runtime", async () => {
    const jobs = createBackgroundJobs(queueControl({ failedJobs: [] }))
    const processor = vi.fn(async () => undefined)
    jobs.registerConversationPrewarmProcessor(processor)
    const data: MaintenanceJob = { type: "conversation-prewarm", ownerId: OWNER_ID, conversationId: "01900000-0000-7000-8000-000000000001", collaborationMode: "default" }
    const old = { data, timestamp: Date.now() - 60_001 } as Job<MaintenanceJob>
    await expect(jobs["process"](old, { cleanupExpiredTokens: vi.fn() } as never)).resolves.toEqual({ discarded: true, reasonCode: "PREWARM_EXPIRED" })
    expect(processor).not.toHaveBeenCalled()
    const fresh = { data, timestamp: Date.now() } as Job<MaintenanceJob>
    await expect(jobs["process"](fresh, { cleanupExpiredTokens: vi.fn() } as never)).resolves.toEqual({ prewarmed: true })
    expect(processor).toHaveBeenCalledTimes(1)
  })

  it("queues low-priority conversation prewarm as a deduplicated one-shot job", async () => {
    const queue = queueControl({ failedJobs: [] })
    const jobs = createBackgroundJobs(queue)
    const conversationId = "01900000-0000-7000-8000-000000000001"

    await jobs.enqueueConversationPrewarm({
      ownerId: OWNER_ID,
      conversationId,
      collaborationMode: "default",
    })

    expect(queue.add).toHaveBeenCalledWith(
      "conversation-prewarm",
      {
        type: "conversation-prewarm",
        ownerId: OWNER_ID,
        conversationId,
        collaborationMode: "default",
      },
      {
        jobId: expect.stringMatching(/^conversation-prewarm-[a-f0-9]{32}$/u),
        attempts: 1,
        priority: 100,
        removeOnComplete: true,
        removeOnFail: true,
      },
    )
  })

  it("keeps a distinct job for each reservation revision when switching back within a minute", async () => {
    const queue = queueControl({ failedJobs: [] })
    const jobs = createBackgroundJobs(queue)
    const processor = vi.fn(async () => undefined)
    jobs.registerConversationPrewarmProcessor(processor)
    for (const [index, collaborationMode] of (["default", "plan", "default"] as const).entries()) {
      const input = {
        ownerId: OWNER_ID, conversationId: "01900000-0000-7000-8000-000000000001",
        collaborationMode, reservationRevision: `71000000-0000-4000-8000-00000000000${index + 1}`,
      }
      await jobs.enqueueConversationPrewarm(input)
      await jobs["process"]({ data: { type: "conversation-prewarm", ...input }, timestamp: Date.now() } as Job<MaintenanceJob>, { cleanupExpiredTokens: vi.fn() } as never)
      expect(processor).toHaveBeenLastCalledWith(input)
    }
    const ids = vi.mocked(queue.add).mock.calls.map(call => call[2]?.jobId)
    expect(new Set(ids).size).toBe(3)
    expect(validateMaintenanceJob({
      type: "conversation-prewarm", ownerId: OWNER_ID,
      conversationId: "01900000-0000-7000-8000-000000000001", collaborationMode: "plan", reservationRevision: "invalid",
    })).toBeNull()
  })

  it("keeps a database-discoverable runtime cleanup when BullMQ enqueue fails", async () => {
    const queue = queueControl({ failedJobs: [] })
    vi.mocked(queue.add).mockRejectedValueOnce(new Error("redis unavailable"))
    const outbox = runtimeCleanupOutboxRow()
    const runtimeCleanupOutbox = {
      upsert: vi.fn().mockResolvedValue(outbox),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([outbox]),
    }
    const jobs = createBackgroundJobs(
      queue,
      { runtimeCleanupOutbox } as unknown as PrismaClient,
    )

    await expect(
      jobs.enqueueRuntimeCleanup(outbox.ownerId, outbox.conversationId),
    ).resolves.toBeUndefined()
    expect(runtimeCleanupOutbox.upsert).toHaveBeenCalledWith({
      where: { conversationId: outbox.conversationId },
      create: {
        ownerId: outbox.ownerId,
        serviceSessionId: null,
        conversationId: outbox.conversationId,
        status: "pending",
        stage: "reconcile",
        maxAttempts: 8,
      },
      update: {
        status: "pending",
        stage: "reconcile",
        attemptCount: 0,
        maxAttempts: 8,
        nextAttemptAt: expect.any(Date),
        lastAttemptAt: null,
        lastErrorCode: null,
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    expect(runtimeCleanupOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: outbox.id },
      data: {
        status: "pending",
        stage: "reconcile",
        nextAttemptAt: expect.any(Date),
        lastErrorCode: "CLEANUP_QUEUE_UNAVAILABLE",
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    await jobs.listDurableRuntimeCleanupFailures()
    expect(runtimeCleanupOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "failed" } }),
    )
  })

  it("recovers a persisted runtime cleanup and retries it by its opaque database id", async () => {
    const outbox = runtimeCleanupOutboxRow({ status: "pending" })
    const remove = vi.fn().mockResolvedValue(undefined)
    const failed = failedJob(
      `runtime-outbox-${outbox.id}`,
      {
        type: "runtime-cleanup",
        ownerId: outbox.ownerId,
        conversationId: outbox.conversationId,
        outboxId: outbox.id,
      },
      "runner unavailable",
      { remove },
    )
    const queue = queueControl({ failedJobs: [] })
    const runtimeCleanupOutbox = {
      findMany: vi.fn().mockResolvedValue([outbox]),
      findUnique: vi.fn().mockResolvedValue(outbox),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue(outbox),
      upsert: vi.fn().mockResolvedValue(outbox),
    }
    const jobs = createBackgroundJobs(
      queue,
      { runtimeCleanupOutbox } as unknown as PrismaClient,
    )

    await jobs.recoverRuntimeCleanupOutbox()
    expect(queue.add).toHaveBeenCalledWith(
      "runtime-cleanup",
      {
        type: "runtime-cleanup",
        ownerId: outbox.ownerId,
        conversationId: outbox.conversationId,
        outboxId: outbox.id,
      },
      { jobId: `runtime-outbox-${outbox.id}`, attempts: 1 },
    )

    const getJobMock = queue.getJob as unknown as ReturnType<typeof vi.fn>
    getJobMock.mockResolvedValueOnce(failed)
    const failedOutbox = runtimeCleanupOutboxRow({
      status: "failed",
      attemptCount: 8,
      lastErrorCode: "CLEANUP_RUNNER_UNAVAILABLE",
    })
    runtimeCleanupOutbox.findUnique.mockResolvedValueOnce(failedOutbox)
    runtimeCleanupOutbox.update.mockResolvedValueOnce(
      runtimeCleanupOutboxRow({ status: "pending" }),
    )
    await expect(
      jobs.retryFailedCleanupJob(`database-runtime-${outbox.id}`),
    ).resolves.toMatchObject({ id: `database-runtime-${outbox.id}` })
    expect(remove).toHaveBeenCalledOnce()
    expect(runtimeCleanupOutbox.update).toHaveBeenCalledWith({
      where: { id: outbox.id },
      data: expect.objectContaining({
        status: "pending",
        stage: "reconcile",
        attemptCount: 0,
        maxAttempts: 8,
        lastErrorCode: null,
      }),
    })
  })

  it("reclaims expired cleanup leases without running two cleanup attempts", async () => {
    const queue = queueControl({ failedJobs: [] })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findMany = vi.fn().mockResolvedValue([])
    const jobs = createBackgroundJobs(
      queue,
      {
        runtimeCleanupOutbox: { updateMany, findMany },
      } as unknown as PrismaClient,
    )
    const now = new Date("2026-07-11T00:10:00.000Z")

    await jobs.recoverRuntimeCleanupOutbox(now)

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: "running",
        leaseExpiresAt: { lte: now },
        attemptCount: { lt: 8 },
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
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: "running",
        leaseExpiresAt: { lte: now },
        attemptCount: { gte: 8 },
      },
      data: {
        status: "failed",
        stage: "reconcile",
        lastErrorCode: "CLEANUP_RUNTIME_STATE_UNCERTAIN",
        claimToken: null,
        leaseExpiresAt: null,
      },
    })
    expect(queue.add).not.toHaveBeenCalled()
  })

  it("clears the durable row only after runner cleanup succeeds", async () => {
    const cleanupRuntime = vi.fn().mockResolvedValue({ success: true })
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const outbox = runtimeCleanupOutboxRow()
    const findUnique = vi.fn().mockResolvedValue(
      runtimeCleanupOutboxRow({ status: "queued" }),
    )
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })

    await expect(
      executeRuntimeCleanupJob({
        runner: { cleanupRuntime },
        prisma: {
          runtimeCleanupOutbox: { findUnique, updateMany, deleteMany } as never,
        },
        ownerId: outbox.ownerId,
        conversationId: outbox.conversationId,
        outboxId: outbox.id,
      }),
    ).resolves.toEqual({ cleaned: true })
    expect(deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(cleanupRuntime.mock.invocationCallOrder[0]!)
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: outbox.id,
        ownerId: outbox.ownerId,
        conversationId: outbox.conversationId,
        status: "running",
        claimToken: expect.any(String),
      },
    })
    expect(cleanupRuntime).toHaveBeenCalledWith(
      outbox.conversationId,
      outbox.ownerId,
      undefined,

    )
  })

  it("retains a retryable cleanup when task control removal is denied", async () => {
    const outbox = runtimeCleanupOutboxRow({ status: "queued" })
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const deleteMany = vi.fn()
    await expect(executeRuntimeCleanupJob({
      runner: { cleanupRuntime: vi.fn().mockRejectedValue(new RunnerRuntimeCleanupError("CLEANUP_PERMISSION_DENIED", "delete_control")) },
      prisma: { runtimeCleanupOutbox: { findUnique: vi.fn().mockResolvedValue(outbox), updateMany, deleteMany } as never },
      ownerId: outbox.ownerId, conversationId: outbox.conversationId, outboxId: outbox.id,
    })).rejects.toThrow("CLEANUP_PERMISSION_DENIED")
    expect(deleteMany).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending", stage: "delete_control", lastErrorCode: "CLEANUP_PERMISSION_DENIED" }) }))
  })

  it("discards a runtime cleanup whose queue payload does not match its durable owner binding", async () => {
    const cleanupRuntime = vi.fn().mockResolvedValue({ success: true })
    const outbox = runtimeCleanupOutboxRow()
    const findUnique = vi.fn().mockResolvedValue(outbox)

    await expect(
      executeRuntimeCleanupJob({
        runner: { cleanupRuntime },
        prisma: {
          runtimeCleanupOutbox: { findUnique } as never,
        },
        ownerId: "01900000-0000-7000-8000-000000000003",
        conversationId: outbox.conversationId,
        outboxId: outbox.id,
      }),
    ).resolves.toEqual({
      discarded: true,
      reasonCode: "RUNTIME_CLEANUP_OUTBOX_BINDING_MISMATCH",
    })
    expect(cleanupRuntime).not.toHaveBeenCalled()
  })

  it("keeps a sanitized final failure in the durable row", async () => {
    const cleanupRuntime = vi.fn().mockRejectedValue(
      new RunnerRuntimeCleanupError(
        "CLEANUP_PERMISSION_DENIED",
        "delete_workspace",
      ),
    )
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const outbox = runtimeCleanupOutboxRow({
      status: "queued",
      attemptCount: 7,
      maxAttempts: 8,
    })
    const findUnique = vi.fn().mockResolvedValue(outbox)
    const failedAt = new Date("2026-07-11T00:10:00.000Z")

    await expect(
      executeRuntimeCleanupJob({
        runner: { cleanupRuntime },
        prisma: {
          runtimeCleanupOutbox: { findUnique, updateMany } as never,
        },
        ownerId: outbox.ownerId,
        conversationId: outbox.conversationId,
        outboxId: outbox.id,
        now: () => failedAt,
      }),
    ).rejects.toThrow("CLEANUP_PERMISSION_DENIED")
    expect(updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        id: outbox.id,
        status: "running",
        claimToken: expect.any(String),
      }),
      data: expect.objectContaining({
        status: "failed",
        stage: "delete_workspace",
        lastErrorCode: "CLEANUP_PERMISSION_DENIED",
        claimToken: null,
        leaseExpiresAt: null,
      }),
    })
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain("private")
  })

  it("includes bounded preview-prune failures without exposing a filesystem path", async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    const prune = failedJob(
      "preview-prune-redacted-id",
      { type: "capability-preview-prune", cursor: "private-cursor" },
      "failed to remove /private/capability/.previews/token",
      { retry },
    )
    const jobs = createBackgroundJobs(
      queueControl({ failedJobs: [prune], selectedJob: prune }),
    )

    const failures = await jobs.listFailedCleanupJobs()
    expect(failures).toEqual([
      expect.objectContaining({
        id: "preview-prune-redacted-id",
        resource_type: "capability_directory",
      }),
    ])
    expect(JSON.stringify(failures)).not.toContain("private-cursor")
    expect(JSON.stringify(failures)).not.toContain("/private/capability")
    await expect(
      jobs.retryFailedCleanupJob("preview-prune-redacted-id"),
    ).resolves.toMatchObject({ resource_type: "capability_directory" })
    expect(retry).toHaveBeenCalledWith("failed")
  })

  it("caps durable cleanup retry delays", () => {
    expect(runtimeCleanupRetryDelay(1)).toBe(15_000)
    expect(runtimeCleanupRetryDelay(2)).toBe(30_000)
    expect(runtimeCleanupRetryDelay(20)).toBe(3_600_000)
  })
})

function createBackgroundJobs(
  queue: MaintenanceQueueControl,
  prisma?: PrismaClient,
) {
  return new BackgroundJobs(
    testConfig(),
    {} as ObjectStorage,
    {} as RunnerClient,
    {} as AuditService,
    undefined,
    queue,
    prisma,
  )
}

function queueControl(input: {
  failedJobs: Job<MaintenanceJob>[]
  selectedJob?: Job<MaintenanceJob>
}): MaintenanceQueueControl {
  return {
    getJobs: vi.fn().mockResolvedValue(input.failedJobs),
    getJob: vi.fn().mockResolvedValue(input.selectedJob),
    add: vi.fn(),
    close: vi.fn(),
    upsertJobScheduler: vi.fn(),
  } as unknown as MaintenanceQueueControl
}

function runtimeCleanupOutboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "01900000-0000-7000-8000-000000000099",
    ownerId: OWNER_ID,
    conversationId: "01900000-0000-7000-8000-000000000001",
    status: "pending",
    stage: "reconcile",
    attemptCount: 0,
    maxAttempts: 8,
    nextAttemptAt: new Date("2026-07-11T00:00:00.000Z"),
    lastAttemptAt: null,
    lastErrorCode: null,
    claimToken: null,
    leaseExpiresAt: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    ...overrides,
  }
}

function failedJob(
  id: string,
  data: MaintenanceJob,
  failedReason: string,
  overrides: {
    retry?: ReturnType<typeof vi.fn>
    remove?: ReturnType<typeof vi.fn>
    state?: string
  } = {},
): Job<MaintenanceJob> {
  return {
    id,
    data,
    name: data.type,
    failedReason,
    timestamp: Date.parse("2026-07-11T00:00:00.000Z"),
    processedOn: Date.parse("2026-07-11T00:00:01.000Z"),
    finishedOn: Date.parse("2026-07-11T00:00:02.000Z"),
    attemptsMade: 5,
    opts: { attempts: 5 },
    getState: vi.fn().mockResolvedValue(overrides.state ?? "failed"),
    retry: overrides.retry ?? vi.fn().mockResolvedValue(undefined),
    remove: overrides.remove ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<MaintenanceJob>
}
