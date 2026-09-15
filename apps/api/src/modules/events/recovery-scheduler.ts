import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";
import pino from "pino";
import {
  runnerHeartbeatIntervalMs,
  runnerHeartbeatSchema,
  type RunnerHeartbeat,
} from "@linksense/shared";

import { bullMqConnection } from "../../adapters/jobs.js";
import type {
  LinkSenseRedis,
  RecoveryDispatchCursor,
} from "../../adapters/redis.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { ConversationService } from "../conversations/service.js";
import type { ConversationEventService } from "./service.js";

const queueName = "linksense-task-recovery";
const pageSize = 100;
const logger = pino({ name: "task-recovery" });
const jobSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("maintenance") }),
  z.strictObject({
    type: z.literal("owner"),
    ownerId: z.uuid(),
    serviceSessionId: z.uuid().optional(),
    trigger: z.string().regex(/^[a-z0-9-]{1,80}$/u),
    deadline: z.number().int().nonnegative().optional(),
    after: z.uuid().optional(),
  }),
  z.strictObject({
    type: z.literal("turn"),
    conversationId: z.uuid(),
    projectionTurnId: z.uuid(),
    capabilityGeneration: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.strictObject({
    type: z.literal("start"),
    conversationId: z.uuid(),
    projectionTurnId: z.uuid(),
  }),
  z.strictObject({ type: z.literal("context"), attemptId: z.uuid() }),
]);
type RecoveryJob = z.infer<typeof jobSchema>;
type RecoveryQueue = Queue<RecoveryJob, void, RecoveryJob["type"]>;
export type TaskRecoveryQueueControl = Pick<
  RecoveryQueue,
  "add" | "close" | "waitUntilReady" | "setGlobalConcurrency"
>;
type WorkerControl = Pick<Worker, "close">;
type WorkerFactory = (
  processor: (job: Job<RecoveryJob>) => Promise<void>,
) => WorkerControl;

/** Recovery inspects persisted operations; BullMQ must never submit a new turn. */
export class TaskRecoveryScheduler {
  private readonly queue: TaskRecoveryQueueControl;
  private readonly createWorker: WorkerFactory;
  private worker: WorkerControl | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dispatchInFlight: Promise<void> | null = null;

  constructor(
    config: { redisUrl: string },
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly events: Pick<
      ConversationEventService,
      "recoverRunningTurns" | "reconcileAfterProcessExit"
    >,
    private readonly conversations: Pick<
      ConversationService,
      "recoverStartIntent" | "recoverContextWindowAttempt"
    >,
    queueOverride?: TaskRecoveryQueueControl,
    workerFactory?: WorkerFactory,
  ) {
    const connection = bullMqConnection(config.redisUrl);
    this.queue =
      queueOverride ??
      new Queue<RecoveryJob, void, RecoveryJob["type"]>(queueName, {
        connection: {
          ...connection,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          connectTimeout: 5_000,
          commandTimeout: 5_000,
        },
        defaultJobOptions: {
          attempts: 8,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          // Retain failures for diagnosis and to prevent the dispatcher from
          // resetting an exhausted retry budget for the same durable operation.
          removeOnFail: false,
        },
      });
    if (!queueOverride) this.queueErrorHandler(this.queue);
    this.createWorker =
      workerFactory ??
      ((processor) => {
        const worker = new Worker<RecoveryJob>(queueName, processor, {
          connection,
          concurrency: 5,
        });
        worker.on("error", () =>
          logger.error(
            { reasonCode: "TASK_RECOVERY_WORKER_UNAVAILABLE" },
            "Task recovery worker unavailable",
          ),
        );
        worker.on("failed", (job) =>
          logger.warn(
            {
              jobId: job?.id,
              jobType: job?.name,
              attemptsMade: job?.attemptsMade,
            },
            "Task recovery check failed",
          ),
        );
        return worker;
      });
  }

  private queueErrorHandler(queue: TaskRecoveryQueueControl): void {
    if (queue instanceof Queue)
      queue.on("error", () =>
        logger.error(
          { reasonCode: "TASK_RECOVERY_QUEUE_UNAVAILABLE" },
          "Task recovery queue unavailable",
        ),
      );
  }

  async start(): Promise<void> {
    if (this.worker) return;
    await this.queue.waitUntilReady();
    await this.queue.setGlobalConcurrency(5);
    this.worker = this.createWorker((job) => this.process(job));
    await this.dispatchMaintenance();
    // A fixed BullMQ id coalesces ticks across API replicas. Re-enqueuing from
    // the API also restores the schedule after Redis loses queue metadata.
    this.timer = setInterval(() => {
      void this.dispatchMaintenance().catch(() =>
        logger.warn(
          { reasonCode: "TASK_RECOVERY_DISPATCH_UNAVAILABLE" },
          "Task recovery dispatch unavailable",
        ),
      );
    }, runnerHeartbeatIntervalMs);
    this.timer.unref();
  }

