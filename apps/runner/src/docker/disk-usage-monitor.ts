import {
  diskUsageSchema,
  unavailableDiskUsage,
  type DiskUsage,
} from "@linksense/shared"

export const DISK_USAGE_SAMPLE_INTERVAL_MS = 60 * 60_000

/** A controller owns one sampler. Reading health never waits for a filesystem scan. */
export class DiskUsageMonitor {
  private snapshot: DiskUsage = {
    ...unavailableDiskUsage(),
    status: "collecting",
  }
  private inFlight: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false
  private readonly abortController = new AbortController()

  constructor(
    private readonly collect: (signal: AbortSignal) => Promise<DiskUsage>,
  ) {}

  start(): void {
    if (this.timer || this.stopped) return
    this.refresh()
    this.timer = setInterval(
      () => this.refresh(),
      DISK_USAGE_SAMPLE_INTERVAL_MS,
    )
    this.timer.unref()
  }

  read(): DiskUsage {
    this.start()
    return { ...this.snapshot, refreshing: this.inFlight !== undefined }
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    this.abortController.abort()
    await this.inFlight
  }

  private refresh(): void {
    if (this.inFlight || this.stopped) return
    this.inFlight = this.collect(this.abortController.signal)
      .then((snapshot) => diskUsageSchema.parse(snapshot))
      .then(
        (snapshot) => {
          this.snapshot = snapshot
        },
        () => {
          // Never retain a previously complete total after a failed sample.
          this.snapshot = {
            ...unavailableDiskUsage(),
            checked_at: new Date().toISOString(),
          }
        },
      )
      .finally(() => {
        this.inFlight = undefined
      })
  }
}
