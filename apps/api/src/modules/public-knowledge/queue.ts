import { DelayedError, Queue, Worker } from "bullmq";
import { publicKnowledgeConcurrencyLimit } from "@linksense/shared";
import type { Redis } from "ioredis";
import type { Logger } from "pino";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { bullMqConnection } from "../../adapters/jobs.js";

const queueName = "public-knowledge-turns";
const capacityKey = "linksense:public-knowledge:queue-admission";
const queueCapacity = 128;
const reserve = `if redis.call('ZSCORE',KEYS[1],ARGV[2]) then return 1 end; if redis.call('ZCARD',KEYS[1])>=${queueCapacity} then return 0 end; redis.call('ZADD',KEYS[1],ARGV[1],ARGV[2]); return 1`;
export type PublicKnowledgeDispatchResult = void | "deferred";
export interface PublicKnowledgeQueue {
  start(
    process: (turnId: string) => Promise<PublicKnowledgeDispatchResult>,
    failed: (turnId: string) => Promise<void>,
  ): Promise<void>;
  enqueue(turnId: string): Promise<void>;
  close(): Promise<void>;
}

/** Dedicated persistent queue. A failed/stalled job never replays a Codex turn. */
export class BullMqPublicKnowledgeQueue implements PublicKnowledgeQueue {
  private queue: Queue<{ turnId: string }> | undefined;
  private worker: Worker<{ turnId: string }> | undefined;
  private readonly pendingFailures = new Set<Promise<void>>();
  constructor(
    private readonly redis: Redis,
    private readonly redisUrl: string,
    private readonly logger: Pick<Logger, "error">,
  ) {}
  async start(
    process: (turnId: string) => Promise<PublicKnowledgeDispatchResult>,
    onFailed: (turnId: string) => Promise<void>,
  ): Promise<void> {
    if (this.queue) return;
    const connection = bullMqConnection(this.redisUrl);
    this.queue = new Queue(queueName, { connection });
    this.worker = new Worker(
      queueName,
      async (job, token) => {
        const turnId = z
          .strictObject({ turnId: z.uuid() })
          .parse(job.data).turnId;
        let deferred = false;
        try {
          if ((await process(turnId)) === "deferred") {
            // No native turn has started. Let BullMQ release this worker slot
            // while this application's configured execution capacity is full.
            if (!token) throw new AppError("RUNNER_UNAVAILABLE");
            await job.moveToDelayed(Date.now() + 5_000, token);
            deferred = true;
            throw new DelayedError();
          }
        } finally {
          if (!deferred) {
            await this.redis.zrem(capacityKey, turnId);
            // Completion releases execution slots. Wake waiting jobs now;
            // delayed polling remains only a bounded recovery mechanism.
            await this.wakeWaiting();
          }
        }
      },
      {
        connection,
        concurrency: publicKnowledgeConcurrencyLimit,
        maxStalledCount: 0,
        lockDuration: 300_000,
      },
    );
    const failed = (error: unknown) =>
      this.logger.error(
        { errorClass: error instanceof Error ? error.name : "unknown" },
        "public knowledge queue unavailable",
      );
    this.worker.on("error", failed);
    this.queue.on("error", failed);
    this.worker.on("failed", (job) => {
      const id = z.uuid().safeParse(job?.id);
      if (!id.success) return;
      const task = onFailed(id.data)
        .then(async () => {
          await this.redis.zrem(capacityKey, id.data);
        })
        .catch(failed)
        .finally(() => {
          this.pendingFailures.delete(task);
        });
      this.pendingFailures.add(task);
    });
    try {
      await Promise.all([
        this.queue.waitUntilReady(),
        this.worker.waitUntilReady(),
      ]);
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async enqueue(turnId: string): Promise<void> {
    z.uuid().parse(turnId);
    if (!this.queue) throw new AppError("RUNNER_UNAVAILABLE");
    const reserveSlot = async () =>
      Number(
        await this.redis.eval(
          reserve,
          1,
          capacityKey,
          String(Date.now()),
          turnId,
        ),
      ) === 1;
    if (!(await reserveSlot())) {
      // Reclaim only missing or terminal jobs. Slow valid jobs retain their
      // admission even when their queue wait exceeds an arbitrary lease TTL.
      const stale = await this.redis.zrangebyscore(
        capacityKey,
        "-inf",
        Date.now() - 60_000,
        "LIMIT",
        0,
        queueCapacity,
      );
      await Promise.all(
        stale.map(async (id) => {
          const job = await this.queue?.getJob(id),
            state = await job?.getState();
          if (!job || state === "completed" || state === "failed")
            await this.redis.zrem(capacityKey, id);
        }),
      );
      if (!(await reserveSlot()))
        throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED");
    }
    try {
      await this.queue.add(
        "answer",
        { turnId },
        {
          jobId: turnId,
          attempts: 1,
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86400, count: 1000 },
        },
      );
    } catch {
      await this.redis.zrem(capacityKey, turnId);
      throw new AppError("RUNNER_UNAVAILABLE");
    }
  }
  private async wakeWaiting(): Promise<void> {
    const jobs =
      (await this.queue?.getDelayed(0, publicKnowledgeConcurrencyLimit - 1)) ??
      [];
    const results = await Promise.allSettled(
      jobs.map(async (job) => {
        try {
          await job.promote();
        } catch (error) {
          // Another API worker may already have promoted this same job.
          if ((await job.getState()) === "delayed") throw error;
        }
      }),
    );
    if (results.some((result) => result.status === "rejected"))
      throw new AppError("RUNNER_UNAVAILABLE");
  }
  async close(): Promise<void> {
    await this.worker?.close();
    await Promise.all(this.pendingFailures);
    await this.queue?.close();
    this.worker = undefined;
    this.queue = undefined;
  }
}
