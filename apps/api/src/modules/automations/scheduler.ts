import { Queue, Worker, type Job } from "bullmq";
import { z } from "zod";

import type { AppConfig } from "../../config.js";
import { bullMqConnection } from "../../adapters/jobs.js";
import type { AutomationService } from "./service.js";

const AUTOMATION_QUEUE_NAME = "linksense-automations";
const AUTOMATION_SCAN_INTERVAL_MILLISECONDS = 15_000;

const automationJobSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("scan") }),
  z.strictObject({
    type: z.literal("dispatch"),
    automationId: z.uuid(),
    scheduledFor: z.iso.datetime(),
  }),
]);

export type AutomationJob = z.infer<typeof automationJobSchema>;
type AutomationJobName = AutomationJob["type"];
type AutomationQueue = Queue<AutomationJob, void, AutomationJobName>;

export type AutomationQueueControl = Pick<
  AutomationQueue,
  "add" | "close" | "upsertJobScheduler" | "waitUntilReady"
>;

export type AutomationWorkerControl = Pick<
  Worker<AutomationJob, void, AutomationJobName>,
  "close"
>;

type AutomationWorkerFactory = (
  processor: (
    job: Job<AutomationJob, void, AutomationJobName>,
  ) => Promise<void>,
) => AutomationWorkerControl;

type AutomationSchedulerService = Pick<
  AutomationService,
  "dispatchOccurrence" | "listDue"
>;

export class AutomationScheduler {
  private readonly queue: AutomationQueueControl;
  private readonly createWorker: AutomationWorkerFactory;
  private worker: AutomationWorkerControl | null = null;

  constructor(
    config: Pick<AppConfig, "redisUrl">,
    private readonly service: AutomationSchedulerService,
    queueOverride?: AutomationQueueControl,
    workerFactory?: AutomationWorkerFactory,
  ) {
    const connection = bullMqConnection(config.redisUrl);
    this.queue =
      queueOverride ??
      new Queue<AutomationJob, void, AutomationJobName>(AUTOMATION_QUEUE_NAME, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: 1_000,
          removeOnFail: 2_000,
        },
      });
    this.createWorker =
      workerFactory ??
      ((processor) =>
        new Worker<AutomationJob, void, AutomationJobName>(
          AUTOMATION_QUEUE_NAME,
          processor,
          { connection, concurrency: 4 },
        ));
  }

  async start(): Promise<void> {
    if (this.worker) return;
    await this.queue.waitUntilReady();
    await this.queue.upsertJobScheduler(
      "scan",
      { every: AUTOMATION_SCAN_INTERVAL_MILLISECONDS },
      { name: "scan", data: { type: "scan" } },
    );
    this.worker = this.createWorker((job) => this.process(job));
    await this.queue.add("scan", { type: "scan" }, { removeOnComplete: true });
  }

  async process(job: Pick<Job<AutomationJob>, "data">): Promise<void> {
    const data = automationJobSchema.parse(job.data);
    if (data.type === "dispatch") {
      await this.service.dispatchOccurrence(
        data.automationId,
        new Date(data.scheduledFor),
      );
      return;
    }

    const due = await this.service.listDue(new Date());
    await Promise.all(
      due.flatMap((automation) =>
        automation.nextRunAt
          ? [
              this.queue.add(
                "dispatch",
                {
                  type: "dispatch",
                  automationId: automation.id,
                  scheduledFor: automation.nextRunAt.toISOString(),
                },
                {
                  jobId: automationDispatchJobId(
                    automation.id,
                    automation.nextRunAt,
                  ),
                },
              ),
            ]
          : [],
      ),
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }
}

export function validateAutomationJob(input: unknown): AutomationJob | null {
  const parsed = automationJobSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function automationDispatchJobId(
  automationId: string,
  scheduledFor: Date,
): string {
  return `automation-${z.string().uuid().parse(automationId)}-${scheduledFor.getTime()}`;
}
