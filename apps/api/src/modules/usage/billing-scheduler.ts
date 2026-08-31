import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";

import { bullMqConnection } from "../../adapters/jobs.js";
import type { AppConfig } from "../../config.js";
import type { BillingStatementService } from "./billing-service.js";

const BILLING_QUEUE_NAME = "linksense-monthly-billing";
const billingJobSchema = z.strictObject({
  type: z.literal("generate-missing-statements"),
});

type BillingJob = z.infer<typeof billingJobSchema>;
type BillingQueue = Queue<BillingJob, void, BillingJob["type"]>;
type BillingQueueControl = Pick<
  BillingQueue,
  "add" | "close" | "upsertJobScheduler" | "waitUntilReady"
>;
type BillingWorkerControl = Pick<Worker<BillingJob, void>, "close">;
type BillingWorkerFactory = (
  processor: (job: Job<BillingJob, void>) => Promise<void>,
) => BillingWorkerControl;

export class BillingStatementScheduler {
  private readonly queue: BillingQueueControl;
  private readonly createWorker: BillingWorkerFactory;
  private worker: BillingWorkerControl | null = null;

  constructor(
    config: Pick<AppConfig, "redisUrl">,
    private readonly service: Pick<
      BillingStatementService,
      "generateMissingStatements" | "timeZone"
    >,
    queueOverride?: BillingQueueControl,
    workerFactory?: BillingWorkerFactory,
  ) {
    const connection = bullMqConnection(config.redisUrl);
    this.queue =
      queueOverride ??
      new Queue<BillingJob, void, BillingJob["type"]>(BILLING_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      });
    this.createWorker =
      workerFactory ??
      ((processor) =>
        new Worker<BillingJob, void>(BILLING_QUEUE_NAME, processor, {
          connection,
          concurrency: 1,
        }));
  }

  async start(): Promise<void> {
    if (this.worker) return;
    await this.queue.waitUntilReady();
    await this.queue.upsertJobScheduler(
      "generate-missing-statements",
      { pattern: "5 0 1 * *", tz: this.service.timeZone },
      {
        name: "generate-missing-statements",
        data: { type: "generate-missing-statements" },
      },
    );
    this.worker = this.createWorker((job) => this.process(job));
    await this.queue.add(
      "generate-missing-statements",
      { type: "generate-missing-statements" },
      { removeOnComplete: true },
    );
  }

  async process(job: Pick<Job<BillingJob>, "data">): Promise<void> {
    billingJobSchema.parse(job.data);
    await this.service.generateMissingStatements();
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }
}