  private dispatchMaintenance(): Promise<void> {
    if (this.dispatchInFlight) return this.dispatchInFlight;
    const run = this.queue
      // Queue metadata can be lost independently of the API process. Restore
      // the global limit before dispatch, including after Redis recovery.
      .setGlobalConcurrency(5)
      .then(() =>
        this.queue.add(
          "maintenance",
          { type: "maintenance" },
          {
            jobId: "maintenance",
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        ),
      )
      .then(() => undefined);
    this.dispatchInFlight = run;
    const clear = () => {
      this.dispatchInFlight = null;
    };
    void run.then(clear, clear);
    return run;
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.dispatchInFlight?.catch(() => undefined);
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }

  async heartbeat(ownerId: string, rawInput: RunnerHeartbeat, serviceSessionId?: string): Promise<void> {
    z.uuid().parse(ownerId);
    const input = runnerHeartbeatSchema.parse(rawInput);
    if (input.startup) {
      await this.enqueueOwner({
        type: "owner",
        ownerId,
        trigger: `boot-${input.bootId}`,
        serviceSessionId,
      });
    }
    await this.redis.recordRunnerHeartbeat(ownerId, serviceSessionId);
  }

  async enqueueTurn(
    input: Omit<Extract<RecoveryJob, { type: "turn" }>, "type">,
  ): Promise<void> {
    const data = jobSchema.parse({ type: "turn", ...input });
    await this.queue.add("turn", data, {
      jobId: `exit-${input.projectionTurnId}-${input.capabilityGeneration}`,
    });
  }

  async process(job: { data: unknown }): Promise<void> {
    const data = jobSchema.parse(job.data);
    switch (data.type) {
      case "maintenance":
        await this.maintain();
        return;
      case "owner":
        await this.dispatchOwner(data);
        return;
      case "context":
        if (
          (await this.conversations.recoverContextWindowAttempt(
            data.attemptId,
          )) === "pending"
        )
          throw new Error("TASK_RECOVERY_PENDING");
        return;
      case "start":
      case "turn": {
        // Longer than the Runner's 100s reconciliation HTTP timeout. Database
        // transitions and the Runner's native identity checks remain the fence.
        const token = await this.redis.acquireRecoveryLock(
          data.conversationId,
          180_000,
        );
        if (!token) throw new Error("TASK_RECOVERY_BUSY");
        try {
          if (data.type === "start") {
            const outcome = await this.conversations.recoverStartIntent(
              data.projectionTurnId,
              { resubmitNonTerminal: false },
            );
            if (outcome === "pending") throw new Error("TASK_RECOVERY_PENDING");
          } else {
            const result = await this.events.reconcileAfterProcessExit({
              conversationId: data.conversationId,
              projectionTurnId: data.projectionTurnId,
              capabilityGeneration: data.capabilityGeneration,
            });
            if (result.outcome === "failed") throw new Error(result.reasonCode);
          }
        } finally {
          await this.redis.releaseRecoveryLock(data.conversationId, token);
        }
      }
    }
  }

  private async maintain(): Promise<void> {
    const status = await this.redis.runningTurnRecoveryStatus();
    if (!status.last_success_at) {
      // Full reconciliation is reserved for startup or loss of the Redis
      // capacity baseline. Ordinary ticks never enumerate running turns.
      await this.events.recoverRunningTurns({ requireObserved: false });
    }
    for (const entry of await this.redis.expiredRunnerOwners()) {
      await this.enqueueOwner({
        type: "owner",
        ownerId: entry.ownerId,
        serviceSessionId: entry.serviceSessionId,        deadline: entry.deadline,
        trigger: `expired-${entry.deadline}`,
      });
      await this.redis.acknowledgeExpiredRunnerOwner(
        entry.ownerId,
        entry.deadline,
        entry.serviceSessionId,      );
    }
    await this.dispatchPendingStarts();
    await this.dispatchPendingContexts();
  }

  private async enqueueOwner(
    data: Extract<RecoveryJob, { type: "owner" }>,
  ): Promise<void> {
    await this.queue.add("owner", data, {
      jobId: `owner-${data.ownerId}-${data.serviceSessionId ?? "personal"}-${data.trigger}-${data.after ?? "first"}`,
    });
  }

  private async dispatchOwner(
    data: Extract<RecoveryJob, { type: "owner" }>,
  ): Promise<void> {
    const deadline = await this.redis.runnerOwnerDeadline(data.ownerId, data.serviceSessionId);
    if (
      data.deadline !== undefined &&
      deadline !== null &&
      deadline > data.deadline
    )
      return;
    const page = await this.redis.runningTurnSlotsForOwner(
      data.ownerId,
      data.after,
    );
    if (page.slots.length === 0) {
      if (page.after) await this.enqueueOwner({ ...data, after: page.after });
      return;
    }
    // Projection atomically replaces an intent with a turn. Read both tables
    // from one snapshot so that this transition can never look like an orphan.
    const { rows, intents } = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.conversationTurn.findMany({
          // Include terminal rows whose event committed before capacity release.
          // Check ownership after lookup: a mismatched row is never an orphan.
          where: { id: { in: page.slots.map((slot) => slot.turnId) } },
          take: pageSize,
          select: {
            id: true,
            conversationId: true,
            capabilityGeneration: true,
            submittedBy: true,
          },
        });
        const missingIds = page.slots
          .filter((slot) => !rows.some((row) => row.id === slot.turnId))
          .map((slot) => slot.turnId);
        const intents = missingIds.length
          ? await tx.conversationTurnStartIntent.findMany({
              where: { projectionTurnId: { in: missingIds } },
              select: { projectionTurnId: true },
            })
          : [];
        return { rows, intents };
      },
      { isolationLevel: "RepeatableRead" },
    );
    if (rows.some((row) => row.submittedBy !== data.ownerId)) {
      throw new Error("TASK_RECOVERY_OWNER_MISMATCH");
    }
    for (const row of rows) {
      await this.queue.add(
        "turn",
        {
          type: "turn",
          conversationId: row.conversationId,
          projectionTurnId: row.id,
          capabilityGeneration: row.capabilityGeneration,
        },
        { jobId: `turn-${row.id}-${data.trigger}` },
      );
    }
    const missing = page.slots.filter(
      (slot) => !rows.some((row) => row.id === slot.turnId),
    );
    if (missing.length) {
      for (const slot of missing) {
        if (
          !intents.some((intent) => intent.projectionTurnId === slot.turnId)
        ) {
          await this.redis.releaseTurnSlot(slot.conversationId, slot.turnId);
        }
      }
    }
    if (page.after) await this.enqueueOwner({ ...data, after: page.after });
  }

  private async dispatchPendingStarts(): Promise<void> {
    const cursor = await this.redis.recoveryDispatchCursor("start");
    const rows = await this.prisma.conversationTurnStartIntent.findMany({
      where: {
        runnerStatus: {
          in: [
            "slot_pending",
            "prepared",
            "runner_succeeded",
            "release_pending",
          ],
        },
        createdAt: { lt: new Date(Date.now() - 30_000) },
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  projectionTurnId: { gt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { projectionTurnId: "asc" }],
      take: pageSize,
      select: { projectionTurnId: true, conversationId: true, createdAt: true },
    });
    for (const row of rows) {
      await this.queue.add(
        "start",
        {
          type: "start",
          conversationId: row.conversationId,
          projectionTurnId: row.projectionTurnId,
        },
        { jobId: `start-${row.projectionTurnId}` },
      );
    }
    const last = rows.at(-1);
    await this.saveCursor(
      "start",
      rows.length,
      last
        ? { id: last.projectionTurnId, createdAt: last.createdAt }
        : undefined,
    );
  }

  private async dispatchPendingContexts(): Promise<void> {
    const cursor = await this.redis.recoveryDispatchCursor("context");
    const rows = await this.prisma.conversationTurnAttempt.findMany({
      where: {
        kind: "context_recovery",
        status: "pending",
        createdAt: { lt: new Date(Date.now() - 30_000) },
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { gt: cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pageSize,
      select: { id: true, createdAt: true },
    });
    for (const row of rows)
      await this.queue.add(
        "context",
        { type: "context", attemptId: row.id },
        { jobId: `context-${row.id}` },
      );
    await this.saveCursor("context", rows.length, rows.at(-1));
  }

  private async saveCursor(
    kind: "start" | "context",
    size: number,
    last?: { id: string; createdAt: Date },
  ): Promise<void> {
    const cursor: RecoveryDispatchCursor | null =
      size === pageSize && last
        ? { id: last.id, createdAt: last.createdAt.toISOString() }
        : null;
    // Save only after durable dispatch; a crash can repeat a page, never skip it.
    await this.redis.setRecoveryDispatchCursor(kind, cursor);
  }
}
