import { Queue, Worker, type Job, type Processor } from "bullmq";
import { z } from "zod";

import { bullMqConnection } from "../../adapters/jobs.js";

const CLAWHUB_SYNC_QUEUE_NAME = "linksense-clawhub-sync";

const clawHubSyncJobSchema = z.strictObject({
  type: z.literal("sync-all-skills"),
  trigger: z.enum(["startup", "scheduled"]),
});

export type ClawHubSyncJob = z.infer<typeof clawHubSyncJobSchema>;
type ClawHubSyncJobName = ClawHubSyncJob["type"];
type ClawHubSyncQueue = Queue<ClawHubSyncJob, void, ClawHubSyncJobName>;

export type ClawHubSyncQueueControl = Pick<
  ClawHubSyncQueue,
  | "add"
  | "close"
  | "setGlobalConcurrency"
  | "upsertJobScheduler"
  | "waitUntilReady"
>;

export type ClawHubSyncWorkerControl = Pick<
  Worker<ClawHubSyncJob, void, ClawHubSyncJobName>,
  "close" | "cancelAllJobs"
>;

type ClawHubSyncWorkerFactory = (
  processor: Processor<ClawHubSyncJob, void, ClawHubSyncJobName>,
) => ClawHubSyncWorkerControl;

export interface ClawHubSyncSchedulerService {
  syncAll(trigger: "startup" | "scheduled", signal?: AbortSignal): Promise<unknown>;
}

export interface ClawHubSyncSchedulerConfig {
  redisUrl: string;
  timeZone: string;
  now?: () => Date;
}

export class ClawHubSyncScheduler {
  private readonly queue: ClawHubSyncQueueControl;
  private readonly createWorker: ClawHubSyncWorkerFactory;
  private readonly now: () => Date;
  private worker: ClawHubSyncWorkerControl | null = null;

  constructor(
    config: ClawHubSyncSchedulerConfig,
    private readonly service: ClawHubSyncSchedulerService,
    queueOverride?: ClawHubSyncQueueControl,
    workerFactory?: ClawHubSyncWorkerFactory,
  ) {
    const connection = bullMqConnection(config.redisUrl);
    this.queue =
      queueOverride ??
      new Queue<ClawHubSyncJob, void, ClawHubSyncJobName>(
        CLAWHUB_SYNC_QUEUE_NAME,
        {
          connection,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 10_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        },
      );
    this.createWorker =
      workerFactory ??
      ((processor) =>
        new Worker<ClawHubSyncJob, void, ClawHubSyncJobName>(
          CLAWHUB_SYNC_QUEUE_NAME,
          processor,
          { connection, concurrency: 1 },
        ));
    this.timeZone = config.timeZone;
    this.now = config.now ?? (() => new Date());
  }

  private readonly timeZone: string;

  async start(): Promise<void> {
    if (this.worker) return;
    await this.queue.waitUntilReady();
    await this.queue.setGlobalConcurrency(1);
    await this.queue.upsertJobScheduler(
      "sync-all-skills",
      { pattern: "0 0 * * *", tz: this.timeZone },
      {
        name: "sync-all-skills",
        data: { type: "sync-all-skills", trigger: "scheduled" },
      },
    );
    this.worker = this.createWorker((job, _token, signal) => this.process(job, signal));
    await this.queue.add(
      "sync-all-skills",
      { type: "sync-all-skills", trigger: "startup" },
      {
        jobId: startupCatchUpJobId(this.now(), this.timeZone),
        // Keep successful catch-up jobs long enough to deduplicate rolling
        // restarts. Failed jobs must be removable so the next restart can
        // retry instead of being blocked forever by a terminal job id.
        removeOnComplete: 32,
        removeOnFail: true,
      },
    );
  }

  async process(job: Pick<Job<ClawHubSyncJob>, "data">, signal?: AbortSignal): Promise<void> {
    const data = clawHubSyncJobSchema.parse(job.data);
    await this.service.syncAll(data.trigger, signal);
  }

  async close(): Promise<void> {
    // Stop accepting jobs first, then interrupt the current catalog request and
    // retry delay. BullMQ close alone waits for the entire catalog to finish.
    const closing = this.worker?.close();
    this.worker?.cancelAllJobs();
    await closing;
    this.worker = null;
    await this.queue.close();
  }
}

function startupCatchUpJobId(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) {
    throw new Error("clawhub_startup_date_unavailable");
  }
  return `clawhub-startup-catchup-${year}-${month}-${day}`;
}

export function validateClawHubSyncJob(
  input: unknown,
): ClawHubSyncJob | null {
  const parsed = clawHubSyncJobSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
