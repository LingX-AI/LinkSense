import { randomUUID } from "node:crypto";
import {
  runnerHeartbeatIntervalMs,
  type RunnerHeartbeat,
} from "@linksense/shared";

/** Worker liveness is independent of tokens, tool calls, and native turn age. */
export class RunnerHeartbeatReporter {
  private readonly bootId = randomUUID();
  private readonly acknowledgedOwners = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly ownerIds: () => string[],
    private readonly report: (
      ownerId: string,
      input: RunnerHeartbeat,
    ) => Promise<void>,
    private readonly onFailure: (ownerId: string) => void,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, runnerHeartbeatIntervalMs);
    this.timer.unref();
    void this.tick();
  }

  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.reportOwners();
    this.inFlight = run;
    void run.then(
      () => {
        this.inFlight = null;
      },
      () => {
        this.inFlight = null;
      },
    );
    return run;
  }

  private async reportOwners(): Promise<void> {
    const owners = this.ownerIds();
    for (const owner of this.acknowledgedOwners) {
      if (!owners.includes(owner)) this.acknowledgedOwners.delete(owner);
    }
    for (let index = 0; index < owners.length; index += 5) {
      await Promise.all(
        owners.slice(index, index + 5).map(async (ownerId) => {
          try {
            await this.report(ownerId, {
              bootId: this.bootId,
              startup: !this.acknowledgedOwners.has(ownerId),
            });
            this.acknowledgedOwners.add(ownerId);
          } catch {
            this.onFailure(ownerId);
          }
        }),
      );
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }
}
