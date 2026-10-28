import { unavailableDiskUsage, type DiskUsage } from "@linksense/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DiskUsageMonitor,
  DISK_USAGE_SAMPLE_INTERVAL_MS,
} from "../src/docker/disk-usage-monitor.js"

afterEach(() => {
  vi.useRealTimers()
})
const snapshot: DiskUsage = {
  status: "available",
  checked_at: "2026-10-28T08:00:00.000Z",
  total_bytes: 4096,
  refreshing: false,
  categories: [{ key: "user_data", used_bytes: 4096, status: "available" }],
}

describe("disk usage sampler", () => {
  it("samples once at startup and waits a full hour before sampling again", async () => {
    vi.useFakeTimers()
    const collect = vi.fn<() => Promise<DiskUsage>>().mockResolvedValue(snapshot)
    const monitor = new DiskUsageMonitor(collect)
    monitor.start()
    await vi.advanceTimersByTimeAsync(59 * 60_000)
    monitor.read()
    expect(collect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(collect).toHaveBeenCalledTimes(2)
    await monitor.shutdown()
  })
  it("cancels an in-flight filesystem scan when the controller shuts down", async () => {
    let scanSignal: AbortSignal | undefined
    const monitor = new DiskUsageMonitor(
      (signal) =>
        new Promise((_resolve, reject) => {
          scanSignal = signal
          signal.addEventListener(
            "abort",
            () => reject(new Error("Scan cancelled")),
            { once: true },
          )
        }),
    )
    monitor.start()
    await monitor.shutdown()
    expect(scanSignal?.aborted).toBe(true)
    expect(monitor.read().refreshing).toBe(false)
  })
  it("returns immediately during the first sample and reuses one scan for concurrent health reads", async () => {
    let complete!: (usage: DiskUsage) => void
    const collect = vi.fn(
      () =>
        new Promise<DiskUsage>((resolve) => {
          complete = resolve
        }),
    )
    const monitor = new DiskUsageMonitor(collect)
    expect(monitor.read()).toMatchObject({
      status: "collecting",
      total_bytes: null,
      refreshing: true,
    })
    monitor.read()
    expect(collect).toHaveBeenCalledOnce()
    complete(snapshot)
    await monitor.shutdown()
    expect(monitor.read()).toEqual(snapshot)
  })

  it("refreshes periodically without overlapping scans and retains the sample time while refreshing", async () => {
    vi.useFakeTimers()
    let complete!: (usage: DiskUsage) => void
    const collect = vi
      .fn<() => Promise<DiskUsage>>()
      .mockResolvedValueOnce(snapshot)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve
          }),
      )
    const monitor = new DiskUsageMonitor(collect)
    monitor.start()
    await vi.advanceTimersByTimeAsync(DISK_USAGE_SAMPLE_INTERVAL_MS)
    expect(monitor.read()).toEqual({ ...snapshot, refreshing: true })
    await vi.advanceTimersByTimeAsync(DISK_USAGE_SAMPLE_INTERVAL_MS * 2)
    expect(collect).toHaveBeenCalledTimes(2)
    complete({
      ...snapshot,
      total_bytes: 8192,
      categories: [{ key: "user_data", used_bytes: 8192, status: "available" }],
    })
    await monitor.shutdown()
    expect(monitor.read().total_bytes).toBe(8192)
    await vi.advanceTimersByTimeAsync(DISK_USAGE_SAMPLE_INTERVAL_MS)
    expect(collect).toHaveBeenCalledTimes(2)
  })

  it("does not present a previous complete total after a failed refresh", async () => {
    vi.useFakeTimers()
    const monitor = new DiskUsageMonitor(
      vi
        .fn<() => Promise<DiskUsage>>()
        .mockResolvedValueOnce(snapshot)
        .mockRejectedValue(new Error("secret path")),
    )
    monitor.start()
    await vi.advanceTimersByTimeAsync(DISK_USAGE_SAMPLE_INTERVAL_MS)
    expect(monitor.read()).toMatchObject({
      ...unavailableDiskUsage(),
      checked_at: expect.any(String),
    })
    await monitor.shutdown()
  })
})
