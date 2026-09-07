import pLimit from "p-limit";

type DurableWorkDispatcherOptions<T> = {
  concurrency: number;
  listPending: (limit: number) => Promise<readonly T[]>;
  key: (item: T) => string;
  process: (item: T) => Promise<void>;
};

/** Schedules durable work; repositories and distributed leases own its state. */
export class DurableWorkDispatcher<T> {
  private started = false;
  private requested = false;
  private scan: Promise<void> | null = null;
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly limit;

  constructor(private readonly options: DurableWorkDispatcherOptions<T>) {
    this.limit = pLimit(options.concurrency);
  }

  start(): void {
    this.started = true;
  }

  wake(): void {
    if (!this.started) return;
    this.requested = true;
    this.#scheduleScan();
  }

  async close(): Promise<void> {
    this.started = false;
    this.requested = false;
    await this.scan;
    await Promise.allSettled(this.tasks.values());
  }

  #scheduleScan(): void {
    if (
      !this.started ||
      !this.requested ||
      this.scan ||
      this.tasks.size >= this.options.concurrency
    ) {
      return;
    }
    this.requested = false;
    const scan = this.#scanPending().finally(() => {
      this.scan = null;
      // Notifications received during the query must survive its completion.
      this.#scheduleScan();
    });
    this.scan = scan;
  }

  async #scanPending(): Promise<void> {
    try {
      const items = await this.options.listPending(
        this.options.concurrency - this.tasks.size,
      );
      if (!this.started) return;
      for (const item of items) {
        if (this.tasks.size >= this.options.concurrency) break;
        const key = this.options.key(item);
        if (this.tasks.has(key)) continue;
        const task = this.limit(() => this.options.process(item))
          .catch(() => {
            // Durable state determines retry eligibility on a subsequent wake.
          })
          .finally(() => {
            this.tasks.delete(key);
            // One slow job must not hold up every slot in the previous batch.
            this.#scheduleScan();
          });
        this.tasks.set(key, task);
      }
    } catch {
      // The runtime's periodic wake retries database failures without spinning.
    }
  }
}
